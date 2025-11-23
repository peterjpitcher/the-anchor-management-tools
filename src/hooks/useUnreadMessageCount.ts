import { useEffect, useState } from 'react'

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

type UnreadCountResponse = {
  badge?: number
}

/**
 * Polls the unread message count API and keeps the value in sync.
 *
 * @param intervalMs polling interval in milliseconds (defaults to 30 seconds)
 */
export function useUnreadMessageCount(intervalMs = 30_000): number {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let isMounted = true
    let controller: AbortController | null = null

    async function fetchUnreadCount() {
      controller?.abort()
      controller = new AbortController()

      const shouldSkip =
        process.env.NODE_ENV === 'test' ||
        typeof window === 'undefined' ||
        !window.location?.origin ||
        window.location.origin === 'about:blank'

      if (shouldSkip) {
        return
      }

      try {
        const endpoint = new URL('/api/messages/unread-count', window.location.origin).toString()
        const response = await fetch(endpoint, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const data: UnreadCountResponse = await response.json()
        if (!isMounted) return

        const badge = Number(data?.badge ?? 0)
        setUnreadCount(Number.isFinite(badge) ? badge : 0)
      } catch (error) {
        if (isAbortError(error) || !isMounted) {
          return
        }
        console.error('Failed to fetch unread message count:', error)
        setUnreadCount(0)
      }
    }

    fetchUnreadCount()
    const interval = window.setInterval(fetchUnreadCount, intervalMs)

    return () => {
      isMounted = false
      controller?.abort()
      window.clearInterval(interval)
    }
  }, [intervalMs])

  return unreadCount
}
