import { DATE_TBD_NOTE } from '@/services/private-bookings/types'

type BookingLike = {
  date_tbd?: boolean | null
  internal_notes?: string | null
}

/**
 * Returns true when the booking should be treated as date-TBD.
 * Primary signal: the `date_tbd` column on `private_bookings`.
 * Fallback: the legacy `DATE_TBD_NOTE` convention in `internal_notes`
 * (for records that predate the column).
 *
 * Used by:
 *  - cron passes (skip date-based reminders)
 *  - Communications tab (label scheduled section)
 *  - SMS messages, contracts, payment emails, list/detail pages
 */
export function isBookingDateTbd(booking: BookingLike): boolean {
  // Primary: explicit column
  if (booking?.date_tbd === true) return true

  // Fallback: legacy notes convention
  if (booking?.internal_notes?.includes(DATE_TBD_NOTE)) return true

  return false
}
