import { PAYPAL_DEFAULT_CURRENCY, createSimplePayPalOrder, capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { insertParkingPayment, getPendingParkingPayment, updateParkingBooking, logParkingNotification } from './repository'
import { ParkingBooking, ParkingPaymentRecord } from '@/types/parking'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { formatDateTime } from '@/lib/dateUtils'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendEmail } from '@/lib/email/emailService'
import {
  buildPaymentConfirmationSms,
  buildPaymentConfirmationManagerEmail,
  buildPaymentRequestSms,
  buildTopUpReceivedSms,
} from '@/lib/parking/notifications'
import { enforcePendingPaymentRule, isTopUpBooking } from '@/lib/parking/payment-due'
import {
  customerMessagePayload,
  firstChoiceChannel,
  parkingConfirmationEmail,
  parkingPaymentRequestEmail,
  parkingTopUpReceivedEmail,
  sendParkingCustomerMessage
} from '@/lib/parking/customer-message'

interface CreatePaymentOptions {
  returnUrl: string
  cancelUrl: string
  description?: string
  currency?: string
  client?: SupabaseClient<any, 'public', any>
  /**
   * What to charge. Omitted: the booking's whole price, for a booking still waiting for its first
   * payment. A top-up on a confirmed booking passes its balance (spec section 7).
   */
  amount?: number
  /** 'top_up' marks the row as extra on a confirmed booking: no offer deadline, expires at end_at. */
  purpose?: 'booking' | 'top_up'
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

/**
 * The PayPal-Request-Id for a new parking order.
 *
 * PayPal replays the original order for a request id it has seen recently, so one fixed id per
 * booking (`parking-<id>`, the old default) handed a top-up, or a link re-made for a new price,
 * the earlier order back instead of a new one. The id now changes with each payment row the
 * booking has (any status) and with the amount, so a fresh attempt gets a fresh order, while a
 * retry of the same attempt (no row written yet) keeps its id and is still de-duplicated.
 * A booking's very first order keeps the old id.
 */
export async function parkingOrderRequestId(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string,
  amount: number
): Promise<string> {
  const { count, error } = await supabase
    .from('parking_booking_payments')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', bookingId)
  if (error) {
    throw new Error(`Could not read the booking's payments: ${error.message}`)
  }
  const rows = count ?? 0
  return rows === 0 ? `parking-${bookingId}` : `parking-${bookingId}-${rows}-${Math.round(amount * 100)}`
}

export async function createParkingPaymentOrder(
  booking: ParkingBooking,
  options: CreatePaymentOptions
): Promise<{ payment: ParkingPaymentRecord; orderId: string; approveUrl: string }> {
  const purpose = options.purpose ?? 'booking'
  const amount = Number((options.amount ?? booking.override_price ?? booking.calculated_price ?? 0).toFixed(2))
  if (!amount || amount <= 0) {
    throw new Error('Parking booking amount must be greater than zero to create a payment')
  }

  // A top-up has no offer deadline: the booking is already confirmed, and the debt is the balance,
  // not the row. Its row lapses at the end of the stay. Nothing reads a payment row's expires_at
  // to expire or cancel a booking (checked 24 November 2026: the lifecycle cron reads the
  // booking's own payment_due_at and only for pending_payment bookings).
  const rowExpiresAt = purpose === 'top_up' ? booking.end_at : booking.payment_due_at
  if (!rowExpiresAt) {
    throw new Error('Parking booking is missing payment_due_at')
  }

  const supabase = options.client ?? createAdminClient()

  // Reuse a pending order only when it is for exactly this amount. One for an old amount is
  // expired first: the unique index allows one pending row per booking, and a link texted for an
  // old amount must stop working (the pending-payment rule, spec section 5).
  const existingPending = await getPendingParkingPayment(booking.id, supabase)
  if (existingPending) {
    if (payPalMoneyMatches(Number(existingPending.amount), amount)) {
      logger.info('Reusing existing pending parking payment', {
        metadata: { bookingId: booking.id, paymentId: existingPending.id }
      })
      return {
        payment: existingPending,
        orderId: existingPending.paypal_order_id || '',
        approveUrl: (existingPending.metadata as any)?.approve_url || ''
      }
    }
    const { error: expireError } = await supabase
      .from('parking_booking_payments')
      .update({
        status: 'expired',
        metadata: {
          ...((existingPending.metadata as Record<string, unknown> | null) ?? {}),
          superseded_at: new Date().toISOString(),
          superseded_reason: 'amount_changed',
          superseded_amount: existingPending.amount,
          amount_due_now: amount
        }
      })
      .eq('id', existingPending.id)
      .eq('status', 'pending')
    if (expireError) {
      throw new Error(`Could not retire the old payment link: ${expireError.message}`)
    }
  }

  // formatDateTime comes from dateUtils so the customer sees Europe/London on
  // the PayPal checkout page. A local en-GB format with no timeZone rendered the
  // times in whatever zone the server ran in, which is UTC on Vercel: an hour
  // out for the whole of British Summer Time.
  const description =
    options.description ||
    (purpose === 'top_up'
      ? `Extra for parking booking ${booking.reference}, now ${formatDateTime(booking.start_at)} to ${formatDateTime(booking.end_at)}`
      : `Parking booking ${booking.reference} from ${formatDateTime(booking.start_at)} to ${formatDateTime(booking.end_at)}`)

  const { orderId, approveUrl } = await createSimplePayPalOrder({
    customId: booking.id,
    reference: booking.reference,
    description,
    amount,
    returnUrl: options.returnUrl,
    cancelUrl: options.cancelUrl,
    currency: options.currency ?? PAYPAL_DEFAULT_CURRENCY,
    requestId: await parkingOrderRequestId(supabase, booking.id, amount)
  })

  if (!approveUrl) {
    throw new Error('PayPal did not return an approval URL')
  }

  let payment: ParkingPaymentRecord
  try {
    payment = await insertParkingPayment(
      {
        booking_id: booking.id,
        amount,
        currency: options.currency ?? PAYPAL_DEFAULT_CURRENCY,
        status: 'pending',
        paypal_order_id: orderId,
        expires_at: rowExpiresAt,
        metadata: {
          approve_url: approveUrl,
          amount,
          description,
          purpose
        }
      },
      supabase
    )
  } catch (insertError) {
    // Two requests raced: the other one's pending row won the unique index. Use it when it is for
    // the same amount; otherwise give up rather than leave two links for different amounts.
    if ((insertError as { code?: unknown })?.code === '23505') {
      const winner = await getPendingParkingPayment(booking.id, supabase)
      if (winner && payPalMoneyMatches(Number(winner.amount), amount)) {
        return {
          payment: winner,
          orderId: winner.paypal_order_id || '',
          approveUrl: (winner.metadata as any)?.approve_url || ''
        }
      }
    }
    throw insertError
  }

  return { payment, orderId, approveUrl }
}

export async function sendParkingPaymentRequest(
  booking: ParkingBooking,
  paymentLink: string,
  options: {
    client?: SupabaseClient<any, 'public', any>
    /** A date change re-sending the link: scopes the SMS dedupe to that change (spec 6.2). */
    changeId?: string
  } = {}
): Promise<{ sent: boolean; skipped: boolean; code: string | null; logFailure: boolean }> {
  const supabase = options.client ?? createAdminClient()
  const replyNumber = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const smsBody = ensureReplyInstruction(buildPaymentRequestSms(booking, paymentLink), replyNumber)
  const email = parkingPaymentRequestEmail(booking, paymentLink || null)

  // Email first; a text only for someone with no usable email (owner, 24 November 2026).
  const result = await sendParkingCustomerMessage({
    client: supabase,
    booking,
    eventType: 'payment_request',
    templateKey: 'parking_payment_request',
    email,
    smsBody,
    dedupe: { change_id: options.changeId },
  })

  let notificationPersistFailed = false
  try {
    await logParkingNotification({
      booking_id: booking.id,
      channel: result.channel ?? firstChoiceChannel(booking),
      event_type: 'payment_request',
      status: result.status === 'held' ? 'sent' : result.status,
      sent_at: result.status === 'sent' || result.status === 'held' ? new Date().toISOString() : null,
      message_sid: result.channel === 'sms' ? result.messageId : null,
      payload: {
        template_key: 'parking_payment_request',
        stage: 'week_before_expiry',
        ...(options.changeId ? { change_id: options.changeId } : {}),
        ...customerMessagePayload(result, email, smsBody)
      }
    }, supabase)
  } catch (logError) {
    notificationPersistFailed = true
    logger.error('Failed to persist parking payment request notification result', {
      error: logError instanceof Error ? logError : new Error(String(logError)),
      metadata: { bookingId: booking.id, code: result.code, logFailure: result.logFailure }
    })
  }

  if (result.status === 'skipped') {
    return { sent: false, skipped: true, code: null, logFailure: false }
  }

  if (result.status === 'failed') {
    logger.warn('Parking payment request failed to send', {
      metadata: { bookingId: booking.id, channel: result.channel, error: result.reason, code: result.code }
    })
    return { sent: false, skipped: false, code: result.code, logFailure: result.logFailure }
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
    logger.error('Parking payment request sent but failed to persist booking reminder flags', {
      error: updateBookingError ?? new Error('Parking reminder-flag update affected no rows'),
      metadata: { bookingId: booking.id }
    })
  }

  if (notificationPersistFailed || bookingFlagPersistFailed) {
    return { sent: true, skipped: false, code: 'logging_failed', logFailure: true }
  }

  return { sent: true, skipped: false, code: result.code, logFailure: result.logFailure }
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

/**
 * Thrown when a top-up link no longer matches what the booking owes (the amount changed, or the
 * debt was paid at the venue or waived). Nothing is captured, so no money moves; the customer is
 * sent to the guest page, which shows what is owed now.
 */
export class ParkingTopUpAmountChangedError extends Error {
  constructor(message = 'This payment link is for an amount that is no longer owed') {
    super(message)
    this.name = 'ParkingTopUpAmountChangedError'
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

  // A confirmed, paid booking taking more money: a top-up after its dates grew (spec section 7).
  // Its status, confirmation and reminder flags are left alone, and the customer gets the top-up
  // receipt, not a second "your parking is now confirmed".
  if (isTopUpBooking(booking)) {
    if (paymentRecord.status !== 'pending') {
      throw new Error('Payment is not pending')
    }
    await captureParkingTopUp(booking, paypalOrderId, paymentRecord, supabase)
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
 * Captures a top-up on a confirmed booking. Re-checks the row against what is owed at this moment
 * first (the pending-payment rule): a link texted for £30 cannot be paid once the debt was paid at
 * the venue, waived or changed, and refusing before capture takes no money.
 */
async function captureParkingTopUp(
  booking: ParkingBooking,
  paypalOrderId: string,
  paymentRecord: { id: string; amount: number | string | null; currency: string | null },
  supabase: SupabaseClient<any, 'public', any>
): Promise<void> {
  const rule = await enforcePendingPaymentRule(supabase, booking, { reason: 'amount_changed_before_capture' })
  if (!rule.pending || rule.pending.id !== paymentRecord.id) {
    throw new ParkingTopUpAmountChangedError()
  }

  const orderDetails = await getPayPalOrder(paypalOrderId)
  const orderCustomId = orderDetails?.purchase_units?.[0]?.custom_id
  if (typeof orderCustomId !== 'string' || orderCustomId !== booking.id) {
    throw new Error('PayPal order does not belong to this booking')
  }
  const expectedCurrency = (paymentRecord.currency || PAYPAL_DEFAULT_CURRENCY).toUpperCase()
  const expectedAmount = Number(paymentRecord.amount || 0)
  const orderAmount = parsePayPalMoney(orderDetails?.purchase_units?.[0]?.amount?.value)
  if (
    orderAmount === null ||
    !payPalMoneyMatches(orderAmount, expectedAmount) ||
    extractPayPalOrderCurrency(orderDetails) !== expectedCurrency
  ) {
    throw new Error('PayPal order amount or currency does not match this booking')
  }

  const captureResult = await capturePayPalPayment(paypalOrderId, expectedCurrency)
  const capturedAmount = parsePayPalMoney(captureResult.amount)
  if (capturedAmount === null || !payPalMoneyMatches(capturedAmount, expectedAmount)) {
    throw new Error('Captured PayPal amount does not match this booking')
  }

  await recordCapturedTopUp(booking, {
    paymentId: paymentRecord.id,
    paypalOrderId,
    captureId: captureResult.transactionId,
    amount: capturedAmount,
    metadata: { ...(captureResult as any), paypal_order_id: paypalOrderId, purpose: 'top_up' },
    supabase,
  })
}

/**
 * Marks a captured top-up paid and sends the receipt text. The money has already been taken, so
 * this never refuses: a row that was expired while the customer was at PayPal is still recorded
 * as paid (any overpayment then shows as a refund to do). The receipt goes only from the path that
 * wins the guarded pending-to-paid update, so a webhook or the reconciliation cron landing at the
 * same moment does not text the customer twice.
 */
async function recordCapturedTopUp(
  booking: ParkingBooking,
  input: {
    paymentId: string
    paypalOrderId: string
    captureId: string | null
    amount: number
    metadata: Record<string, unknown>
    supabase: SupabaseClient<any, 'public', any>
  }
): Promise<{ recorded: boolean }> {
  const { supabase } = input
  const paidAt = new Date().toISOString()
  const { data: won, error } = await supabase
    .from('parking_booking_payments')
    .update({ status: 'paid', paid_at: paidAt, transaction_id: input.captureId, metadata: input.metadata })
    .eq('id', input.paymentId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.error('PayPal took a parking top-up but the payment row could not be updated', {
      error,
      metadata: { bookingId: booking.id, paypalOrderId: input.paypalOrderId, action: 'record this payment by hand' }
    })
    throw new Error('Failed to update payment status')
  }

  if (!won) {
    const { data: current, error: currentError } = await supabase
      .from('parking_booking_payments')
      .select('id, status, transaction_id')
      .eq('id', input.paymentId)
      .maybeSingle()
    if (currentError) throw new Error(currentError.message)
    if (current?.status === 'paid' && (!input.captureId || !current.transaction_id || current.transaction_id === input.captureId)) {
      // The webhook recorded this very capture first. It never texts, so send the receipt unless
      // one has already been logged for this payment.
      const { data: receipt, error: receiptError } = await supabase
        .from('parking_booking_notifications')
        .select('id')
        .eq('booking_id', booking.id)
        .eq('event_type', 'top_up_received')
        .contains('payload', { payment_id: input.paymentId })
        .limit(1)
        .maybeSingle()
      if (!receiptError && !receipt) {
        await sendTopUpReceipt(booking, input.amount, input.paymentId, supabase)
      }
      return { recorded: false }
    }
    // The row was expired while the customer was at PayPal, and the money has still been taken.
    // Record it: it must show, and the balance then reads as a refund to do.
    const { error: recordError } = await supabase
      .from('parking_booking_payments')
      .update({
        status: 'paid',
        paid_at: paidAt,
        transaction_id: input.captureId,
        metadata: { ...input.metadata, recorded_after_expiry: true }
      })
      .eq('id', input.paymentId)
      .neq('status', 'paid')
    if (recordError) throw new Error(recordError.message)
    logger.error('A parking top-up was paid after its link had been retired; check whether a refund is due', {
      error: new Error('Top-up captured against an expired payment row'),
      metadata: { bookingId: booking.id, paymentId: input.paymentId, captureId: input.captureId, amount: input.amount }
    })
  }

  await sendTopUpReceipt(booking, input.amount, input.paymentId, supabase)
  return { recorded: true }
}

async function sendTopUpReceipt(
  booking: ParkingBooking,
  amount: number,
  paymentId: string,
  supabase: SupabaseClient<any, 'public', any>
): Promise<void> {
  const replyNumber = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const smsBody = ensureReplyInstruction(buildTopUpReceivedSms(booking, amount), replyNumber)
  const email = parkingTopUpReceivedEmail(booking, amount)

  // Each top-up is its own receipt: payment_id keeps a second top-up of the same amount from
  // being refused as a duplicate of the first, in both channels.
  const result = await sendParkingCustomerMessage({
    client: supabase,
    booking,
    eventType: 'top_up_received',
    templateKey: 'parking_top_up_received',
    email,
    smsBody,
    dedupe: { payment_id: paymentId },
  })
  try {
    await logParkingNotification({
      booking_id: booking.id,
      channel: result.channel ?? firstChoiceChannel(booking),
      event_type: 'top_up_received',
      status: result.status === 'held' ? 'sent' : result.status,
      sent_at: result.status === 'sent' || result.status === 'held' ? new Date().toISOString() : null,
      message_sid: result.channel === 'sms' ? result.messageId : null,
      payload: { template_key: 'parking_top_up_received', payment_id: paymentId, amount, ...customerMessagePayload(result, email, smsBody) }
    }, supabase)
  } catch (logError) {
    logger.error('Failed to log the parking top-up receipt', {
      error: logError instanceof Error ? logError : new Error(String(logError)),
      metadata: { bookingId: booking.id, paymentId }
    })
  }
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

  // A top-up on a live, paid booking: record the money and send the top-up receipt. The booking's
  // status, confirmation and reminder flags are left alone (spec section 7).
  if (isTopUpBooking(booking)) {
    const { recorded } = await recordCapturedTopUp(booking, {
      paymentId: paymentRecord.id,
      paypalOrderId,
      captureId,
      amount: capturedAmount,
      metadata: { ...(capture as any), paypal_order_id: paypalOrderId, reconciled: true, purpose: 'top_up' },
      supabase,
    })
    return recorded ? booking : null
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
  // A completed stay keeps its status: the money is recorded above and shows on the booking.
  if (booking.status === 'completed') {
    logger.error('Parking payment captured against a stay that has already finished', {
      error: new Error('Payment recorded on a completed parking booking'),
      metadata: { bookingId: booking.id, paypalOrderId, captureId, amount: capturedAmount, action: 'check whether a refund is due' }
    })
    return null
  }

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

async function sendConfirmationNotifications(booking: ParkingBooking, supabase: SupabaseClient<any, 'public', any>) {
  const replyNumber = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const smsBody = ensureReplyInstruction(buildPaymentConfirmationSms(booking), replyNumber)
  const email = parkingConfirmationEmail(booking)

  // Email first; a text only for someone with no usable email (owner, 24 November 2026).
  const result = await sendParkingCustomerMessage({
    client: supabase,
    booking,
    eventType: 'payment_confirmation',
    templateKey: 'parking_payment_confirmation',
    email,
    smsBody,
  })
  try {
    await logParkingNotification({
      booking_id: booking.id,
      channel: result.channel ?? firstChoiceChannel(booking),
      event_type: 'payment_confirmation',
      status: result.status === 'held' ? 'sent' : result.status,
      sent_at: result.status === 'sent' || result.status === 'held' ? new Date().toISOString() : null,
      message_sid: result.channel === 'sms' ? result.messageId : null,
      payload: { template_key: 'parking_payment_confirmation', ...customerMessagePayload(result, email, smsBody) }
    }, supabase)
  } catch (logError) {
    logger.error('Failed to log the parking confirmation', {
      error: logError instanceof Error ? logError : new Error(String(logError)),
      metadata: { bookingId: booking.id }
    })
  }
  if (result.status === 'failed') {
    logger.warn('Parking payment confirmation failed to send', {
      metadata: { bookingId: booking.id, channel: result.channel, error: result.reason, code: result.code }
    })
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
      payload: { subject: managerEmail.subject, audience: 'manager' }
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
