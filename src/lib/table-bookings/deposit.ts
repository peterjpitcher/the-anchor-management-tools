/**
 * Centralised deposit helper for table bookings.
 *
 * Single source of truth for the 10+ deposit threshold and £10/person rate. Any
 * code path that decides "does this booking require a deposit" or "what amount"
 * MUST go through these helpers — duplicating the rule elsewhere is a footgun
 * (the threshold has changed twice already and we don't want a third drift).
 *
 * Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
 *           §7.3 (deposit helper design), §7.4 (lock-amount design).
 */

export const LARGE_GROUP_DEPOSIT_PER_PERSON_GBP = 10;
export const LARGE_GROUP_DEPOSIT_THRESHOLD = 10;

export type DepositOptions = {
  depositWaived?: boolean;
};

/**
 * Returns true when a deposit must be charged for a booking of the given party size.
 * Preserves the existing `p_deposit_waived` semantics — a manager-level waiver
 * always wins regardless of party size.
 */
export function requiresDeposit(partySize: number, opts: DepositOptions = {}): boolean {
  if (opts.depositWaived === true) return false;
  return partySize >= LARGE_GROUP_DEPOSIT_THRESHOLD;
}

/**
 * Computes a fresh deposit amount from party size only. Returns 0 when no deposit is required.
 * Use this only when there is no prior amount (locked or stored) on the booking.
 */
export function computeDepositAmount(partySize: number, opts: DepositOptions = {}): number {
  if (!requiresDeposit(partySize, opts)) return 0;
  return partySize * LARGE_GROUP_DEPOSIT_PER_PERSON_GBP;
}

/**
 * Booking shape for the canonical-deposit reader. Intentionally narrow — accepts any object
 * with the relevant fields so it works for partial selects.
 */
export type BookingForDeposit = {
  party_size: number;
  deposit_amount?: number | string | null;
  deposit_amount_locked?: number | string | null;
  status?: string | null;
  payment_status?: string | null;
  deposit_waived?: boolean | null;
};

const PAYMENT_REQUIRED_STATES = new Set(['pending_payment']);
const PAYMENT_REQUIRED_PAYMENT_STATUSES = new Set(['pending', 'completed']);

function toNumberOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns the canonical deposit amount for a booking. Read priority:
 *   1. deposit_amount_locked (always wins — paid bookings are immutable)
 *   2. stored deposit_amount when the booking is in a payment-required state
 *   3. fresh compute via requiresDeposit + party size, or 0 if not required
 */
export function getCanonicalDeposit(
  booking: BookingForDeposit,
  partySizeOverride?: number,
): number {
  const locked = toNumberOrNull(booking.deposit_amount_locked);
  if (locked !== null) return locked;

  const stored = toNumberOrNull(booking.deposit_amount);
  const status = booking.status ?? '';
  const paymentStatus = booking.payment_status ?? '';
  const isPaymentRequiredState =
    PAYMENT_REQUIRED_STATES.has(status) ||
    PAYMENT_REQUIRED_PAYMENT_STATUSES.has(paymentStatus);

  if (stored !== null && isPaymentRequiredState) {
    return stored;
  }

  const partySize = partySizeOverride ?? booking.party_size;
  return computeDepositAmount(partySize, { depositWaived: booking.deposit_waived === true });
}

/**
 * Convenience helper used by capture surfaces that need to write the lock.
 * Callers pass the actually-captured amount from the payment provider.
 */
export type LockDepositArgs = {
  bookingId: string;
  amount: number;
};
