import { createSimplePayPalOrder, capturePayPalPayment, getPayPalOrder, refundPayPalPayment } from '@/lib/paypal'
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
import { resolveParkingSmsEligibility } from '@/lib/parking/sms-safety'

interface CreatePaymentOptions {
  returnUrl: string
  cancelUrl: string
  description?: string
  currency?: string
  client?: SupabaseClient<any, 'public', any>
}

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const thrownCode = typeof (error as any)?.code === 'string' ? (error as any).code : null
  const thrownLogFailure = (error as any)?.logFailure === true || thrownCode === 'logging_failed'

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      logFailure: true
    }
  }

  if (
    thrownCode === 'safety_unavailable'
    || thrownCode === 'idempotency_conflict'
  ) {
    return {
      code: thrownCode,
      logFailure: false
    }
  }

  return {
    code: 'safety_unavailable',
    logFailure: false
  }
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
): Promise<{ sent: boolean; skipped: boolean; code: string | null; logFailure: boolean }> {
  const supabase = options.client ?? createAdminClient()
  const replyNumber = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

  let smsAllowed = true
  let smsSkipReason: string | null = null
  if (booking.customer_id) {
    const smsEligibility = await resolveParkingSmsEligibility(supabase, booking.customer_id)

    if (!smsEligibility.allowed) {
      smsAllowed = false
      smsSkipReason =
        smsEligibility.reason === 'customer_opted_out'
          ? 'Customer has opted out of SMS'
          : 'Customer SMS eligibility lookup failed'

      if (smsEligibility.reason === 'customer_lookup_failed') {
        logger.warn('Failed to load customer sms preference for payment request; blocking send', {
          metadata: {
            bookingId: booking.id,
            customerId: booking.customer_id,
            detail: smsEligibility.detail
          }
        })
      }
    }
  }

  if (!booking.customer_mobile) {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'skipped',
      payload: {
        template_key: 'parking_payment_request',
        stage: 'week_before_expiry',
        reason: 'No customer mobile number on booking'
      }
    }, supabase)
    return { sent: false, skipped: true, code: null, logFailure: false }
  }

  if (!smsAllowed) {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'skipped',
      payload: {
        template_key: 'parking_payment_request',
        stage: 'week_before_expiry',
        reason: smsSkipReason || 'Customer not eligible for SMS'
      }
    }, supabase)
    return { sent: false, skipped: true, code: null, logFailure: false }
  }

  const smsBody = ensureReplyInstruction(buildPaymentRequestSms(booking, paymentLink), replyNumber)

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(booking.customer_mobile, smsBody, {
      customerId: booking.customer_id ?? undefined,
      metadata: {
        parking_booking_id: booking.id,
        event_type: 'payment_request',
        template_key: 'parking_payment_request'
      },
      customerFallback: {
        email: (booking as any)?.customer_email ?? null
      }
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const normalizedSmsSafety = normalizeThrownSmsSafety(error)
    logger.error('Unexpected error sending parking payment request SMS', {
      error: err,
      metadata: {
        bookingId: booking.id,
        code: normalizedSmsSafety.code,
        logFailure: normalizedSmsSafety.logFailure
      }
    })

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'failed',
      payload: {
        template_key: 'parking_payment_request',
        stage: 'week_before_expiry',
        error: err.message
      }
    }, supabase)
    return {
      sent: false,
      skipped: false,
      code: normalizedSmsSafety.code,
      logFailure: normalizedSmsSafety.logFailure
    }
  }

  const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
  const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'

  if (smsLogFailure) {
    logger.error('Parking payment request SMS sent but outbound message logging failed', {
      metadata: {
        bookingId: booking.id,
        customerId: booking.customer_id ?? null,
        code: smsCode,
        logFailure: smsLogFailure
      }
    })
  }

  let notificationPersistFailed = false
  try {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: smsResult.success ? 'sent' : 'failed',
      sent_at: smsResult.success ? new Date().toISOString() : null,
      message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
      payload: {
        template_key: 'parking_payment_request',
        stage: 'week_before_expiry',
        sms: smsBody,
        sms_code: smsCode,
        sms_log_failure: smsLogFailure
      }
    }, supabase)
  } catch (logError) {
    notificationPersistFailed = true
    logger.error('Failed to persist parking payment request notification result', {
      error: logError instanceof Error ? logError : new Error(String(logError)),
      metadata: {
        bookingId: booking.id,
        code: smsCode,
        logFailure: smsLogFailure
      }
    })
  }

  if (!smsResult.success) {
    logger.warn('Parking payment request SMS failed', {
      metadata: { bookingId: booking.id, error: smsResult.error, code: smsCode }
    })
    return { sent: false, skipped: false, code: smsCode, logFailure: smsLogFailure }
  }

  const { data: updatedBookingFlags, error: updateBookingError } = await supabase
    .from('parking_bookings')
    .update({
      initial_request_sms_sent: true,
      // The initial payment request is sent when the 7-day offer window starts.
      unpaid_week_before_sms_sent: true
    })
    .eq('id', booking.id)
    .select('id')
    .maybeSingle()

  const bookingFlagPersistFailed = Boolean(updateBookingError) || !updatedBookingFlags
  if (bookingFlagPersistFailed) {
    logger.error('Parking payment request SMS sent but failed to persist booking reminder flags', {
      error: updateBookingError ?? new Error('Parking reminder-flag update affected no rows'),
      metadata: { bookingId: booking.id }
    })
  }

  const persistFailed = notificationPersistFailed || bookingFlagPersistFailed
  if (persistFailed) {
    return { sent: true, skipped: false, code: 'logging_failed', logFailure: true }
  }

  return { sent: true, skipped: false, code: smsCode, logFailure: smsLogFailure }
}

export async function captureParkingPayment(
  booking: ParkingBooking,
  paypalOrderId: string,
  options: { client?: SupabaseClient<any, 'public', any> } = {}
): Promise<ParkingBooking> {
  const supabase = options.client ?? createAdminClient()

  const { data: paymentRecord, error: paymentLookupError } = await supabase
    .from('parking_booking_payments')
    .select('id, status, booking_id, paypal_order_id')
    .eq('booking_id', booking.id)
    .eq('paypal_order_id', paypalOrderId)
    .in('status', ['pending', 'paid'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (paymentLookupError) {
    throw new Error(paymentLookupError.message)
  }

  if (!paymentRecord) {
    throw new Error('Payment order does not match booking')
  }

  if (paymentRecord.status === 'paid' && booking.payment_status === 'paid' && booking.status === 'confirmed') {
    return booking
  }

  if (paymentRecord.status === 'paid') {
    const reconciledBooking = await updateParkingBooking(
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
    await sendConfirmationNotifications(reconciledBooking, supabase)
    return reconciledBooking
  }

  if (paymentRecord.status !== 'pending') {
    throw new Error('Payment is not pending')
  }

  const orderDetails = await getPayPalOrder(paypalOrderId)
  const orderCustomId = orderDetails?.purchase_units?.[0]?.custom_id
  if (typeof orderCustomId !== 'string' || orderCustomId !== booking.id) {
    throw new Error('PayPal order does not belong to this booking')
  }

  const captureResult = await capturePayPalPayment(paypalOrderId)

  const { data: paymentUpdate, error } = await supabase
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
    .eq('id', paymentRecord.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.error('Failed to update parking payment after capture', {
      error,
      metadata: { bookingId: booking.id, paypalOrderId }
    })
    throw new Error('Failed to update payment status')
  }

  if (!paymentUpdate) {
    throw new Error('Payment has already been processed')
  }

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

  await sendConfirmationNotifications(updatedBooking, supabase)
  return updatedBooking
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

  const { data: refundedPayment, error: refundUpdateError } = await supabase
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
    .eq('status', 'paid')
    .select('id')
    .maybeSingle()

  if (refundUpdateError) {
    throw new Error(refundUpdateError.message || 'Failed to update refunded payment status')
  }

  if (!refundedPayment) {
    throw new Error('Parking payment status was not updated to refunded')
  }
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
    const smsEligibility = await resolveParkingSmsEligibility(supabase, booking.customer_id)
    if (!smsEligibility.allowed) {
      smsAllowed = false
      if (smsEligibility.reason === 'customer_lookup_failed') {
        logger.warn('Failed to load customer sms preference for payment confirmation; blocking send', {
          metadata: {
            bookingId: booking.id,
            customerId: booking.customer_id,
            detail: smsEligibility.detail
          }
        })
      }
    }
  }

  if (smsAllowed && booking.customer_mobile) {
    try {
      const smsBody = ensureReplyInstruction(buildPaymentConfirmationSms(booking), replyNumber)
      
      const smsResult = await sendSMS(booking.customer_mobile, smsBody, {
        customerId: booking.customer_id ?? undefined,
        metadata: {
          parking_booking_id: booking.id,
          event_type: 'payment_confirmation',
          template_key: 'parking_payment_confirmation'
        },
        customerFallback: {
          email: (booking as any)?.customer_email ?? null
        }
      })

      const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
      const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'

      if (smsLogFailure) {
        logger.error('Parking payment confirmation SMS sent but outbound message logging failed', {
          metadata: {
            bookingId: booking.id,
            customerId: booking.customer_id ?? null,
            code: smsCode,
            logFailure: smsLogFailure
          }
        })
      }

      await logParkingNotification({
        booking_id: booking.id,
        channel: 'sms',
        event_type: 'payment_confirmation',
        status: smsResult.success ? 'sent' : 'failed',
        sent_at: smsResult.success ? new Date().toISOString() : null,
        message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
        payload: { sms: smsBody, sms_code: smsCode, sms_log_failure: smsLogFailure }
      }, supabase)

      if (!smsResult.success) {
        logger.warn('Parking payment confirmation SMS failed', {
          metadata: { bookingId: booking.id, error: smsResult.error, code: smsCode }
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
