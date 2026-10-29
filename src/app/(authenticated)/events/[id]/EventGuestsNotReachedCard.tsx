'use client'

import { useEffect, useState } from 'react'
import { Alert } from '@/ds'
import { getEventGuestsNotReached, type EventGuestsNotReached } from '@/app/actions/event-lifecycle'
import type { EventBookingRow } from '@/app/actions/events'
import { formatDateTime12Hour } from '@/lib/dateUtils'

const KIND_LABEL: Record<EventGuestsNotReached['kind'], string> = {
  postpone: 'postponement',
  reschedule: 'new date',
  cancel_event: 'cancellation',
}

/**
 * The guests the latest postponement, new date or cancellation notice could not reach by email or
 * text, with their numbers, so staff can ring them (BK-089). Shows nothing when everyone was told.
 */
export function EventGuestsNotReachedCard({ eventId, bookings }: { eventId: string; bookings: EventBookingRow[] }) {
  const [result, setResult] = useState<EventGuestsNotReached | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    getEventGuestsNotReached(eventId).then((response) => {
      if (!live) return
      if (response.error) { setFailed(true); return }
      setResult(response.data ?? null)
    })
    return () => { live = false }
  }, [eventId])

  if (failed) return <Alert tone="warning" size="sm">Could not check which guests were not told about the latest change.</Alert>
  if (!result) return null
  const byId = new Map(bookings.map((booking) => [booking.id, booking]))
  return (
    <Alert tone="warning" title={`${result.bookingIds.length === 1 ? '1 guest was' : `${result.bookingIds.length} guests were`} not told about the ${KIND_LABEL[result.kind]}`}>
      <p>No email or text reached them on {formatDateTime12Hour(result.at)}. Ring them:</p>
      <ul className="mt-1 space-y-1">
        {result.bookingIds.map((id) => {
          const booking = byId.get(id)
          const customer = booking?.customer
          const name = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') : null
          return (
            <li key={id}>
              {name || `Booking ${id.slice(0, 8)}`}{customer?.mobile_number ? `, ${customer.mobile_number}` : ', no phone on record'}
            </li>
          )
        })}
      </ul>
    </Alert>
  )
}
