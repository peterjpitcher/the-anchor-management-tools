'use client'

import React from 'react'
import { Button, SubHeading } from '@/ds'
import { cn } from '@/lib/utils'
import type { FohBooking, FohStyleVariant } from '../types'
import { formatFohClock, isFohEventLinkedBooking } from '../utils'

/**
 * Today's no-shows, greyed, with 'Undo no-show' (owner decision, 22 November 2026). They used to
 * vanish from the screen the moment they were marked, so a guest who turned up late could not be
 * found. They are listed for the day they happened only: the server sends none for any other day,
 * so they cannot pile up.
 */
export const FohNoShowList = React.memo(function FohNoShowList({
  bookings,
  canEdit,
  busyBookingId,
  styleVariant,
  onUndo,
}: {
  bookings: FohBooking[]
  canEdit: boolean
  /** The booking whose undo is being sent, so only its button shows as working. */
  busyBookingId: string | null
  styleVariant: FohStyleVariant
  onUndo: (booking: FohBooking) => void
}) {
  if (bookings.length === 0) return null
  const isManagerKioskStyle = styleVariant === 'manager_kiosk'

  return (
    <section
      aria-label="No-shows today"
      className={cn('rounded-lg border border-border bg-surface-2', isManagerKioskStyle ? 'p-2' : 'p-4')}
    >
      <SubHeading as="h3" className="text-text-muted">No-shows today ({bookings.length})</SubHeading>
      <ul className="mt-2 flex flex-wrap gap-2">
        {bookings.map((booking) => {
          const eventLinked = isFohEventLinkedBooking(booking)
          const busy = busyBookingId === booking.id
          return (
            <li
              key={booking.id}
              className="flex min-h-touch items-center gap-3 rounded-default border border-border bg-surface px-3 py-1"
            >
              <span className="text-sm text-text-muted">
                <span className="font-semibold line-through">{booking.guest_name || booking.booking_reference || 'Booking'}</span>
                {' · '}
                {booking.party_size || 1} people · {formatFohClock(booking.booking_time)} · No-show
              </span>
              {canEdit && !eventLinked && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={Boolean(busyBookingId)}
                  onClick={() => onUndo(booking)}
                  className="min-h-touch"
                >
                  {busy ? 'Putting back...' : 'Undo no-show'}
                </Button>
              )}
              {eventLinked && <span className="text-sm text-text-muted">Put back from the event</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
})
