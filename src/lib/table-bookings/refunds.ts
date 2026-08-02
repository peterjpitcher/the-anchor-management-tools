import { createStripeRefund } from '@/lib/payments/stripe'
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
       */
      reason: 'no_deposit' | 'zero_tier' | 'already_refunded' | 'terms_unreadable'
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
 * Issues a Stripe refund for a table booking deposit if one was paid.
 * Looks up the succeeded deposit payment, calculates the refund tier,
 * issues the refund via Stripe, and updates the payment record in the DB.
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

  if (!payment?.stripe_payment_intent_id) return { refunded: false, reason: 'no_deposit' }
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
