import { useEffect, useState } from 'react'

/**
 * Custom hook for responsive design with media queries
 * @param query - Media query string (e.g., '(min-width: 768px)')
 * @returns boolean indicating if the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    
    // Set initial value
    setMatches(media.matches)

    // Create event listener
    const listener = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }

    // Add event listener
    if (media.addListener) {
      media.addListener(listener)
    } else {
      media.addEventListener('change', listener)
    }

    // Clean up
    return () => {
      if (media.removeListener) {
        media.removeListener(listener)
      } else {
        media.removeEventListener('change', listener)
      }
    }
  }, [query])

  return matches
}

// Preset breakpoints matching Tailwind defaults
export function useIsMobile() {
  return !useMediaQuery('(min-width: 640px)')
}

export function useIsTablet() {
  return useMediaQuery('(min-width: 640px)') && !useMediaQuery('(min-width: 1024px)')
}

export function useIsDesktop() {
  return useMediaQuery('(min-width: 1024px)')
}