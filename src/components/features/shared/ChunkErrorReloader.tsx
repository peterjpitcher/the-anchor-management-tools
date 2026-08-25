'use client'

import { useEffect } from 'react'
import {
  clearPendingNavigation,
  getPendingNavigation,
  rememberPendingNavigation,
  safePathForTelemetry,
} from '@/lib/navigation-recovery'

// After a deployment, browser tabs still running the previous build hold
// references to chunk hashes that no longer exist. When such a tab lazy-loads a
// route/component chunk it 404s with a ChunkLoadError and the page fails to
// render — exactly the "half-broken layout + console 404s" a long-lived tab
// shows after a deploy. Vercel Skew Protection mitigates this at the platform
// level; this listener is the client-side safety net: on a genuine chunk load
// failure it performs a guarded full navigation to pull the current build. A
// sessionStorage guard caps reloads so a genuinely broken deployment shows the
// error instead of looping.

const RELOAD_GUARD_KEY = 'chunk-reload-guard'
const MAX_RELOADS = 2
const RELOAD_WINDOW_MS = 30_000

/** True for the runtime errors webpack/Next throw when a chunk can't be fetched. */
export function isChunkLoadFailure(message: string): boolean {
  if (!message) return false
  return /ChunkLoadError|Loading chunk [^\s]+ failed|Loading CSS chunk|error loading dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    message,
  )
}

/** A document <script> from /_next/static failing to load (stale cached HTML). */
function isStaleNextScript(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName !== 'SCRIPT') return false
  const src = target.getAttribute('src') || ''
  return src.includes('/_next/static/')
}

/**
 * Reload at most MAX_RELOADS times within a rolling window. Returns whether a
 * reload is permitted now. Exported for testing.
 */
export function shouldReloadForChunkError(now: number = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY)
    const prev = raw ? (JSON.parse(raw) as { count: number; first: number }) : null
    if (!prev || now - prev.first > RELOAD_WINDOW_MS) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ count: 1, first: now }))
      return true
    }
    if (prev.count >= MAX_RELOADS) return false
    sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ count: prev.count + 1, first: prev.first }))
    return true
  } catch {
    return false
  }
}

type ChunkErrorReloaderProps = {
  deploymentVersion: string
}

type RecoveryReport = {
  type: 'chunk_load_recovery'
  message: string
  currentPath: string
  intendedPath: string | null
  deploymentVersion: string
  online: boolean
  recoveryAllowed: boolean
  occurredAt: string
}

function reportRecovery(report: RecoveryReport): void {
  const body = JSON.stringify(report)

  try {
    if (navigator.sendBeacon?.('/api/client-errors', body)) return
  } catch {
    // Fall back to a keepalive request below.
  }

  void fetch('/api/client-errors', {
    method: 'POST',
    body,
    cache: 'no-store',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  }).catch(() => {
    // Never let diagnostics block recovery.
  })
}

let recoveryStarted = false

function readDeploymentVersion(fallback: string = 'unknown'): string {
  return document.querySelector<HTMLMetaElement>('meta[name="app-deployment-version"]')?.content || fallback
}

export function retryPendingNavigation(): void {
  const destination = getPendingNavigation()
  clearPendingNavigation()

  if (destination && destination !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.location.assign(destination)
    return
  }

  window.location.reload()
}

export function recoverFromChunkFailure(message: string, deploymentVersion?: string): void {
  if (recoveryStarted) return
  recoveryStarted = true

  const destination = getPendingNavigation()
  const recoveryAllowed = shouldReloadForChunkError()
  reportRecovery({
    type: 'chunk_load_recovery',
    message: message.slice(0, 500),
    currentPath: window.location.pathname,
    intendedPath: safePathForTelemetry(destination),
    deploymentVersion: deploymentVersion || readDeploymentVersion(),
    online: navigator.onLine,
    recoveryAllowed,
    occurredAt: new Date().toISOString(),
  })

  if (recoveryAllowed) retryPendingNavigation()
}

export function ChunkErrorReloader({ deploymentVersion }: ChunkErrorReloaderProps) {
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | null = null

    function onError(event: ErrorEvent | Event) {
      const message = (event as ErrorEvent).message || (event as ErrorEvent).error?.message || ''
      if (isChunkLoadFailure(message) || isStaleNextScript(event.target)) {
        recoverFromChunkFailure(message || 'Failed to load a Next.js script', deploymentVersion)
      }
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason
      const message = (reason && (reason.message || String(reason))) || ''
      if (isChunkLoadFailure(message)) {
        recoverFromChunkFailure(message, deploymentVersion)
      }
    }

    function onDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return

      const destination = new URL(target.href, window.location.href)
      if (destination.origin !== window.location.origin) return

      rememberPendingNavigation(destination.href)
      if (clearTimer) clearTimeout(clearTimer)
      clearTimer = setTimeout(clearPendingNavigation, 15_000)
    }

    // capture=true so resource-load errors (which do not bubble) are caught.
    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onRejection)
    document.addEventListener('click', onDocumentClick, true)
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onRejection)
      document.removeEventListener('click', onDocumentClick, true)
      if (clearTimer) clearTimeout(clearTimer)
    }
  }, [deploymentVersion])

  return null
}
