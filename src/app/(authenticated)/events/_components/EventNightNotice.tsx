'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Alert } from '@/ds'
import { getEventNightNotice, type EventNightNotice as Notice } from '@/app/actions/venue-night'

interface EventNightNoticeProps {
  /** The date chosen on the form, YYYY-MM-DD. */
  date: string | null | undefined
  /** The saved event, to say whether its ticket sales are stopped. Omit for a new event. */
  eventId?: string | null
}

function describeHire(hire: Notice['hires'][number]): string {
  const rooms = hire.roomNames.length > 0 ? hire.roomNames.join(' and ') : 'No room booked yet'
  const times = hire.startTime ? `, ${hire.startTime}${hire.endTime ? ` to ${hire.endTime}` : ''}` : ''
  const guests = hire.guestCount ? `, ${hire.guestCount} ${hire.guestCount === 1 ? 'guest' : 'guests'}` : ''
  const status = hire.status === 'confirmed' ? 'confirmed' : hire.holdsRoom ? 'held' : 'enquiry'
  return `${rooms}${times}${guests} (${status})`
}

/**
 * Private hires on an event's date (review BK-071, owner decision D24), shown on the event form as
 * the date is chosen and on the event page. Events have no room of their own, so this is the only
 * place staff see that a party has the room, or the whole pub, that night. A whole-pub hire that
 * holds its room stops ticket sales for an event it overlaps.
 */
export function EventNightNotice({ date, eventId }: EventNightNoticeProps): React.ReactElement | null {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setNotice(null)
    setFailed(false)
    if (!date) return () => { cancelled = true }
    getEventNightNotice(date, eventId ?? null)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data) setNotice(result.data)
        else setFailed(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [date, eventId])

  if (failed) {
    return (
      <Alert tone="warning" title="Private hires not checked">
        We could not check for private hires on this date. Look at the private bookings diary before going ahead.
      </Alert>
    )
  }
  if (!notice) return null

  const wholePub = notice.hires.filter((hire) => hire.wholePub)
  if (notice.hires.length === 0 && !notice.ticketSalesStopped) return null

  return (
    <Alert tone={wholePub.length > 0 || notice.ticketSalesStopped ? 'warning' : 'info'} title="Private hire on this date">
      {notice.ticketSalesStopped && (
        <p className="mb-1 font-medium">
          Ticket sales for this event have stopped: a whole-pub private hire takes the night.
        </p>
      )}
      {notice.hires.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {notice.hires.map((hire) => (
            <li key={hire.id}>
              <Link href={`/private-bookings/${hire.id}`} className="text-primary underline">
                {describeHire(hire)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {wholePub.length > 0 && !notice.ticketSalesStopped && (
        <p className="mt-1">
          A whole-pub hire stops ticket sales for any event it overlaps once it is confirmed or its deposit is paid.
        </p>
      )}
    </Alert>
  )
}
