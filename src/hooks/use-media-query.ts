import { useCallback, useSyncExternalStore } from 'react'

/**
 * Custom hook for responsive design with media queries
 *
 * Implemented with useSyncExternalStore so the real match value is read
 * synchronously on the client: the hydration render uses the server snapshot
 * (false) to match server HTML (no hydration mismatch), then React's
 * commit-phase snapshot check re-renders before paint — avoiding the flash
 * of the wrong layout that a useState(false) + useEffect approach causes.
 *
 * @param query - Media query string (e.g., '(min-width: 768px)')
 * @returns boolean indicating if the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const media = window.matchMedia(query)
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onStoreChange)
        return () => media.removeEventListener('change', onStoreChange)
      }
      // Legacy fallback (older Safari)
      media.addListener(onStoreChange)
      return () => media.removeListener(onStoreChange)
    },
    [query]
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
