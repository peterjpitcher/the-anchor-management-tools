import { formatHoldUntilLondon } from '@/lib/events/event-when'

/**
 * What the event page's bookings list says about each booking, and which buttons it offers
 * (owner request, 9 November 2026: each booking, its seats, the booker's phone, whether it is
 * paid, its status, when it was made and the actions, with guests' answers and mobiles out of
 * the list). Pure, so the rules are tested without rendering the page.
 */

export type EventBookingListRow = {
  status?: string | null
  seats?: number | null
  is_reminder_only?: boolean | null
  hold_expires_at?: string | null
  event_seating_type?: 'seated' | 'standing' | null
  attendees?: unknown[] | null
  attendee_names?: Array<string | null> | null
  paid_amount?: number | null
  payment_status_summary?: string | null
  payment_method_summary?: string | null
  ticket_breakdown?: string | null
}

/** The statuses staff can still change: everything else is lapsed, cancelled or after the night. */
const ACTIVE_STATUSES = new Set(['confirmed', 'pending_payment'])

function formatPounds(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/** "2 seats" or "2 standing": seated is the usual case on a communal night, so it goes unsaid. */
export function describeEventBookingSeats(booking: Pick<EventBookingListRow, 'seats' | 'event_seating_type'>): string {
  const seats = Number(booking.seats ?? 0)
  if (!Number.isFinite(seats) || seats <= 0) return '-'
  return booking.event_seating_type === 'standing' ? `${seats} standing` : String(seats)
}

/**
 * Whether the booking is paid, in words: "Paid £80.00 · PayPal", "Comp", "Refunded", "Not paid".
 * A night that takes money at the door or costs nothing has no payment to chase, so it says so
 * rather than "Not paid".
 */
export function describeEventBookingPayment(
  booking: EventBookingListRow,
  paymentMode: string | null | undefined,
): string {
  if (booking.is_reminder_only === true) return '-'
  const amount = Number(booking.paid_amount ?? 0)
  const method = booking.payment_method_summary ? ` · ${booking.payment_method_summary}` : ''
  if (Number.isFinite(amount) && amount > 0) {
    const status = booking.payment_status_summary || 'Paid'
    return `${status} ${formatPounds(amount)}${method}`
  }
  if (booking.payment_method_summary === 'Comp') return 'Comp'
  if (booking.payment_status_summary === 'Refunded') return `Refunded${method}`
  if (paymentMode === 'free') return 'Free'
  if (paymentMode === 'cash_only') return 'Pays on the night'
  return 'Not paid'
}

export type EventBookingStatusDisplay = {
  label: string
  /** "until Tue 10 Nov at 2:20pm" for a hold, so staff see how long a guest has to pay. */
  detail: string | null
}

/** The booking's status, with when a payment hold ends. */
export function describeEventBookingStatus(
  booking: Pick<EventBookingListRow, 'status' | 'hold_expires_at'>,
  now: Date = new Date(),
): EventBookingStatusDisplay {
  const status = booking.status ?? null
  if (!status) return { label: 'Unknown', detail: null }
  if (status === 'pending_payment') {
    const until = formatHoldUntilLondon(booking.hold_expires_at ?? null, now)
    const ended = booking.hold_expires_at ? Date.parse(booking.hold_expires_at) <= now.getTime() : false
    return {
      label: 'Waiting for payment',
      detail: until ? (ended ? `hold ended ${until}` : `until ${until}`) : null,
    }
  }
  return { label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), detail: null }
}

/** Whether staff can still change the booking (seats, payment, cancel). */
export function isChangeableEventBooking(booking: Pick<EventBookingListRow, 'status'>): boolean {
  return ACTIVE_STATUSES.has(String(booking.status ?? ''))
}

/**
 * Whether the seats can be edited directly. The server refuses a paid booking on a night paid in
 * advance, a booking with named guests and a booking with more than one ticket type (each goes
 * through Change Tickets), and anything that is not confirmed or waiting for payment
 * (status_not_changeable), so the list does not offer a button that can only fail.
 */
export function canEditEventBookingSeats(
  booking: EventBookingListRow,
  paymentMode: string | null | undefined,
): boolean {
  if (!isChangeableEventBooking(booking)) return false
  if (booking.status === 'confirmed' && booking.is_reminder_only !== true && paymentMode === 'prepaid') return false
  if (Array.isArray(booking.attendees) && booking.attendees.length > 0) return false
  if (booking.ticket_breakdown) return false
  return true
}

/** Whether the booking has guest details to show, or should have some on this event. */
export function hasEventBookingGuestDetails(
  booking: Pick<EventBookingListRow, 'attendees' | 'attendee_names' | 'is_reminder_only'>,
  eventTakesGuestDetails: boolean,
): boolean {
  if (booking.is_reminder_only === true) return false
  if (Array.isArray(booking.attendees) && booking.attendees.length > 0) return true
  if ((booking.attendee_names ?? []).some((name) => typeof name === 'string' && name.trim().length > 0)) return true
  return eventTakesGuestDetails
}
