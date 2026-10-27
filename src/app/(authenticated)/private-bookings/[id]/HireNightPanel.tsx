'use client'

import Link from 'next/link'
import { Alert } from '@/ds'
import { formatTimeInLondon } from '@/lib/dateUtils'
import type { HireDinerClash, HireNightView } from '@/services/private-bookings/night-clashes'

interface HireNightPanelProps {
  view: HireNightView | null
  /** True when the page could not check the night; said plainly rather than shown as clear. */
  loadFailed?: boolean
}

function clashTimes(clash: HireDinerClash): string {
  const start = new Date(clash.startsAt)
  const end = new Date(clash.endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return ''
  return `${formatTimeInLondon(start)} to ${formatTimeInLondon(end)}`
}

function describeMode(mode: string | null): string {
  switch (mode) {
    case 'general':
      return 'general admission'
    case 'communal':
      return 'shared seating'
    case 'mixed':
      return 'tables and general admission'
    case 'table':
      return 'table seats'
    default:
      return 'event'
  }
}

/**
 * What else is booked in this hire's rooms that night (review BK-070 and BK-071, owner decision
 * D24): diners and event places already on its tables, and events on the same date. Nothing here
 * is refused; staff decide what to do with each one. A whole-pub hire that holds its room stops
 * ticket sales for an event it overlaps, which the list says.
 */
export function HireNightPanel({ view, loadFailed }: HireNightPanelProps): React.ReactElement | null {
  if (loadFailed) {
    return (
      <Alert tone="warning" title="Night not checked">
        We could not check this hire&apos;s rooms for table bookings, event seats or events that night. Refresh the page
        before confirming it.
      </Alert>
    )
  }
  if (!view) return null

  const hasClashes = view.dinerClashes.length > 0
  const hasEvents = view.events.length > 0
  // BK-076, D24: the pub or the kitchen shut on the hire's date is said, not refused.
  const closedDay = view.hours?.closed === true
  const kitchenClosedForCatering = !closedDay && view.hours?.kitchenClosed === true && view.hasCatering
  if (!hasClashes && !hasEvents && !closedDay && !kitchenClosedForCatering) return null

  return (
    <>
      {closedDay && (
        <Alert tone="warning" title="Closed on this date">
          The pub is closed on this hire&apos;s date. Check the opening hours, or the date, before going ahead.
        </Alert>
      )}
      {kitchenClosedForCatering && (
        <Alert tone="warning" title="Kitchen closed on this date">
          The kitchen is closed on this hire&apos;s date, but catering is booked on it.
        </Alert>
      )}

      {hasClashes && (
        <Alert tone="warning" title="Clashes on this night">
          <p>
            These bookings sit on tables in this hire&apos;s rooms while it holds them, including time to set up and clear
            down. Nothing has been cancelled or moved: decide what to do with each one.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {view.dinerClashes.map((clash) => {
              const key = clash.tableBookingId ?? clash.eventBookingId ?? `${clash.startsAt}-${clash.tableNames}`
              const who = clash.guestName ?? 'Guest'
              const size = clash.kind === 'event_seats'
                ? `${clash.covers} ${clash.covers === 1 ? 'place' : 'places'}`
                : `${clash.covers} ${clash.covers === 1 ? 'guest' : 'guests'}`
              const label = clash.kind === 'event_seats'
                ? `${clash.eventName ?? 'Event'}: ${who}, ${size}`
                : `${clash.reference ?? 'Table booking'}: ${who}, ${size}${clash.eventName ? ` (${clash.eventName})` : ''}`
              const href = clash.kind === 'event_seats'
                ? (clash.eventId ? `/events/${clash.eventId}` : null)
                : (clash.tableBookingId ? `/table-bookings/${clash.tableBookingId}` : null)
              return (
                <li key={key}>
                  {href ? (
                    <Link href={href} className="text-primary underline">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                  {', '}
                  {clashTimes(clash)}
                  {clash.tableNames ? `, ${clash.tableNames}` : ''}
                </li>
              )
            })}
          </ul>
        </Alert>
      )}

      {hasEvents && (
        <Alert tone="info" title="Events on this date" role="status">
          <ul className="list-disc space-y-1 pl-5">
            {view.events.map((event) => (
              <li key={event.id}>
                <Link href={`/events/${event.id}`} className="text-primary underline">
                  {event.name}
                </Link>
                {event.time ? ` at ${event.time}` : ''}, {describeMode(event.bookingMode)},{' '}
                {event.ticketsSold} {event.ticketsSold === 1 ? 'ticket' : 'tickets'} sold.
                {event.closedByThisHire && view.holdsRoom && ' Ticket sales have stopped because this hire takes the whole pub.'}
                {event.closedByThisHire && !view.holdsRoom &&
                  ' Ticket sales will stop once this whole-pub hire is confirmed or its deposit is paid.'}
                {event.salesStopped && !event.closedByThisHire && ' Ticket sales have stopped because another whole-pub hire takes the night.'}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  )
}
