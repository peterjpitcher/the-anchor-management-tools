import { DATE_TBD_NOTE } from '@/services/private-bookings/types'

type BookingLike = {
  internal_notes?: string | null
}

/**
 * Returns true when the booking should be treated as date-TBD.
 * Current convention encodes this in internal_notes by including DATE_TBD_NOTE.
 *
 * Used by:
 *  - cron passes (skip date-based reminders)
 *  - Communications tab (label scheduled section)
 */
export function isBookingDateTbd(booking: BookingLike): boolean {
  if (!booking?.internal_notes) return false
  return booking.internal_notes.includes(DATE_TBD_NOTE)
}
