'use client'

import { useState, useEffect } from 'react'
import type { OutstandingCounts } from '@/actions/get-outstanding-counts'

export function useOutstandingCounts() {
  const [counts, setCounts] = useState<OutstandingCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true

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

    fetchCounts()

    const interval = setInterval(fetchCounts, 60000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return { counts, loading, error }
}
