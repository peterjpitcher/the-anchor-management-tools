'use client'

import { useEffect } from 'react'

// After a deployment, browser tabs still running the previous build hold
// references to chunk hashes that no longer exist. When such a tab lazy-loads a
// route/component chunk it 404s with a ChunkLoadError and the page fails to
// render — exactly the "half-broken layout + console 404s" a long-lived tab
// shows after a deploy. Vercel Skew Protection mitigates this at the platform
// level; this listener is the client-side safety net: on a genuine chunk load
// failure it performs a single full reload to pull the current build. A
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

export function ChunkErrorReloader() {
  useEffect(() => {
    function reloadOnce() {
      if (shouldReloadForChunkError()) {
        window.location.reload()
      }
    }

    function onError(event: ErrorEvent | Event) {
      const message = (event as ErrorEvent).message || (event as ErrorEvent).error?.message || ''
      if (isChunkLoadFailure(message) || isStaleNextScript(event.target)) {
        reloadOnce()
      }
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason
      const message = (reason && (reason.message || String(reason))) || ''
      if (isChunkLoadFailure(message)) {
        reloadOnce()
      }
    }

    // capture=true so resource-load errors (which do not bubble) are caught.
    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
