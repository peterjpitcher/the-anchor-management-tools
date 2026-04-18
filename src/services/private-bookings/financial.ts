import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Possible financial outcomes when cancelling a private booking.
 *
 * - `no_money` — nothing has been paid yet (no deposit, no balance). Customer
 *   loses nothing and is simply told the hold is gone.
 * - `refundable` — balance payment(s) exist and can be refunded. Deposit is
 *   always retained per policy (see `getPrivateBookingCancellationOutcome`).
 * - `non_refundable_retained` — only the deposit has been paid. Deposit is
 *   non-refundable per booking terms, so the retained amount is disclosed.
 * - `manual_review` — there is something unusual (an open dispute/chargeback
 *   noted on a payment) and a human must decide. Customer is told a team
 *   member will be in touch.
 */
export type CancellationFinancialOutcome =
  | 'no_money'
  | 'refundable'
  | 'non_refundable_retained'
  | 'manual_review'

export type PrivateBookingPaidTotals = {
  deposit_paid: number
  balance_payments_total: number
  total_paid: number
  has_open_dispute: boolean
}

export type PrivateBookingCancellationOutcome = {
  outcome: CancellationFinancialOutcome
  refund_amount: number
  retained_amount: number
}

/**
 * Compute the paid totals for a private booking.
 *
 * `deposit_paid` is sourced from `private_bookings.deposit_amount` and is only
 * counted when `deposit_paid_date` is set (i.e. the deposit has actually
 * landed). `balance_payments_total` sums every row in
 * `private_booking_payments` (these are non-deposit top-up payments recorded
 * after the deposit).
 *
 * Dispute detection is primary-signal based: any payment note containing
 * `dispute` or `chargeback` (case-insensitive, word boundary) flips
 * `has_open_dispute` to true. When a dedicated dispute/chargeback webhook
 * table exists this should be replaced with a proper lookup.
 */
export async function getPrivateBookingPaidTotals(
  bookingId: string,
): Promise<PrivateBookingPaidTotals> {
  const db = createAdminClient()

  const { data: booking, error: bookingError } = await db
    .from('private_bookings')
    .select('deposit_amount, deposit_paid_date')
    .eq('id', bookingId)
    .single()

  if (bookingError || !booking) {
    logger.error('getPrivateBookingPaidTotals: booking not found', {
      metadata: { bookingId, error: bookingError?.message ?? null },
    })
    return {
      deposit_paid: 0,
      balance_payments_total: 0,
      total_paid: 0,
      has_open_dispute: false,
    }
  }

  const depositPaid = booking.deposit_paid_date
    ? Number(booking.deposit_amount ?? 0)
    : 0

  const { data: payments, error: paymentsError } = await db
    .from('private_booking_payments')
    .select('amount, notes')
    .eq('booking_id', bookingId)

  if (paymentsError) {
    logger.error('getPrivateBookingPaidTotals: failed to load payments', {
      metadata: { bookingId, error: paymentsError.message ?? null },
    })
  }

  const balancePaymentsTotal = (payments ?? []).reduce(
    (sum, p) => sum + Number(p?.amount ?? 0),
    0,
  )

  // Dispute detection: look for payment notes containing "dispute" or
  // "chargeback" at word boundaries, case-insensitive. If a product has a
  // dedicated dispute/chargeback table or Stripe webhook persistence, replace
  // the regex detection with a proper lookup.
  const hasOpenDispute = (payments ?? []).some(
    (p) =>
      typeof p?.notes === 'string' && /\b(dispute|chargeback)\b/i.test(p.notes),
  )

  return {
    deposit_paid: depositPaid,
    balance_payments_total: balancePaymentsTotal,
    total_paid: depositPaid + balancePaymentsTotal,
    has_open_dispute: hasOpenDispute,
  }
}

/**
 * Derive the cancellation financial outcome for a private booking.
 *
 * Policy (A5): Deposit is ALWAYS non-refundable on cancellation. Balance
 * payments ARE refundable unless there is an open dispute, in which case the
 * decision is escalated to manual review.
 *
 * Precedence:
 *   1. `has_open_dispute` → `manual_review`
 *   2. nothing paid → `no_money`
 *   3. only deposit paid → `non_refundable_retained`
 *   4. balance paid → `refundable`
 */
export async function getPrivateBookingCancellationOutcome(
  bookingId: string,
): Promise<PrivateBookingCancellationOutcome> {
  const totals = await getPrivateBookingPaidTotals(bookingId)

  if (totals.has_open_dispute) {
    return {
      outcome: 'manual_review',
      refund_amount: 0,
      retained_amount: totals.total_paid,
    }
  }

  if (totals.total_paid === 0) {
    return { outcome: 'no_money', refund_amount: 0, retained_amount: 0 }
  }

  // Only deposit paid → fully retained (policy: deposit non-refundable).
  if (totals.balance_payments_total === 0) {
    return {
      outcome: 'non_refundable_retained',
      refund_amount: 0,
      retained_amount: totals.deposit_paid,
    }
  }

  // Balance payments exist → refund balance, retain deposit.
  return {
    outcome: 'refundable',
    refund_amount: totals.balance_payments_total,
    retained_amount: totals.deposit_paid,
  }
}
