/**
 * How an event's status, and the status of a booking for it, look on staff screens: the DS
 * Badge tone and the words. Pure module, safe to import from server and client components.
 *
 * Until 18 September 2026 the events list, the board cards and the event page each kept their
 * own copy of this map. The copies agreed, but nothing kept them agreeing, so one screen could
 * drift to a different colour for the same status. Render every event status chip as
 *   <Badge tone={eventStatusTone(status)} dot>{eventStatusLabel(status)}</Badge>
 * so an event looks the same wherever it appears.
 */

export type EventBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

// A Map rather than an object literal, so a status such as "constructor" can never resolve to
// an inherited Object property.
const EVENT_STATUS_TONES = new Map<string, EventBadgeTone>([
  ['scheduled', 'success'],
  ['cancelled', 'danger'],
  ['postponed', 'warning'],
  ['rescheduled', 'info'],
  ['sold_out', 'primary'],
])

export function eventStatusTone(status: string | null | undefined): EventBadgeTone {
  if (!status) return 'neutral'
  return EVENT_STATUS_TONES.get(status) ?? 'neutral'
}

/** "sold_out" reads as "Sold Out"; a missing status reads as "Unknown". */
export function eventStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// A booking for an event takes the booking colours the owner set on 18 September 2026 (D4):
// a booked place is the brand colour, one still waiting for payment is amber, and a cancelled
// one is quiet rather than red.
const EVENT_BOOKING_STATUS_TONES = new Map<string, EventBadgeTone>([
  ['confirmed', 'primary'],
  ['pending_payment', 'warning'],
  ['cancelled', 'neutral'],
])

export function eventBookingStatusTone(status: string | null | undefined): EventBadgeTone {
  if (!status) return 'neutral'
  return EVENT_BOOKING_STATUS_TONES.get(status) ?? 'neutral'
}
