'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/ds'

interface PrintSheetButtonProps {
  /** Open the browser's print window once, as soon as the sheet has rendered (`?print=1`). */
  autoPrint?: boolean
}

/**
 * Prints the booking sheet from a laptop (owner request, 7 November 2026). The app shell and the
 * page header are hidden in print, so the paper copy is the one-pager alone. Only people who may
 * have a paper copy are given this button; the sheet's own print stylesheet still blanks the page
 * for the shared front-of-house login.
 */
export function PrintSheetButton({ autoPrint = false }: PrintSheetButtonProps): React.ReactElement {
  const printedRef = useRef(false)

  useEffect(() => {
    if (!autoPrint || printedRef.current) return
    printedRef.current = true
    // One frame after paint, so the dialog previews the finished sheet rather than a blank page.
    const frame = window.requestAnimationFrame(() => window.print())
    return () => window.cancelAnimationFrame(frame)
  }, [autoPrint])

  return (
    <Button variant="primary" size="sm" onClick={() => window.print()}>
      Print
    </Button>
  )
}
