/**
 * Rules for the booking history on a customer's profile (BK-092, customer bookings review of 24
 * October 2026). The profile used to call every event booking 'Booked', show the event's id as the
 * reference, list an event booking that also holds a table twice, and add cancelled hires to the
 * lifetime value. Kept here, apart from the page, so each rule has a test.
 */

/** The label and status key (for the badge colour) of an event booking. */
export function eventBookingStatus(
  status: string | null | undefined,
  reminderOnly: boolean
): { label: string; key: string } {
  if (reminderOnly) return { label: 'Reminder Only', key: 'reminder_only' }
  switch ((status ?? '').trim().toLowerCase()) {
    case 'confirmed':
      return { label: 'Booked', key: 'confirmed' }
    case 'completed':
      return { label: 'Completed', key: 'completed' }
    case 'cancelled':
      return { label: 'Cancelled', key: 'cancelled' }
    case 'expired':
      return { label: 'Expired', key: 'expired' }
    case 'pending_payment':
      return { label: 'Awaiting Payment', key: 'pending_payment' }
    case '':
      return { label: 'Unknown', key: 'unknown' }
    default: {
      const key = (status ?? '').trim().toLowerCase()
      const label = key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      return { label, key }
    }
  }
}

/** Each event booking's own reference: two bookings for one event no longer look the same. */
export function eventBookingReference(bookingId: string): string {
  return bookingId.slice(0, 8).toUpperCase()
}

const NOT_ATTENDING = new Set(['cancelled', 'expired'])

/** Seats that count towards the customer's event total: not reminders, not cancelled or expired. */
export function eventBookingSeatsCounted(booking: {
  seats: number | null
  is_reminder_only: boolean | null
  status: string | null
}): number {
  const seats = booking.seats ?? 0
  if (booking.is_reminder_only || seats <= 0) return 0
  if (NOT_ATTENDING.has((booking.status ?? '').toLowerCase())) return 0
  return seats
}

/** A cancelled private hire is no part of the customer's lifetime value. */
export function privateBookingCountsTowardValue(status: string | null | undefined): boolean {
  return (status ?? '').toLowerCase() !== 'cancelled'
}

/**
 * Table bookings made as part of an event booking, keyed by that event booking, so the profile
 * shows one row per event (with the table named there) instead of the same night twice.
 */
export function splitEventTableBookings<T extends { event_booking_id: string | null }>(
  tableBookings: T[],
  eventBookingIds: Set<string>
): { standalone: T[]; byEventBooking: Map<string, T[]> } {
  const standalone: T[] = []
  const byEventBooking = new Map<string, T[]>()
  for (const booking of tableBookings) {
    const eventBookingId = booking.event_booking_id
    if (eventBookingId && eventBookingIds.has(eventBookingId)) {
      const list = byEventBooking.get(eventBookingId) ?? []
      list.push(booking)
      byEventBooking.set(eventBookingId, list)
    } else {
      standalone.push(booking)
    }
  }
  return { standalone, byEventBooking }
}
