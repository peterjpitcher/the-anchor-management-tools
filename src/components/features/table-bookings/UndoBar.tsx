'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/ds'
import { cn } from '@/lib/utils'

/** How long an Undo stays on offer after a one-tap floor action. */
export const UNDO_WINDOW_MS = 10_000

export type UndoOffer = {
  /** Changes with every new offer, so the countdown restarts. */
  id: number
  bookingId: string
  /** What just happened, in the words staff would use: "Smith marked as left". */
  label: string
  /** The undo ticket the action answered with; sent back to the undo route as it is. */
  ticket: Record<string, unknown>
}

/**
 * The 10 second Undo that follows Seated, Left and No-show on the floor screens, in place of a
 * confirm box (owner decision, 22 November 2026). The action has already been saved; Undo puts it
 * back. It counts down in whole seconds and then takes itself away.
 *
 * `floating` pins it to the bottom of the screen, above the page and clear of any dialog, for the
 * floor iPad. Without it the bar sits in the flow of whatever holds it.
 */
export function UndoBar({
  offer,
  busy = false,
  floating = false,
  onUndo,
  onExpire,
}: {
  offer: UndoOffer
  busy?: boolean
  floating?: boolean
  onUndo: () => void
  onExpire: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(UNDO_WINDOW_MS / 1000))

  // Read through a ref so a parent re-render never restarts the second in progress.
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    // While the undo itself is being sent the offer must not vanish from under the tap.
    if (busy) return
    if (secondsLeft <= 0) {
      onExpireRef.current()
      return
    }
    const timer = window.setTimeout(() => setSecondsLeft((current) => current - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [secondsLeft, busy])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface px-4 py-2 shadow-lg',
        floating && 'fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl'
      )}
    >
      <p className="min-w-0 text-sm font-medium text-text">{offer.label}</p>
      <Button
        type="button"
        variant="primary"
        size="lg"
        disabled={busy}
        onClick={onUndo}
        className="min-h-touch min-w-28 shrink-0"
      >
        {busy ? 'Undoing...' : `Undo (${Math.max(secondsLeft, 0)})`}
      </Button>
    </div>
  )
}
