import { createStripeRefund } from '@/lib/payments/stripe'
import { PAYPAL_DEFAULT_CURRENCY, refundPayPalPayment } from '@/lib/paypal'
import { createClient } from '@/lib/supabase/server'
import { AuditService } from '@/services/audit'
import { logger } from '@/lib/logger'
import { getTodayIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { resolveSeasonalDepositRefund } from './deposit-refund'

type RefundTier = 'full' | 'half' | 'none'

export type RefundResult =
  | {
      refunded: false
      /**
       * `terms_unreadable` means the seasonal refund snapshot could not be read, so nothing was
       * refunded on purpose. It is a refusal, not a "no deposit found": a person has to look.
       *
       * `refund_failed` means a deposit WAS paid and we tried to return it and could not. It is the
       * one reason that means money is owed, so it must never be reported to the guest as if no
       * deposit existed.
       */
      reason: 'no_deposit' | 'zero_tier' | 'already_refunded' | 'terms_unreadable' | 'refund_failed'
      /** True when the guest has money with us that this call did not return. */
      depositOwed?: boolean
      /** Pence still held, when known, so the caller can say so. */
      amountOwedPence?: number
    }
  | { refunded: true; amountPence: number; refundId: string; tier: RefundTier }

/**
 * Returns the refund tier based on days until the booking.
 * - 7+ days: 100% (full)
 * - 3–6 days: 50% (half)
 * - <3 days: 0% (none)
 */
function calculateRefundTier(bookingDate: Date): { percent: number; tier: RefundTier } {
  // Compare Europe/London calendar days — server-local midnight maths shifts
  // this money threshold by a day around BST/UTC boundaries.
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const todayUtcMs = Date.parse(`${getTodayIsoDate()}T00:00:00Z`)
  const bookingUtcMs = Date.parse(`${toLocalIsoDate(bookingDate)}T00:00:00Z`)
  const days = Math.round((bookingUtcMs - todayUtcMs) / MS_PER_DAY)
  if (days >= 7) return { percent: 100, tier: 'full' }
  if (days >= 3) return { percent: 50, tier: 'half' }
  return { percent: 0, tier: 'none' }
}

/**
 * Refunds a table booking deposit if one was paid, on whichever provider took it.
 *
 * WHY THIS READS TWO LEDGERS
 *
 * Deposits used to be taken by Stripe, which wrote a `payments` row carrying a
 * `stripe_payment_intent_id`. They are now taken by PayPal, which writes nothing to
 * `payments` at all: the capture is recorded on the booking itself, as
 * `paypal_deposit_capture_id` plus `deposit_amount_locked`.
 *
 * This function only ever looked at the Stripe ledger, so from the day the flow moved it
 * returned `no_deposit` for every real deposit. Cancelling a booking silently kept the
 * guest's money, and because `no_deposit` is also what a genuinely deposit-free booking
 * returns, the cancellation SMS told them nothing at all. The last Stripe deposit was
 * 2026-03-14; everything since has been PayPal.
 *
 * The Stripe branch is kept for those historical rows, which can still be cancelled.
 *
 * amount in the payments table is stored in pounds (e.g. 70.00 for £70).
 * Stripe refund amounts are in pence (minor units).
 */
export async function refundTableBookingDeposit(
  tableBookingId: string,
  bookingDate: Date
): Promise<RefundResult> {
  const supabase = await createClient()

  const { data: payment } = await supabase
    .from('payments')
    .select('id, amount, stripe_payment_intent_id, status')
    .eq('table_booking_id', tableBookingId)
    .eq('charge_type', 'table_deposit')
    .eq('status', 'succeeded')
    .maybeSingle()

  if (!payment?.stripe_payment_intent_id) {
    // No Stripe deposit. Before concluding there is no deposit at all, check the
    // ledger the money actually lives in now.
    return await refundPayPalDeposit(supabase, tableBookingId, bookingDate)
  }
  if (payment.status === 'refunded') return { refunded: false, reason: 'already_refunded' }

  // A booking that snapshotted a seasonal refund cutoff is governed by the promise the guest was
  // actually shown when they paid: full refund up to N days before the booking date, nothing
  // inside it. Not the sliding 100/50/0 tier, which is a different promise and was never made to
  // them. The cutoff is read from the BOOKING, never from booking_periods, so a manager editing or
  // archiving the period afterwards cannot rewrite terms someone has already paid against.
  const { data: bookingTerms, error: bookingTermsError } = await supabase
    .from('table_bookings')
    .select('booking_date, deposit_refund_cutoff_days, booking_period_code')
    .eq('id', tableBookingId)
    .maybeSingle()

  // FAIL CLOSED. An unreadable snapshot is not evidence that there is no promise to keep. The
  // obvious trigger is a stale PostgREST schema cache in the minutes after the migration adds these
  // columns, and reading that as "no seasonal terms" would refund a cutoff-14 booking in full ten
  // days out, with no override and no audit row. Refusing costs a manual refund; guessing costs
  // money that should never have gone back.
  if (bookingTermsError) {
    logger.error('Could not read the seasonal refund terms, so no automatic refund was issued', {
      metadata: { tableBookingId, error: bookingTermsError.message },
    })
    return { refunded: false, reason: 'terms_unreadable' }
  }

  const seasonalCutoff = bookingTerms?.deposit_refund_cutoff_days
  if (seasonalCutoff !== null && seasonalCutoff !== undefined) {
    const decision = resolveSeasonalDepositRefund({
      bookingDate: bookingTerms?.booking_date ?? toLocalIsoDate(bookingDate),
      refundCutoffDays: Number(seasonalCutoff),
      depositAmount: Number(payment.amount) || 0,
    })

    if (!decision.entitled) {
      logger.info('Seasonal deposit not refunded: inside the window the guest was told about', {
        metadata: {
          tableBookingId,
          bookingPeriodCode: bookingTerms?.booking_period_code ?? null,
          daysBefore: decision.daysBefore,
          cutoffDays: decision.cutoffDays,
        },
      })
      return { refunded: false, reason: 'zero_tier' }
    }

    // The seasonal promise is all or nothing, so an entitled refund is the whole deposit.
    return await issueStripeRefund(supabase, {
      tableBookingId,
      payment,
      refundAmountPence: Math.round(decision.amount * 100),
      tier: 'full',
    })
  }

  const { percent, tier } = calculateRefundTier(bookingDate)
  if (percent === 0) return { refunded: false, reason: 'zero_tier' }

  // amount is in pounds; Stripe needs pence
  const refundAmountPence = Math.round(payment.amount * percent)

  return await issueStripeRefund(supabase, { tableBookingId, payment, refundAmountPence, tier })
}

type DepositPaymentRow = {
  id: string
  amount: number
  stripe_payment_intent_id: string
  status: string
}

/**
 * Issues the Stripe refund and reconciles our record of it.
 *
 * Shared by the seasonal rule and the legacy tier so there is one place that talks to Stripe and
 * one place that handles the dangerous state: money returned to the guest, our own row not updated.
 */
async function issueStripeRefund(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    tableBookingId: string
    payment: DepositPaymentRow
    refundAmountPence: number
    tier: RefundTier
  },
): Promise<RefundResult> {
  const { tableBookingId, payment, refundAmountPence, tier } = args

  if (refundAmountPence <= 0) return { refunded: false, reason: 'zero_tier' }

  const stripeRefund = await createStripeRefund({
    paymentIntentId: payment.stripe_payment_intent_id,
    amountMinor: refundAmountPence,
    reason: 'requested_by_customer',
    metadata: { table_booking_id: tableBookingId, refund_tier: tier },
    idempotencyKey: `tbl-refund-${payment.id}-${tier}`,
  })

  // Stripe refund succeeded, so attempt the DB update. If that fails, the customer has received
  // their money but our records are inconsistent. We log a critical audit event for manual
  // reconciliation and rethrow so the caller knows the state is dirty.
  const { error: dbUpdateError } = await supabase
    .from('payments')
    .update({
      status: tier === 'full' ? 'refunded' : 'partially_refunded',
      refund_amount: refundAmountPence / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)

  if (dbUpdateError) {
    logger.error('Stripe refund succeeded but the DB payment update failed, so manual reconciliation is required', {
      metadata: {
        tableBookingId,
        paymentId: payment.id,
        stripeRefundId: stripeRefund.id,
        amountPence: refundAmountPence,
        tier,
        dbError: dbUpdateError.message,
      },
    })

    await AuditService.logAuditEvent({
      operation_type: 'table_booking.refund_stripe_success_db_failed',
      resource_type: 'table_booking',
      resource_id: tableBookingId,
      operation_status: 'failure',
      error_message: dbUpdateError.message,
      additional_info: {
        stripe_refund_id: stripeRefund.id,
        payment_id: payment.id,
        amount_pence: refundAmountPence,
        tier,
      },
    })

    throw new Error(
      `Stripe refund ${stripeRefund.id} succeeded (${refundAmountPence}p) but DB update failed: ${dbUpdateError.message}`
    )
  }

  return { refunded: true, amountPence: refundAmountPence, refundId: stripeRefund.id, tier }
}

/* ------------------------------------------------------------------ */
/*  PayPal deposits                                                     */
/* ------------------------------------------------------------------ */

type PayPalDepositBooking = {
  paypal_deposit_capture_id: string | null
  deposit_amount_locked: number | string | null
  deposit_amount: number | string | null
  payment_status: string | null
  deposit_refund_status: string | null
  booking_date: string | null
  deposit_refund_cutoff_days: number | null
  booking_period_code: string | null
}

function toGbp(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Refunds a deposit that PayPal took, using the same entitlement rules as the Stripe path.
 *
 * The money is recorded on the booking, not in `payments`, so that is what this reads. A
 * failure here returns `refund_failed` with `depositOwed`, never `no_deposit`: the caller
 * has to be able to tell "there was nothing to refund" apart from "we owe this guest money
 * and could not send it", because those two produce very different messages to a customer.
 */
async function refundPayPalDeposit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableBookingId: string,
  bookingDate: Date,
): Promise<RefundResult> {
  const { data: booking, error: bookingError } = await supabase
    .from('table_bookings')
    .select(
      'paypal_deposit_capture_id, deposit_amount_locked, deposit_amount, payment_status, deposit_refund_status, booking_date, deposit_refund_cutoff_days, booking_period_code',
    )
    .eq('id', tableBookingId)
    .maybeSingle<PayPalDepositBooking>()

  // Same fail-closed reasoning as the Stripe path: an unreadable booking is not evidence
  // that no deposit was taken.
  if (bookingError) {
    logger.error('Could not read the booking to check for a PayPal deposit, so no refund was issued', {
      metadata: { tableBookingId, error: bookingError.message },
    })
    return { refunded: false, reason: 'terms_unreadable' }
  }

  const captureId = booking?.paypal_deposit_capture_id
  if (!captureId) return { refunded: false, reason: 'no_deposit' }

  const depositGbp = toGbp(booking?.deposit_amount_locked) ?? toGbp(booking?.deposit_amount)
  if (depositGbp === null || depositGbp <= 0) {
    // A capture id with no amount is a broken record, not an absent deposit. Say so.
    logger.error('Booking has a PayPal capture but no readable deposit amount, so no refund was issued', {
      metadata: { tableBookingId, captureId },
    })
    return { refunded: false, reason: 'refund_failed', depositOwed: true }
  }

  const alreadyRefunded = booking?.deposit_refund_status === 'refunded'
  if (alreadyRefunded) return { refunded: false, reason: 'already_refunded' }

  // Entitlement: the seasonal promise the guest was shown wins over the sliding tier,
  // exactly as on the Stripe path.
  let refundGbp: number
  let tier: RefundTier
  const seasonalCutoff = booking?.deposit_refund_cutoff_days

  if (seasonalCutoff !== null && seasonalCutoff !== undefined) {
    const decision = resolveSeasonalDepositRefund({
      bookingDate: booking?.booking_date ?? toLocalIsoDate(bookingDate),
      refundCutoffDays: Number(seasonalCutoff),
      depositAmount: depositGbp,
    })
    if (!decision.entitled) {
      logger.info('Seasonal PayPal deposit not refunded: inside the window the guest was told about', {
        metadata: {
          tableBookingId,
          bookingPeriodCode: booking?.booking_period_code ?? null,
          daysBefore: decision.daysBefore,
          cutoffDays: decision.cutoffDays,
        },
      })
      return { refunded: false, reason: 'zero_tier' }
    }
    refundGbp = decision.amount
    tier = 'full'
  } else {
    const { percent, tier: sliding } = calculateRefundTier(bookingDate)
    if (percent === 0) return { refunded: false, reason: 'zero_tier' }
    refundGbp = Math.round(depositGbp * percent) / 100
    tier = sliding
  }

  if (refundGbp <= 0) return { refunded: false, reason: 'zero_tier' }

  let refund: Awaited<ReturnType<typeof refundPayPalPayment>>
  try {
    refund = await refundPayPalPayment(
      captureId,
      refundGbp,
      // Deterministic, so a retry of the same cancellation cannot refund twice.
      `tbl-paypal-refund-${tableBookingId}-${tier}`,
      PAYPAL_DEFAULT_CURRENCY,
    )
  } catch (error) {
    // The guest's money is still with us and the caller is about to cancel their booking.
    // Record it loudly and tell the caller money is owed.
    logger.error('PayPal deposit refund failed, so the guest is owed money', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId, captureId, refundGbp, tier },
    })
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.refund_failed_deposit_owed',
      resource_type: 'table_booking',
      resource_id: tableBookingId,
      operation_status: 'failure',
      error_message: error instanceof Error ? error.message : String(error),
      additional_info: {
        paypal_capture_id: captureId,
        amount_gbp: refundGbp,
        tier,
        action_needed: 'Refund this guest manually: the booking was cancelled but the deposit was not returned',
      },
    })
    return {
      refunded: false,
      reason: 'refund_failed',
      depositOwed: true,
      amountOwedPence: Math.round(refundGbp * 100),
    }
  }

  const isFull = Math.abs(refundGbp - depositGbp) < 0.005

  /*
   * Reconcile BOTH columns.
   *
   * `deposit_refund_status` alone was not enough: `payment_status` stayed `completed`, so a
   * fully refunded booking still read as paid to `hasUnpaidRequiredDeposit` and to the
   * deposit-timeout cron's `hasCapturedDeposit`. The parking flow already updates both; table
   * bookings were left out of that same fix in two files.
   */
  const { error: updateError } = await supabase
    .from('table_bookings')
    .update({
      deposit_refund_status: isFull ? 'refunded' : 'partially_refunded',
      payment_status: isFull ? 'refunded' : 'partial_refund',
      updated_at: new Date().toISOString(),
    })
    .eq('id', tableBookingId)

  if (updateError) {
    // Money HAS gone back. Do not report failure to the caller, or a retry would refund
    // again; record it for reconciliation instead.
    logger.error('PayPal refund succeeded but the booking update failed, so manual reconciliation is required', {
      metadata: { tableBookingId, captureId, refundId: refund.refundId, dbError: updateError.message },
    })
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.refund_paypal_success_db_failed',
      resource_type: 'table_booking',
      resource_id: tableBookingId,
      operation_status: 'failure',
      error_message: updateError.message,
      additional_info: {
        paypal_refund_id: refund.refundId,
        paypal_capture_id: captureId,
        amount_gbp: refundGbp,
        tier,
        action_needed: 'PayPal refund succeeded but the booking row was not updated',
      },
    })
  }

  await AuditService.logAuditEvent({
    operation_type: 'table_booking.deposit_refunded',
    resource_type: 'table_booking',
    resource_id: tableBookingId,
    operation_status: 'success',
    additional_info: {
      provider: 'paypal',
      paypal_refund_id: refund.refundId,
      paypal_capture_id: captureId,
      amount_gbp: refundGbp,
      tier,
    },
  })

  return {
    refunded: true,
    amountPence: Math.round(refundGbp * 100),
    refundId: refund.refundId,
    tier,
  }
}
