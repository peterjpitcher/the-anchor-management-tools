'use client'

import { useState, useEffect } from 'react'
import type { OutstandingCounts } from '@/actions/get-outstanding-counts'

const POLL_INTERVAL_MS = 60_000

/**
 * Polls the nav badge counts.
 *
 * Polling stops while the tab is hidden and resumes with an immediate refresh when it
 * comes back. The FOH iPad sits on this screen all day and every poll costs a round of
 * database work, so an unattended overnight tab was doing roughly 720 pointless polls
 * before anyone next looked at it. Nothing is lost by pausing: the counts are re-fetched
 * the moment the tab is visible again, which is the only moment they can be read.
 */
export function useOutstandingCounts() {
  const [counts, setCounts] = useState<OutstandingCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true
    let interval: ReturnType<typeof setInterval> | null = null

    async function fetchCounts() {
      try {
        const response = await fetch('/api/outstanding-counts', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('Failed to fetch outstanding counts')
        }
        const json = await response.json()
        if (!json?.success) {
          throw new Error(json?.error || 'Failed to fetch outstanding counts')
        }
        if (mounted) {
          setCounts(json.data as OutstandingCounts)
          setError(null)
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          console.error('Failed to fetch outstanding counts:', err)
          setError(err instanceof Error ? err : new Error('Unknown error'))
          setLoading(false)
        }
      }
    }

    function stopPolling() {
      if (interval != null) {
        clearInterval(interval)
        interval = null
      }
    }

    function startPolling() {
      stopPolling()
      interval = setInterval(fetchCounts, POLL_INTERVAL_MS)
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopPolling()
        return
      }
      // Back in view: show current numbers straight away rather than waiting out
      // the remainder of an interval, then resume the regular cadence.
      void fetchCounts()
      startPolling()
    }

    void fetchCounts()
    if (document.visibilityState === 'visible') {
      startPolling()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return { counts, loading, error }
}
