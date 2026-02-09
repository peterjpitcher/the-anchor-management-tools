import { createSimplePayPalOrder, capturePayPalPayment, refundPayPalPayment } from '@/lib/paypal'
import { insertParkingPayment, getPendingParkingPayment, updateParkingBooking, logParkingNotification } from './repository'
import { ParkingBooking, ParkingPaymentRecord } from '@/types/parking'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendEmail } from '@/lib/email/emailService'
import {
  buildPaymentConfirmationSms,
  buildPaymentConfirmationManagerEmail,
  buildPaymentRequestSms,
} from '@/lib/parking/notifications'

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

export async function sendParkingPaymentRequest(
  booking: ParkingBooking,
  paymentLink: string,
  options: { client?: SupabaseClient<any, 'public', any> } = {}
) {
  const supabase = options.client ?? createAdminClient()
  const replyNumber = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

  let smsAllowed = true
  if (booking.customer_id) {
    const { data, error } = await supabase
      .from('customers')
      .select('sms_opt_in')
      .eq('id', booking.customer_id)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to load customer sms preference for payment request', {
        error,
        metadata: { bookingId: booking.id }
      })
    }

    if (data && data.sms_opt_in === false) {
      smsAllowed = false
    }
  }

  if (!booking.customer_mobile) {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'skipped',
      payload: { reason: 'No customer mobile number on booking' }
    }, supabase)
    return
  }

  if (!smsAllowed) {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'skipped',
      payload: { reason: 'Customer has opted out of SMS' }
    }, supabase)
    return
  }

  try {
    const smsBody = ensureReplyInstruction(buildPaymentRequestSms(booking, paymentLink), replyNumber)
    
    const smsResult = await sendSMS(booking.customer_mobile, smsBody, {
      customerId: booking.customer_id ?? undefined,
      metadata: {
        parking_booking_id: booking.id,
        event_type: 'payment_request'
      },
      customerFallback: {
        email: (booking as any)?.customer_email ?? null
      }
    })

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: smsResult.success ? 'sent' : 'failed',
      sent_at: smsResult.success ? new Date().toISOString() : null,
      message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
      payload: { sms: smsBody }
    }, supabase)

    if (smsResult.success) {
      const { error: updateBookingError } = await supabase
        .from('parking_bookings')
        .update({
          initial_request_sms_sent: true,
          // The initial payment request is sent when the 7-day offer window starts.
          unpaid_week_before_sms_sent: true
        })
        .eq('id', booking.id)

      if (updateBookingError) {
        logger.warn('Failed to update parking booking reminder flags after payment request SMS', {
          error: updateBookingError,
          metadata: { bookingId: booking.id }
        })
      }
    }

    if (!smsResult.success) {
      logger.warn('Parking payment request SMS failed', {
        metadata: { bookingId: booking.id, error: smsResult.error }
      })
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Unexpected error sending parking payment request SMS', {
      error: err,
      metadata: { bookingId: booking.id }
    })

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'failed',
      payload: { error: err.message }
    }, supabase)
  }
}

export async function captureParkingPayment(
  booking: ParkingBooking,
  paypalOrderId: string,
  options: { client?: SupabaseClient<any, 'public', any> } = {}
) {
  const supabase = options.client ?? createAdminClient()

  const captureResult = await capturePayPalPayment(paypalOrderId)

  const updatedBooking = await updateParkingBooking(
    booking.id,
    {
      payment_status: 'paid',
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      paid_start_three_day_sms_sent: false,
      paid_end_three_day_sms_sent: false
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

  await sendConfirmationNotifications(updatedBooking, supabase)
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

async function sendConfirmationNotifications(booking: ParkingBooking, supabase: SupabaseClient<any, 'public', any>) {
  const replyNumber = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

  // Determine SMS opt-in
  let smsAllowed = true
  if (booking.customer_id) {
    const { data, error } = await supabase
      .from('customers')
      .select('sms_opt_in')
      .eq('id', booking.customer_id)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to load customer sms preference', { error, metadata: { bookingId: booking.id } })
    }

    if (data && data.sms_opt_in === false) {
      smsAllowed = false
    }
  }

  if (smsAllowed && booking.customer_mobile) {
    try {
      const smsBody = ensureReplyInstruction(buildPaymentConfirmationSms(booking), replyNumber)
      
      const smsResult = await sendSMS(booking.customer_mobile, smsBody, {
        customerId: booking.customer_id ?? undefined,
        metadata: {
          parking_booking_id: booking.id,
          event_type: 'payment_confirmation'
        },
        customerFallback: {
          email: (booking as any)?.customer_email ?? null
        }
      })

      await logParkingNotification({
        booking_id: booking.id,
        channel: 'sms',
        event_type: 'payment_confirmation',
        status: smsResult.success ? 'sent' : 'failed',
        sent_at: smsResult.success ? new Date().toISOString() : null,
        message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
        payload: { sms: smsBody }
      }, supabase)

      if (!smsResult.success) {
        logger.warn('Parking payment confirmation SMS failed', {
          metadata: { bookingId: booking.id, error: smsResult.error }
        })
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Unexpected error sending parking confirmation SMS', {
        error: err,
        metadata: { bookingId: booking.id }
      })
      await logParkingNotification({
        booking_id: booking.id,
        channel: 'sms',
        event_type: 'payment_confirmation',
        status: 'failed',
        payload: { error: err.message }
      }, supabase)
    }
  }

  try {
    const managerEmail = buildPaymentConfirmationManagerEmail(booking)
    const emailResult = await sendEmail({ to: managerEmail.to, subject: managerEmail.subject, html: managerEmail.html })

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'email',
      event_type: 'payment_confirmation',
      status: emailResult.success ? 'sent' : 'failed',
      sent_at: emailResult.success ? new Date().toISOString() : null,
      payload: { subject: managerEmail.subject }
    }, supabase)

    if (!emailResult.success) {
      logger.warn('Parking payment confirmation email failed', {
        metadata: { bookingId: booking.id, error: emailResult.error }
      })
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Unexpected error sending parking confirmation email', {
      error: err,
      metadata: { bookingId: booking.id }
    })
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'email',
      event_type: 'payment_confirmation',
      status: 'failed',
      payload: { error: err.message }
    }, supabase)
  }
}
