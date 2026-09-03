import { PAYPAL_DEFAULT_CURRENCY, createSimplePayPalOrder, capturePayPalPayment, getPayPalOrder, refundPayPalPayment } from '@/lib/paypal'
import { insertParkingPayment, getPendingParkingPayment, updateParkingBooking, logParkingNotification } from './repository'
import { ParkingBooking, ParkingPaymentRecord } from '@/types/parking'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { formatDateTime } from '@/lib/dateUtils'
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

function parsePayPalMoney(value: unknown): number | null {
  const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null
}

function payPalMoneyMatches(actual: number, expected: number): boolean {
  return Math.abs(Number(actual.toFixed(2)) - Number(expected.toFixed(2))) <= 0.01
}

function extractPayPalOrderCurrency(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null
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

  // formatDateTime comes from dateUtils so the customer sees Europe/London on
  // the PayPal checkout page. A local en-GB format with no timeZone rendered the
  // times in whatever zone the server ran in, which is UTC on Vercel: an hour
  // out for the whole of British Summer Time.
  const description =
    options.description ||
    `Parking booking ${booking.reference} from ${formatDateTime(booking.start_at)} to ${formatDateTime(booking.end_at)}`

  const { orderId, approveUrl } = await createSimplePayPalOrder({
    customId: booking.id,
    reference: booking.reference,
    description,
    amount,
    returnUrl: options.returnUrl,
    cancelUrl: options.cancelUrl,
    currency: options.currency ?? PAYPAL_DEFAULT_CURRENCY
  })

  if (!approveUrl) {
    throw new Error('PayPal did not return an approval URL')
  }

  const payment = await insertParkingPayment(
    {
      booking_id: booking.id,
      amount,
      currency: options.currency ?? PAYPAL_DEFAULT_CURRENCY,
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

/**
 * Thrown when a booking is no longer in a state that may be charged.
 *
 * PayPal orders are created with intent CAPTURE, so the customer's approval
 * alone takes no money. Refusing the capture therefore costs the customer
 * nothing and needs no refund: the approved order is left uncaptured and
 * expires at PayPal.
 */
export class ParkingBookingNotCapturableError extends Error {
  bookingStatus: string

  constructor(bookingStatus: string) {
    super(`Parking booking is ${bookingStatus} and cannot be charged`)
    this.name = 'ParkingBookingNotCapturableError'
    this.bookingStatus = bookingStatus
  }
}

export async function captureParkingPayment(
  booking: ParkingBooking,
  paypalOrderId: string,
  options: { client?: SupabaseClient<any, 'public', any> } = {}
): Promise<ParkingBooking> {
  const supabase = options.client ?? createAdminClient()

  // An expired or cancelled booking has already given its space back: capacity
  // only counts 'pending_payment' and 'confirmed', so the slot may since have
  // been sold to someone else. Capturing here charged the customer and quietly
  // revived the booking as 'confirmed' with no capacity check, so refuse. The
  // deadline itself is deliberately not checked: while a booking is still
  // pending_payment it is still holding its space, so a customer who comes back
  // from PayPal a minute after the window closes is better served by taking the
  // payment than by losing the sale.
  if (booking.status === 'expired' || booking.status === 'cancelled') {
    throw new ParkingBookingNotCapturableError(booking.status)
  }

  const { data: paymentRecord, error: paymentLookupError } = await supabase
    .from('parking_booking_payments')
    .select('id, status, booking_id, paypal_order_id, amount, currency')
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
  const expectedCurrency = (paymentRecord.currency || PAYPAL_DEFAULT_CURRENCY).toUpperCase()
  const orderAmount = parsePayPalMoney(orderDetails?.purchase_units?.[0]?.amount?.value)
  const expectedAmount = Number(paymentRecord.amount || 0)
  const orderCurrency = extractPayPalOrderCurrency(orderDetails)
  if (
    orderAmount === null ||
    !payPalMoneyMatches(orderAmount, expectedAmount) ||
    orderCurrency !== expectedCurrency
  ) {
    throw new Error('PayPal order amount or currency does not match this booking')
  }

  const captureResult = await capturePayPalPayment(paypalOrderId, expectedCurrency)
  const capturedAmount = parsePayPalMoney(captureResult.amount)
  if (capturedAmount === null || !payPalMoneyMatches(capturedAmount, expectedAmount)) {
    throw new Error('Captured PayPal amount does not match this booking')
  }

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

/**
 * Records a PayPal capture that already happened but never reached the database.
 *
 * The window this closes: `captureParkingPayment` takes the money, then the
 * payment row update fails. Money has moved, the row is still `pending`, and
 * nothing retries, because capture is only ever triggered by the customer's
 * return. Nothing else in the system would ever notice.
 *
 * Deliberately RECORD ONLY. It never calls capture, so it cannot take money for
 * a space that has since been resold. That is the same line the return handler
 * draws, and a sweep that captured APPROVED orders would quietly undo it.
 *
 * Returns null when the order has not in fact been captured at PayPal, which is
 * the ordinary case for a customer who simply walked away.
 */
export async function reconcileCapturedParkingPayment(
  booking: ParkingBooking,
  paypalOrderId: string,
  options: { client?: SupabaseClient<any, 'public', any> } = {}
): Promise<ParkingBooking | null> {
  const supabase = options.client ?? createAdminClient()

  const { data: paymentRecord, error: lookupError } = await supabase
    .from('parking_booking_payments')
    .select('id, status, booking_id, paypal_order_id, amount, currency')
    .eq('booking_id', booking.id)
    .eq('paypal_order_id', paypalOrderId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupError) throw new Error(lookupError.message)
  if (!paymentRecord) return null

  const orderDetails = await getPayPalOrder(paypalOrderId)

  // Only a completed order carries money. CREATED and APPROVED mean the
  // customer never finished, and with intent=CAPTURE no funds have moved.
  if (orderDetails?.status !== 'COMPLETED') return null

  const capture = orderDetails?.purchase_units?.[0]?.payments?.captures?.[0]
  const captureId = typeof capture?.id === 'string' ? capture.id : null
  const capturedAmount = parsePayPalMoney(capture?.amount?.value)
  if (!captureId || capturedAmount === null) return null

  // The same ownership and money checks the capture path makes, because this
  // writes a payment against a booking just as it does.
  const orderCustomId = orderDetails?.purchase_units?.[0]?.custom_id
  if (typeof orderCustomId !== 'string' || orderCustomId !== booking.id) {
    throw new Error('PayPal order does not belong to this booking')
  }

  const expectedCurrency = (paymentRecord.currency || PAYPAL_DEFAULT_CURRENCY).toUpperCase()
  const expectedAmount = Number(paymentRecord.amount || 0)
  const captureCurrency = typeof capture?.amount?.currency_code === 'string'
    ? capture.amount.currency_code.toUpperCase()
    : null

  if (!payPalMoneyMatches(capturedAmount, expectedAmount) || captureCurrency !== expectedCurrency) {
    throw new Error('Captured PayPal amount or currency does not match this booking')
  }

  const { data: paymentUpdate, error: updateError } = await supabase
    .from('parking_booking_payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      transaction_id: captureId,
      metadata: { ...(capture as any), paypal_order_id: paypalOrderId, reconciled: true }
    })
    .eq('id', paymentRecord.id)
    // Guarded, so racing the customer's own return records the money once.
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (updateError) throw new Error(updateError.message)
  if (!paymentUpdate) return null

  // The space is only still ours to sell while the booking is live. Capacity
  // counts 'pending_payment' and 'confirmed' only, so an expired or cancelled
  // booking has already handed its slot back and it may since have been sold to
  // someone else. Reviving it here would confirm two bookings for one space
  // with no capacity check, which is the exact failure the capture path refuses.
  //
  // The payment row above is still written, deliberately: the money HAS been
  // taken and must be visible rather than vanishing. What it must not do is
  // quietly resurrect the booking. This needs a person, to refund or to
  // re-accommodate, so it is logged as an error rather than handled silently.
  if (booking.status === 'expired' || booking.status === 'cancelled') {
    logger.error('Parking payment captured against a booking that had already lapsed', {
      error: new ParkingBookingNotCapturableError(booking.status),
      metadata: {
        bookingId: booking.id,
        paypalOrderId,
        captureId,
        amount: capturedAmount,
        action: 'refund or re-accommodate this customer'
      }
    })
    return null
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

  // They paid and never got a confirmation, so send it now.
  await sendConfirmationNotifications(updatedBooking, supabase)
  return updatedBooking
}

async function refundParkingPayment(
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

  const { randomUUID } = await import('crypto')
  await refundPayPalPayment(payment.transaction_id, amount, randomUUID(), payment.currency)

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
