'use client'

import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { hasDeploymentChanged } from '@/lib/foh/deployment-version'

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000
const RELOAD_DECISION_INTERVAL_MS = 30 * 1000
/** How long nobody must have touched the screen before it reloads itself. */
export const FOH_RELOAD_IDLE_MS = 2 * 60 * 1000
/** An open form delays a reload for at most this long once an update is waiting (BK-096). */
export const FOH_RELOAD_MAX_DEFER_MS = 15 * 60 * 1000

export interface FohReloadDecisionInput {
  versionChanged: boolean
  /** A request is in flight: never reload under it. */
  busy: boolean
  /** A form or confirmation is open: wait, but only up to FOH_RELOAD_MAX_DEFER_MS. */
  formOpen: boolean
  idleMs: number
  updatePendingMs: number
}

/**
 * Whether an out-of-date FOH screen should reload now. A booking panel left open no longer
 * holds a reload off forever; the device reloads once the screen has been idle (BK-096).
 */
export function shouldReloadForDeployment(input: FohReloadDecisionInput): boolean {
  if (!input.versionChanged || input.busy) return false
  if (input.idleMs < FOH_RELOAD_IDLE_MS) return false
  if (input.formOpen && input.updatePendingMs < FOH_RELOAD_MAX_DEFER_MS) return false
  return true
}

export function useFohDeploymentRefresh(input: {
  currentVersion: string
  busy: boolean
  formOpen: boolean
  lastInteractionAtMsRef: MutableRefObject<number>
}): void {
  const { currentVersion, busy, formOpen, lastInteractionAtMsRef } = input
  const [latestVersion, setLatestVersion] = useState(currentVersion)
  const updateSeenAtMsRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function checkVersion() {
      try {
        const response = await fetch('/api/app-version', { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as { version?: string }
        if (!cancelled && typeof payload.version === 'string') {
          setLatestVersion(payload.version)
        }
      } catch {
        // A version check must never interrupt the live floor screen.
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkVersion()
    }

    void checkVersion()
    const intervalId = window.setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [currentVersion])

  useEffect(() => {
    const versionChanged = hasDeploymentChanged(currentVersion, latestVersion)
    if (!versionChanged) {
      updateSeenAtMsRef.current = null
      return
    }
    if (updateSeenAtMsRef.current === null) updateSeenAtMsRef.current = Date.now()

    // Idle time grows without a re-render, so decide on a timer as well as on each change.
    const decide = () => {
      const now = Date.now()
      if (
        shouldReloadForDeployment({
          versionChanged,
          busy,
          formOpen,
          idleMs: now - lastInteractionAtMsRef.current,
          updatePendingMs: now - (updateSeenAtMsRef.current ?? now),
        })
      ) {
        window.location.reload()
      }
    }

    decide()
    const intervalId = window.setInterval(decide, RELOAD_DECISION_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [currentVersion, latestVersion, busy, formOpen, lastInteractionAtMsRef])
}
