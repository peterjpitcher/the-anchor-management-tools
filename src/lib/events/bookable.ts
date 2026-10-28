/**
 * Whether an event can be booked online or by text reply right now (BK-035, BK-089; owner
 * decision D11). One rule for the public events API, the event booking route and reply-to-book,
 * and the same rule create_event_booking_v05 applies in the database to the sources 'brand_site'
 * and 'sms_reply'. Staff and FOH bookings are not limited by Accept bookings or the sales close
 * time, as decided; they are still refused on a cancelled, draft or postponed night.
 */

/** Statuses on which nobody can book, staff included. 'postponed' joined them in BK-089. */
export const NOT_BOOKABLE_EVENT_STATUSES = ['cancelled', 'draft', 'postponed'] as const

export type OnlineBookingClosedReason =
  | 'not_bookable'
  | 'booking_closed'
  | 'bookings_disabled'
  | 'sales_closed'
  | 'event_started'

export interface BookableEventFields {
  event_status?: string | null
  booking_open?: boolean | null
  bookings_enabled?: boolean | null
  booking_cutoff_at?: string | null
  start_datetime?: string | null
}

/** Why online and text-reply booking is closed for this event, or null when it is open. */
export function onlineBookingClosedReason(event: BookableEventFields, nowMs: number = Date.now()): OnlineBookingClosedReason | null {
  if ((NOT_BOOKABLE_EVENT_STATUSES as readonly string[]).includes(event.event_status ?? 'scheduled')) return 'not_bookable'
  if (event.booking_open === false) return 'booking_closed'
  if (event.bookings_enabled === false) return 'bookings_disabled'
  if (event.booking_cutoff_at) {
    const cutoffMs = Date.parse(event.booking_cutoff_at)
    if (Number.isFinite(cutoffMs) && cutoffMs <= nowMs) return 'sales_closed'
  }
  if (event.start_datetime) {
    const startMs = Date.parse(event.start_datetime)
    if (Number.isFinite(startMs) && startMs <= nowMs) return 'event_started'
  }
  return null
}
