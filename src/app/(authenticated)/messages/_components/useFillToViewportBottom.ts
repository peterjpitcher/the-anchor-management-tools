'use client'

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'
import { SHELL_MEDIA_QUERY } from '@/ds'

/**
 * The inbox is a full-height screen: the conversation list, thread and composer fill the window
 * under the page header, and only the panes scroll. PageLayout sizes to its content, so the
 * inbox card measures the room left below its own top edge and takes exactly that, never less
 * than `minHeight` (below it the page scrolls rather than crushing the inbox to a header row).
 *
 * Phones: the shell is one viewport tall and `<main>` is the scroll area, so the room is main's
 * height less its bottom padding. Desktop: the document scrolls, so the room is the window height
 * less main's bottom padding. Both are measured from the top of the scrolled content, so a
 * measurement taken mid-scroll gives the same answer.
 *
 * This replaces a wrapper that made the whole page one viewport tall. PageLayout cannot be
 * given that height (it takes no layout classes), so the card measures instead. `deps` lists
 * anything above the card that changes its position, such as a banner appearing.
 */
export function useFillToViewportBottom(
  ref: RefObject<HTMLElement | null>,
  minHeight: number,
  deps: ReadonlyArray<unknown> = [],
): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined)

  const measure = useCallback(() => {
    const element = ref.current
    if (!element || typeof window === 'undefined') return

    const main = element.closest('main')
    const bottomPadding = main ? parseFloat(window.getComputedStyle(main).paddingBottom) || 0 : 0
    const phoneLayout =
      typeof window.matchMedia === 'function' && window.matchMedia(SHELL_MEDIA_QUERY).matches
    const top = element.getBoundingClientRect().top

    let available: number
    if (phoneLayout && main) {
      const mainTop = main.getBoundingClientRect().top
      const offsetInMain = top - mainTop + main.scrollTop
      available = main.clientHeight - bottomPadding - offsetInMain
    } else {
      available = window.innerHeight - bottomPadding - (top + window.scrollY)
    }

    setHeight(Math.max(minHeight, Math.floor(available)))
    // `deps` is spread so a change above the card triggers a fresh measurement.
  }, [minHeight, ref, ...deps])

  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return height
}
