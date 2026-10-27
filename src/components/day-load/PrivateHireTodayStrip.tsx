'use client'

import Link from 'next/link'
import { Alert } from '@/ds'
import type { DayLoadHire } from '@/services/day-load'

interface PrivateHireTodayStripProps {
  hires: DayLoadHire[]
  /** True when the day's hires could not be read; said plainly rather than shown as none. */
  loadFailed?: boolean
  /** Links to the booking (off on a shared kiosk screen). */
  withLinks?: boolean
}

function statusLabel(hire: DayLoadHire): string {
  if (hire.status === 'confirmed') return 'confirmed'
  return hire.holdsRoom ? 'held' : 'enquiry, not holding the room'
}

/**
 * Every draft and confirmed private hire on the day, for FOH and the kitchen (review BK-075): times,
 * rooms, guests, catering and the covers the kitchen counts. A hire with no room is listed too, and
 * says so: FOH cannot draw it as a block, so this is the only place it shows.
 */
export function PrivateHireTodayStrip({ hires, loadFailed, withLinks = true }: PrivateHireTodayStripProps): React.ReactElement | null {
  if (loadFailed) {
    return (
      <Alert tone="warning" title="Private hires not loaded">
        Today&apos;s private hires could not be loaded. Check the private bookings diary before service.
      </Alert>
    )
  }
  if (hires.length === 0) return null

  return (
    <Alert tone="info" title={hires.length === 1 ? 'Private hire today' : `Private hires today (${hires.length})`} role="status">
      <ul className="space-y-1">
        {hires.map((hire) => {
          const times = hire.startTime ? `${hire.startTime}${hire.endTime ? ` to ${hire.endTime}` : ''}` : 'Time not set'
          const rooms = hire.roomNames.length > 0 ? hire.roomNames.join(' and ') : 'No room booked'
          const guests = hire.guestCount ? `${hire.guestCount} ${hire.guestCount === 1 ? 'guest' : 'guests'}` : 'guest count not set'
          const details = [times, rooms, guests, ...hire.catering]
          if (hire.kitchen) details.push(`kitchen ${hire.kitchen.covers} ${hire.kitchen.covers === 1 ? 'cover' : 'covers'} at ${hire.kitchen.foodTime}`)
          return (
            <li key={hire.id}>
              {withLinks ? (
                <Link href={`/private-bookings/${hire.id}`} className="font-medium text-primary underline">
                  {hire.customerName}
                </Link>
              ) : (
                <span className="font-medium">{hire.customerName}</span>
              )}
              {` (${statusLabel(hire)}): ${details.join(', ')}`}
            </li>
          )
        })}
      </ul>
    </Alert>
  )
}
