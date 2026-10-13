/**
 * The self-catering and outside food agreement ("the waiver"): one rule for whether a booking
 * needs it, used by everything that shows or acts on it.
 *
 * A booking needs the waiver when outside food is coming. There are two ways the app learns
 * that: the "Outside food" tick on the booking, and a catering package flagged as needing the
 * waiver. Until 13 October 2026 only the package counted, so a booking with the tick and no
 * package printed a contract with no waiver, showed "not required" on the booking, and told
 * staff on the event sheet that no waiver was needed. The tick now counts everywhere.
 *
 * Pure, with no server imports, so client components can use it.
 */

export type BookingWaiverStatus = 'not_required' | 'required' | 'sent' | 'signed' | 'overdue'

const KNOWN_STATUSES: readonly BookingWaiverStatus[] = ['not_required', 'required', 'sent', 'signed', 'overdue']

/**
 * The waiver status to show and act on. The stored `waiver_status` wins once it says anything
 * other than "not required"; a booking with outside food ticked and a stored "not required" is
 * out of date, and reads as "required".
 */
export function effectiveWaiverStatus(booking: {
  outside_food?: boolean | null
  waiver_status?: string | null
}): BookingWaiverStatus {
  const stored = KNOWN_STATUSES.includes(booking.waiver_status as BookingWaiverStatus)
    ? (booking.waiver_status as BookingWaiverStatus)
    : 'not_required'
  if (stored === 'not_required' && booking.outside_food === true) return 'required'
  return stored
}

/** True while the waiver is owed and not yet signed. */
export function waiverIsOutstanding(booking: { outside_food?: boolean | null; waiver_status?: string | null }): boolean {
  const status = effectiveWaiverStatus(booking)
  return status === 'required' || status === 'sent' || status === 'overdue'
}
