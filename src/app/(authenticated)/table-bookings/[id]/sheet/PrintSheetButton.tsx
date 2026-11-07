'use client'

import { useEffect } from 'react'
import { Button } from '@/ds'

/**
 * Prints the booking sheet from a laptop (owner request, 7 November 2026). The app shell and the
 * page header are hidden in print, so the paper copy is the one-pager alone. Only people who may
 * have a paper copy are given this button; the sheet's own print stylesheet still blanks the page
 * for the shared front-of-house login.
 *
 * PageLayout mounts header actions twice (a phone header and a desktop one), so this button must
 * not print by itself: that is AutoPrintSheet's job, mounted once in the page body.
 */
export function PrintSheetButton(): React.ReactElement {
  return (
    <Button variant="primary" size="sm" onClick={() => window.print()}>
      Print
    </Button>
  )
}

/** Opens the print window once, as soon as the sheet has rendered (`?print=1`). Renders nothing. */
export function AutoPrintSheet(): null {
  useEffect(() => {
    // Runs once per mount. No "already printed" flag: React's development double run cancels the
    // first frame in the cleanup, and a flag would then stop the second from printing at all.
    // One frame after paint, so the dialog previews the finished sheet rather than a blank page.
    const frame = window.requestAnimationFrame(() => window.print())
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return null
}
