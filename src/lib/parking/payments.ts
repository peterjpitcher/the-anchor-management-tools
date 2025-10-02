import { createSimplePayPalOrder, capturePayPalPayment, refundPayPalPayment } from '@/lib/paypal'
import { insertParkingPayment, getPendingParkingPayment, updateParkingBooking } from './repository'
import { ParkingBooking, ParkingPaymentRecord } from '@/types/parking'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type { SupabaseClient } from '@supabase/supabase-js'

interface CreatePaymentOptions {
  returnUrl: string
  cancelUrl: string
  description?: string
  currency?: string
  client?: SupabaseClient<any, 'public', any>
}

export async function createParkingPaymentOrder(
  booking: ParkingBooking,
  options: CreatePaymentOptions
): Promise<{ payment: ParkingPaymentRecord; orderId: string; approveUrl: string }> {
  const amount = booking.override_price ?? booking.calculated_price
  if (!amount || amount <= 0) {
    throw new Error('Parking booking amount must be greater than zero to create a payment')
  }

  if (!booking.payment_due_at) {
    throw new Error('Parking booking is missing payment_due_at')
  }

  const supabase = options.client ?? createAdminClient()

  const existingPending = await getPendingParkingPayment(booking.id, supabase)
  if (existingPending) {
    logger.info('Reusing existing pending parking payment', {
      metadata: { bookingId: booking.id, paymentId: existingPending.id }
    })
    return {
      payment: existingPending,
      orderId: existingPending.paypal_order_id || '',
      approveUrl: (existingPending.metadata as any)?.approve_url || ''
    }
  }

  const description =
    options.description ||
    `Parking booking ${booking.reference} from ${formatDateTime(new Date(booking.start_at))} to ${formatDateTime(
      new Date(booking.end_at)
    )}`

  const { orderId, approveUrl } = await createSimplePayPalOrder({
    customId: booking.id,
    reference: booking.reference,
    description,
    amount,
    returnUrl: options.returnUrl,
    cancelUrl: options.cancelUrl,
    currency: options.currency
  })

  if (!approveUrl) {
    throw new Error('PayPal did not return an approval URL')
  }

  const payment = await insertParkingPayment(
    {
      booking_id: booking.id,
      amount,
      currency: options.currency ?? 'GBP',
      status: 'pending',
      paypal_order_id: orderId,
      expires_at: booking.payment_due_at,
      metadata: {
        approve_url: approveUrl,
        amount,
        description
      }
    },
    supabase
  )

  return { payment, orderId, approveUrl }
}

export async function captureParkingPayment(
  booking: ParkingBooking,
  paypalOrderId: string,
  options: { client?: SupabaseClient<any, 'public', any> } = {}
) {
  const supabase = options.client ?? createAdminClient()

  const captureResult = await capturePayPalPayment(paypalOrderId)

  await updateParkingBooking(
    booking.id,
    {
      payment_status: 'paid',
      status: 'confirmed',
      confirmed_at: new Date().toISOString()
    },
    supabase
  )

  const { error } = await supabase
    .from('parking_booking_payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      transaction_id: captureResult.transactionId,
      metadata: {
        ...(captureResult as any),
        paypal_order_id: paypalOrderId
      }
    })
    .eq('booking_id', booking.id)
    .eq('paypal_order_id', paypalOrderId)

  if (error) {
    logger.error('Failed to update parking payment after capture', {
      error,
      metadata: { bookingId: booking.id, paypalOrderId }
    })
    throw new Error('Failed to update payment status')
  }
}

export async function refundParkingPayment(
  booking: ParkingBooking,
  amount: number,
  options: { reason?: string; client?: SupabaseClient<any, 'public', any> } = {}
) {
  const supabase = options.client ?? createAdminClient()

  const { data: payment, error } = await supabase
    .from('parking_booking_payments')
    .select('*')
    .eq('booking_id', booking.id)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!payment || !payment.transaction_id) {
    throw new Error('No captured payment found to refund')
  }

  await refundPayPalPayment(payment.transaction_id, amount, options.reason)

  await updateParkingBooking(
    booking.id,
    {
      status: 'cancelled',
      payment_status: 'refunded',
      cancelled_at: new Date().toISOString()
    },
    supabase
  )

  await supabase
    .from('parking_booking_payments')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      metadata: {
        ...(payment.metadata || {}),
        refund_reason: options.reason,
        refunded_amount: amount
      }
    })
    .eq('id', payment.id)
}

function formatDateTime(date: Date) {
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
