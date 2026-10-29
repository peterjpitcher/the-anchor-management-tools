'use client'

import { useEffect, useState } from 'react'
import { Alert } from '@/ds'
import { getEventChangesAfterFirstBooking, type EventChangeAfterBooking } from '@/app/actions/event-lifecycle'
import { formatDateTime12Hour } from '@/lib/dateUtils'

/**
 * "Changed after the first booking": every edit to the event or its tickets made once guests had
 * booked, so a dispute about a price or a date can be answered from the page (BK-139). Shows
 * nothing when there are none.
 */
export function EventChangesAfterBookingCard({ eventId }: { eventId: string }) {
  const [changes, setChanges] = useState<EventChangeAfterBooking[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    getEventChangesAfterFirstBooking(eventId).then((result) => {
      if (!live) return
      if (result.error) { setFailed(true); return }
      setChanges(result.data ?? [])
    })
    return () => { live = false }
  }, [eventId])

  if (failed) return <Alert tone="warning" size="sm">Changes made after the first booking could not be loaded.</Alert>
  if (!changes || changes.length === 0) return null
  return (
    <Alert tone="info" title="Changed after the first booking">
      <ul className="space-y-1">
        {changes.map((change) => (
          <li key={`${change.at}-${change.fields.join(',')}`}>
            {formatDateTime12Hour(change.at)}: {change.fields.length > 0 ? change.fields.join(', ') : 'details'}{change.by ? ` (${change.by})` : ''}
          </li>
        ))}
      </ul>
    </Alert>
  )
}
