import { createStripeRefund } from '@/lib/payments/stripe'
import { createClient } from '@/lib/supabase/server'

export type RefundTier = 'full' | 'half' | 'none'

export type RefundResult =
  | { refunded: false; reason: 'no_deposit' | 'zero_tier' | 'already_refunded' }
  | { refunded: true; amountPence: number; refundId: string; tier: RefundTier }

/**
 * Returns the refund tier based on days until the booking.
 * - 7+ days: 100% (full)
 * - 3–6 days: 50% (half)
 * - <3 days: 0% (none)
 */
export function calculateRefundTier(bookingDate: Date): { percent: number; tier: RefundTier } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = bookingDate.getTime() - today.getTime()
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
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

  const { percent, tier } = calculateRefundTier(bookingDate)
  if (percent === 0) return { refunded: false, reason: 'zero_tier' }

  // amount is in pounds; Stripe needs pence
  const refundAmountPence = Math.round(payment.amount * percent)

  const stripeRefund = await createStripeRefund({
    paymentIntentId: payment.stripe_payment_intent_id,
    amountMinor: refundAmountPence,
    reason: 'requested_by_customer',
    metadata: { table_booking_id: tableBookingId, refund_tier: tier },
    idempotencyKey: `tbl-refund-${payment.id}-${tier}`,
  })

  await supabase
    .from('payments')
    .update({
      status: tier === 'full' ? 'refunded' : 'partial_refund',
      refund_amount: refundAmountPence / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)

  return { refunded: true, amountPence: refundAmountPence, refundId: stripeRefund.id, tier }
}
