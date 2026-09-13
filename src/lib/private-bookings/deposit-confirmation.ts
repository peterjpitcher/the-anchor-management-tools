import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import { computeHoldExpiry } from '@/services/private-bookings/types'

/**
 * Deposits confirmed by staff (owner decision, 11 September 2026; messaging flag
 * private_booking_deposit_confirmation).
 *
 * While the flag is on, creating a booking tells the guest nothing about a deposit. The deposit
 * is "to be confirmed" until a member of staff confirms the amount, which sends the guest one
 * deposit request. Until then no deposit reminder, automatic hold expiry, hold-lapsed or
 * hold-extended message may go, because the guest has not been told a deposit or a deadline.
 *
 * Kept free of server imports so the booking page can read the same rule.
 */

export type DepositConfirmationFields = {
  status?: string | null
  deposit_amount?: number | string | null
  deposit_paid_date?: string | null
  deposit_waived?: boolean | null
  deposit_confirmed_at?: string | null
}

/**
 * True when the booking owes a deposit whose amount has not been confirmed to the guest.
 *
 * Only a booking that still owes a deposit can be waiting: draft or confirmed, not paid, not
 * waived, more than £0. The confirmation must be exactly null. A row read without the column
 * (before the migration, or by a query that does not name it) counts as confirmed, which is how
 * every booking behaved before this change.
 */
export function isDepositAwaitingConfirmation(booking: DepositConfirmationFields): boolean {
  if (booking.status !== 'draft' && booking.status !== 'confirmed') return false
  if (booking.deposit_paid_date) return false
  if (booking.deposit_waived === true) return false
  const amount = Number(booking.deposit_amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return false
  return booking.deposit_confirmed_at === null
}

/**
 * The hold expiry that confirming a deposit sets, as an ISO instant, or null for no deadline.
 *
 * - A booking whose date is still to be confirmed gets no hold, exactly as when it is created.
 * - A hold still in the future is kept: the space is held until then, and staff chose it (or the
 *   booking form defaulted it) when the booking was made.
 * - Otherwise the rule the system has always used when a booking is created, computeHoldExpiry:
 *   14 days from now, capped at the balance and final-details deadline (14 days before the event),
 *   or, once that deadline has passed, 48 hours from now capped at the start of the event day.
 */
export function resolveConfirmationHoldExpiry(
  booking: {
    event_date?: string | null
    hold_expiry?: string | null
    date_tbd?: boolean | null
    internal_notes?: string | null
  },
  now: Date
): string | null {
  if (!booking.event_date || isBookingDateTbd(booking)) return null

  const current = booking.hold_expiry ? Date.parse(booking.hold_expiry) : Number.NaN
  if (Number.isFinite(current) && current > now.getTime()) {
    return new Date(current).toISOString()
  }

  return computeHoldExpiry(new Date(booking.event_date), now).toISOString()
}
