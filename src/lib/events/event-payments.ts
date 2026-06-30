import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import {
  capturePayPalPayment,
  createInlinePayPalOrder,
  getPayPalOrder,
  isPayPalOrderNotFoundError,
} from '@/lib/paypal'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
import { resolveEventPriceAmount } from '@/lib/events/pricing'

export type EventPaymentTokenResult = {
  rawToken: string
  url: string
  expiresAt: string
}

export type EventPaymentPreviewResult =
  | {
    state: 'ready'
    bookingId: string
    customerId: string
    eventId: string
    eventName: string
    seats: number
    unitPrice: number
    totalAmount: number
    currency: string
    holdExpiresAt: string
    tokenHash: string
  }
  | {
    state: 'blocked'
    reason:
    | 'invalid_token'
    | 'token_expired'
    | 'token_used'
    | 'booking_not_found'
    | 'booking_not_pending_payment'
    | 'hold_expired'
    | 'event_not_found'
    | 'invalid_amount'
    | 'token_customer_mismatch'
  }

const EVENT_PAYMENT_GRACE_WINDOW_MS = 10 * 60 * 1000

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function resolveBaseUrl(appBaseUrl?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL
  const chosen = (appBaseUrl || fromEnv || 'http://localhost:3000').replace(/\/+$/, '')
  return chosen
}

function amountsMatch(left: number, right: number): boolean {
  return Math.abs(Number(left.toFixed(2)) - Number(right.toFixed(2))) < 0.01
}

function extractOrderAmount(order: any): number | null {
  const raw = order?.purchase_units?.[0]?.amount?.value
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

function extractOrderCurrency(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null
}

function extractOrderCustomId(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.custom_id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function isReusablePayPalOrder(order: any): boolean {
  const status = typeof order?.status === 'string' ? order.status.toUpperCase() : ''
  return status === 'CREATED' || status === 'APPROVED'
}

function eventPaymentRequestId(input: {
  bookingId: string
  eventId: string
  seats: number
  amount: number
  currency: string
  holdExpiresAt: string
}): string {
  const hash = createHash('sha256')
    .update([
      input.bookingId,
      input.eventId,
      String(input.seats),
      input.amount.toFixed(2),
      input.currency.toUpperCase(),
      input.holdExpiresAt,
    ].join(':'))
    .digest('hex')
    .slice(0, 24)
  return `event-ticket-${input.bookingId}-${hash}`.slice(0, 108)
}

function isDuplicateKeyError(error: unknown): boolean {
  const pgError = error as { code?: string } | null
  return pgError?.code === '23505'
}

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const { code: thrownCode, logFailure: thrownLogFailure } = extractSmsSafetyInfo(error)

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

type EventPayPalConfirmationState = 'confirmed' | 'already_confirmed' | 'manual_review'

export type EventPayPalOrderResult =
  | {
    state: 'created'
    orderId: string
    bookingId: string
    amount: number
    currency: string
    holdExpiresAt: string
  }
  | {
    state: 'blocked'
    reason: string
  }

export type EventPayPalCaptureResult =
  | {
    state: EventPayPalConfirmationState
    bookingId: string
    amount: number
    currency: string
    paymentId?: string | null
    reason?: string | null
  }
  | {
    state: 'blocked'
    reason: string
  }

export async function createEventPaymentToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    bookingId: string
    holdExpiresAt: string
    appBaseUrl?: string
  }
): Promise<EventPaymentTokenResult> {
  const holdExpiry = parseIsoDate(input.holdExpiresAt)
  if (!holdExpiry || holdExpiry.getTime() <= Date.now()) {
    throw new Error('Event payment hold has already expired')
  }

  const { rawToken } = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: 'payment',
    eventBookingId: input.bookingId,
    expiresAt: holdExpiry.toISOString()
  })

  const baseUrl = resolveBaseUrl(input.appBaseUrl)
  return {
    rawToken,
    url: `${baseUrl}/g/${rawToken}/event-payment`,
    expiresAt: holdExpiry.toISOString()
  }
}

export async function getEventPaymentPreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string,
  options: { allowGraceExpired?: boolean } = {}
): Promise<EventPaymentPreviewResult> {
  const tokenHash = hashGuestToken(rawToken)

  const { data: token, error: tokenError } = await supabase
    .from('guest_tokens')
    .select('id, customer_id, event_booking_id, expires_at, consumed_at')
    .eq('hashed_token', tokenHash)
    .eq('action_type', 'payment')
    .maybeSingle()

  if (tokenError) {
    throw tokenError
  }

  if (!token) {
    return { state: 'blocked', reason: 'invalid_token' }
  }

  if (token.consumed_at) {
    return { state: 'blocked', reason: 'token_used' }
  }

  const tokenExpiry = parseIsoDate(token.expires_at)
  if (
    !tokenExpiry ||
    (
      tokenExpiry.getTime() <= Date.now() &&
      (!options.allowGraceExpired || tokenExpiry.getTime() < Date.now() - EVENT_PAYMENT_GRACE_WINDOW_MS)
    )
  ) {
    return { state: 'blocked', reason: 'token_expired' }
  }

  if (!token.event_booking_id) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, seats, status, hold_expires_at, expired_at')
    .eq('id', token.event_booking_id)
    .maybeSingle()

  if (bookingError) {
    throw bookingError
  }

  if (!booking) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  if (booking.customer_id !== token.customer_id) {
    return { state: 'blocked', reason: 'token_customer_mismatch' }
  }

  if (
    booking.status !== 'pending_payment' &&
    !(options.allowGraceExpired && booking.status === 'expired')
  ) {
    return { state: 'blocked', reason: 'booking_not_pending_payment' }
  }

  const holdExpiry = parseIsoDate(booking.hold_expires_at)
  const expiredAt = parseIsoDate((booking as any).expired_at)
  if (
    (!holdExpiry || holdExpiry.getTime() <= Date.now()) &&
    (
      !options.allowGraceExpired ||
      ((expiredAt || holdExpiry)?.getTime() ?? 0) < Date.now() - EVENT_PAYMENT_GRACE_WINDOW_MS
    )
  ) {
    return { state: 'blocked', reason: 'hold_expired' }
  }
  if (!holdExpiry) {
    return { state: 'blocked', reason: 'hold_expired' }
  }

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('id, name, payment_mode, price_per_seat, price, online_discount_type, online_discount_value')
    .eq('id', booking.event_id)
    .maybeSingle()

  if (eventError) {
    throw eventError
  }

  if (!eventRow) {
    return { state: 'blocked', reason: 'event_not_found' }
  }

  const seats = Math.max(1, Number(booking.seats ?? 1))
  const unitPrice = resolveEventPriceAmount(eventRow)
  const totalAmount = Number((unitPrice * seats).toFixed(2))

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { state: 'blocked', reason: 'invalid_amount' }
  }

  return {
    state: 'ready',
    bookingId: booking.id,
    customerId: booking.customer_id,
    eventId: eventRow.id,
    eventName: eventRow.name || 'Event booking',
    seats,
    unitPrice,
    totalAmount,
    currency: 'GBP',
    holdExpiresAt: holdExpiry.toISOString(),
    tokenHash
  }
}

async function getEventPaymentPreviewByBookingId(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; allowGraceExpired?: boolean }
): Promise<EventPaymentPreviewResult> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, seats, status, hold_expires_at, expired_at')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingError) throw bookingError
  if (!booking) return { state: 'blocked', reason: 'booking_not_found' }
  if (
    booking.status !== 'pending_payment' &&
    !(input.allowGraceExpired && booking.status === 'expired')
  ) {
    return { state: 'blocked', reason: 'booking_not_pending_payment' }
  }

  const holdExpiry = parseIsoDate(booking.hold_expires_at)
  const expiredAt = parseIsoDate((booking as any).expired_at)
  if (
    (!holdExpiry || holdExpiry.getTime() <= Date.now()) &&
    (
      !input.allowGraceExpired ||
      ((expiredAt || holdExpiry)?.getTime() ?? 0) < Date.now() - EVENT_PAYMENT_GRACE_WINDOW_MS
    )
  ) {
    return { state: 'blocked', reason: 'hold_expired' }
  }
  if (!holdExpiry) {
    return { state: 'blocked', reason: 'hold_expired' }
  }

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('id, name, payment_mode, price_per_seat, price, online_discount_type, online_discount_value')
    .eq('id', booking.event_id)
    .maybeSingle()

  if (eventError) throw eventError
  if (!eventRow) return { state: 'blocked', reason: 'event_not_found' }

  const seats = Math.max(1, Number(booking.seats ?? 1))
  const unitPrice = resolveEventPriceAmount(eventRow)
  const totalAmount = Number((unitPrice * seats).toFixed(2))
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { state: 'blocked', reason: 'invalid_amount' }
  }

  return {
    state: 'ready',
    bookingId: booking.id,
    customerId: booking.customer_id,
    eventId: eventRow.id,
    eventName: eventRow.name || 'Event booking',
    seats,
    unitPrice,
    totalAmount,
    currency: 'GBP',
    holdExpiresAt: holdExpiry.toISOString(),
    tokenHash: ''
  }
}

async function createEventPayPalOrderFromPreview(
  supabase: SupabaseClient<any, 'public', any>,
  preview: Extract<EventPaymentPreviewResult, { state: 'ready' }>,
  source: 'guest_token' | 'booking_id'
): Promise<EventPayPalOrderResult> {
  const { data: existingPayment, error: existingError } = await supabase
    .from('payments')
    .select('id, paypal_order_id, paypal_capture_id, amount, currency, status')
    .eq('event_booking_id', preview.bookingId)
    .eq('charge_type', 'prepaid_event')
    .eq('payment_provider', 'paypal')
    .in('status', ['pending', 'succeeded'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  if (existingPayment?.paypal_capture_id || existingPayment?.status === 'succeeded') {
    return { state: 'blocked', reason: 'booking_not_pending_payment' }
  }

  if (existingPayment?.paypal_order_id) {
    try {
      const remote = await getPayPalOrder(existingPayment.paypal_order_id)
      const remoteAmount = extractOrderAmount(remote)
      const remoteCurrency = extractOrderCurrency(remote)
      const remoteCustomId = extractOrderCustomId(remote)
      if (
        isReusablePayPalOrder(remote) &&
        remoteAmount !== null &&
        amountsMatch(remoteAmount, preview.totalAmount) &&
        remoteCurrency === preview.currency.toUpperCase() &&
        remoteCustomId === `event_booking:${preview.bookingId}`
      ) {
        return {
          state: 'created',
          orderId: existingPayment.paypal_order_id,
          bookingId: preview.bookingId,
          amount: preview.totalAmount,
          currency: preview.currency,
          holdExpiresAt: preview.holdExpiresAt,
        }
      }
    } catch (error) {
      if (!isPayPalOrderNotFoundError(error)) {
        logger.warn('Failed to validate existing event PayPal order before replacing it', {
          metadata: {
            bookingId: preview.bookingId,
            orderId: existingPayment.paypal_order_id,
            error: error instanceof Error ? error.message : String(error),
          }
        })
      }
    }
  }

  const requestId = eventPaymentRequestId({
    bookingId: preview.bookingId,
    eventId: preview.eventId,
    seats: preview.seats,
    amount: preview.totalAmount,
    currency: preview.currency,
    holdExpiresAt: preview.holdExpiresAt,
  })

  const paypalOrder = await createInlinePayPalOrder({
    customId: `event_booking:${preview.bookingId}`,
    reference: 'event_booking',
    description: `${preview.eventName} (${preview.seats} seat${preview.seats === 1 ? '' : 's'})`,
    amount: preview.totalAmount,
    currency: preview.currency,
    requestId,
  })

  const nowIso = new Date().toISOString()
  const paymentPayload = {
    event_booking_id: preview.bookingId,
    charge_type: 'prepaid_event',
    payment_provider: 'paypal',
    payment_method: 'paypal',
    paypal_order_id: paypalOrder.orderId,
    amount: preview.totalAmount,
    currency: preview.currency,
    status: 'pending',
    metadata: {
      source,
      token_hash: preview.tokenHash || null,
      request_id: requestId,
      created_at: nowIso
    },
    updated_at: nowIso,
  }

  if (existingPayment?.id) {
    const { error: updateError } = await supabase
      .from('payments')
      .update(paymentPayload)
      .eq('id', existingPayment.id)
    if (updateError) throw updateError
  } else {
    const { error: insertError } = await supabase
      .from('payments')
      .insert(paymentPayload)
    if (insertError && !isDuplicateKeyError(insertError)) throw insertError
  }

  return {
    state: 'created',
    orderId: paypalOrder.orderId,
    bookingId: preview.bookingId,
    amount: preview.totalAmount,
    currency: preview.currency,
    holdExpiresAt: preview.holdExpiresAt,
  }
}

export async function createEventPayPalOrderByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: { rawToken: string }
): Promise<EventPayPalOrderResult> {
  const preview = await getEventPaymentPreviewByRawToken(supabase, input.rawToken)
  if (preview.state !== 'ready') return preview
  return createEventPayPalOrderFromPreview(supabase, preview, 'guest_token')
}

export async function createEventPayPalOrderByBookingId(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string }
): Promise<EventPayPalOrderResult> {
  const preview = await getEventPaymentPreviewByBookingId(supabase, input)
  if (preview.state !== 'ready') return preview
  return createEventPayPalOrderFromPreview(supabase, preview, 'booking_id')
}

async function captureEventPayPalOrderFromPreview(
  supabase: SupabaseClient<any, 'public', any>,
  preview: Extract<EventPaymentPreviewResult, { state: 'ready' }>,
  input: { orderId: string; source: string }
): Promise<EventPayPalCaptureResult> {
  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('id, paypal_order_id, paypal_capture_id, amount, currency, status')
    .eq('event_booking_id', preview.bookingId)
    .eq('charge_type', 'prepaid_event')
    .eq('payment_provider', 'paypal')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (paymentError) throw paymentError
  if (!payment?.paypal_order_id) return { state: 'blocked', reason: 'payment_order_not_found' }
  if (payment.paypal_order_id !== input.orderId) return { state: 'blocked', reason: 'order_mismatch' }

  const order = await getPayPalOrder(input.orderId)
  const orderAmount = extractOrderAmount(order)
  const orderCurrency = extractOrderCurrency(order)
  const orderCustomId = extractOrderCustomId(order)
  if (
    orderAmount === null ||
    !amountsMatch(orderAmount, preview.totalAmount) ||
    orderCurrency !== preview.currency.toUpperCase() ||
    orderCustomId !== `event_booking:${preview.bookingId}`
  ) {
    return { state: 'blocked', reason: 'amount_or_reference_mismatch' }
  }

  let captureId = payment.paypal_capture_id || null
  let capturedAmount = Number(payment.amount)
  let capturedCurrency = (payment.currency || preview.currency).toUpperCase()

  if (!captureId) {
    const capture = await capturePayPalPayment(input.orderId, preview.currency)
    captureId = capture.transactionId
    capturedAmount = Number(capture.amount)
    capturedCurrency = (capture.currency || preview.currency).toUpperCase()
    if (!captureId || !Number.isFinite(capturedAmount) || !amountsMatch(capturedAmount, preview.totalAmount)) {
      return { state: 'blocked', reason: 'capture_amount_mismatch' }
    }
    if (capture.customId && capture.customId !== `event_booking:${preview.bookingId}`) {
      return { state: 'blocked', reason: 'capture_reference_mismatch' }
    }
  }

  const { data: confirmRaw, error: confirmError } = await supabase.rpc(
    'confirm_event_paypal_payment_v01',
    {
      p_event_booking_id: preview.bookingId,
      p_paypal_order_id: input.orderId,
      p_paypal_capture_id: captureId,
      p_amount: capturedAmount,
      p_currency: capturedCurrency,
      p_source: input.source,
    }
  )

  if (confirmError) throw confirmError
  const confirm = (confirmRaw || {}) as Record<string, unknown>
  const state = typeof confirm.state === 'string' ? confirm.state : 'blocked'
  if (state === 'confirmed' || state === 'already_confirmed' || state === 'manual_review') {
    return {
      state,
      bookingId: preview.bookingId,
      amount: preview.totalAmount,
      currency: preview.currency,
      paymentId: typeof confirm.payment_id === 'string' ? confirm.payment_id : null,
      reason: typeof confirm.reason === 'string' ? confirm.reason : null,
    }
  }

  return {
    state: 'blocked',
    reason: typeof confirm.reason === 'string' ? confirm.reason : 'confirmation_blocked',
  }
}

export async function captureEventPayPalOrderByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: { rawToken: string; orderId: string }
): Promise<EventPayPalCaptureResult> {
  const preview = await getEventPaymentPreviewByRawToken(supabase, input.rawToken, { allowGraceExpired: true })
  if (
    preview.state === 'blocked' &&
    (preview.reason === 'booking_not_pending_payment' || preview.reason === 'token_used')
  ) {
    const { data: payment } = await supabase
      .from('payments')
      .select('event_booking_id, amount, currency, paypal_capture_id, status')
      .eq('paypal_order_id', input.orderId)
      .eq('payment_provider', 'paypal')
      .eq('charge_type', 'prepaid_event')
      .maybeSingle()
    if (payment?.event_booking_id && payment.status === 'succeeded') {
      return {
        state: 'already_confirmed',
        bookingId: payment.event_booking_id,
        amount: Number(payment.amount),
        currency: payment.currency || 'GBP',
        paymentId: null,
      }
    }
  }
  if (preview.state !== 'ready') return preview
  return captureEventPayPalOrderFromPreview(supabase, preview, {
    orderId: input.orderId,
    source: 'guest_capture',
  })
}

export async function captureEventPayPalOrderByBookingId(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; orderId: string }
): Promise<EventPayPalCaptureResult> {
  const preview = await getEventPaymentPreviewByBookingId(supabase, { ...input, allowGraceExpired: true })
  if (preview.state === 'blocked' && preview.reason === 'booking_not_pending_payment') {
    const { data: payment } = await supabase
      .from('payments')
      .select('id, amount, currency, paypal_capture_id, status')
      .eq('event_booking_id', input.bookingId)
      .eq('paypal_order_id', input.orderId)
      .eq('payment_provider', 'paypal')
      .eq('charge_type', 'prepaid_event')
      .maybeSingle()
    if (payment?.status === 'succeeded') {
      return {
        state: 'already_confirmed',
        bookingId: input.bookingId,
        amount: Number(payment.amount),
        currency: payment.currency || 'GBP',
        paymentId: payment.id,
      }
    }
  }
  if (preview.state !== 'ready') return preview
  return captureEventPayPalOrderFromPreview(supabase, preview, {
    orderId: input.orderId,
    source: 'external_capture',
  })
}

export async function sendEventPaymentConfirmationSms(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    eventName: string
    seats: number
    appBaseUrl?: string
  }
): Promise<EventPaymentSmsMeta> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, seats, events(id, name, start_datetime, date, time)')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingError) {
    logger.error('Failed to load booking for event payment confirmation SMS', {
      metadata: {
        bookingId: input.bookingId,
        error: bookingError.message,
      }
    })
    return { success: false, code: 'safety_unavailable', logFailure: false }
  }

  if (!booking?.customer_id) {
    return { success: false, code: null, logFailure: false }
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', booking.customer_id)
    .maybeSingle()

  if (customerError) {
    logger.error('Failed to load customer for event payment confirmation SMS', {
      metadata: {
        bookingId: input.bookingId,
        customerId: booking.customer_id,
        error: customerError.message,
      }
    })
    return { success: false, code: 'safety_unavailable', logFailure: false }
  }

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return { success: false, code: null, logFailure: false }
  }

  const firstName = getSmartFirstName(customer.first_name)
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  let manageLink: string | null = null
  let eventDateFormatted: string | null = null
  try {
    const eventRaw = (booking as any).events
    const eventRow = Array.isArray(eventRaw) ? eventRaw[0] : eventRaw
    const eventStartIso = eventRow?.start_datetime || null

    if (eventStartIso) {
      try {
        eventDateFormatted = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/London',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }).format(new Date(eventStartIso))
      } catch {
        eventDateFormatted = null
      }
    }

    const manageToken = await createEventManageToken(supabase, {
      customerId: customer.id,
      bookingId: booking.id,
      eventStartIso,
      appBaseUrl: input.appBaseUrl
    })
    manageLink = manageToken.url
  } catch {
    manageLink = null
  }

  const eventRaw = (booking as any).events
  const eventRow = Array.isArray(eventRaw) ? eventRaw[0] : eventRaw
  const eventName = eventRow?.name || input.eventName
  const seats = Math.max(1, Number((booking as any).seats ?? input.seats))
  const seatLabel = seats === 1 ? 'seat' : 'seats'
  const datePart = eventDateFormatted ? ` on ${eventDateFormatted}` : ''
  const body = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, payment received. Your booking for ${eventName}${datePart} is confirmed for ${seats} ${seatLabel}.${manageLink ? ` Manage booking: ${manageLink}` : ''}`,
    supportPhone
  )

  try {
    const smsResult = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: {
        event_booking_id: input.bookingId,
        template_key: 'event_payment_confirmed'
      }
    })
    const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
    const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'

    if (smsLogFailure) {
      logger.error('Event payment confirmation SMS sent but outbound message logging failed', {
        metadata: {
          bookingId: input.bookingId,
          customerId: customer.id,
          code: smsCode,
          logFailure: smsLogFailure,
        }
      })
    }

    if (!smsResult.success) {
      logger.warn('Event payment confirmation SMS send returned non-success', {
        metadata: {
          bookingId: input.bookingId,
          customerId: customer.id,
          error: smsResult.error,
          code: smsCode,
        }
      })
    }
    return {
      success: smsResult.success === true,
      code: smsCode,
      logFailure: smsLogFailure
    }
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Event payment confirmation SMS send threw unexpectedly', {
      metadata: {
        bookingId: input.bookingId,
        customerId: customer.id,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      }
    })
    return { success: false, code: thrownSafety.code, logFailure: thrownSafety.logFailure }
  }
}

export async function sendEventPaymentManualReviewSms(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
  }
): Promise<EventPaymentSmsMeta> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, events(id, name)')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingError || !booking?.customer_id) {
    return { success: false, code: bookingError ? 'safety_unavailable' : null, logFailure: false }
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', booking.customer_id)
    .maybeSingle()

  if (customerError || !customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return { success: false, code: customerError ? 'safety_unavailable' : null, logFailure: false }
  }

  const eventRaw = (booking as any).events
  const eventRow = Array.isArray(eventRaw) ? eventRaw[0] : eventRaw
  const eventName = eventRow?.name || 'your event'
  const firstName = getSmartFirstName(customer.first_name)
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const body = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, we have received your payment for ${eventName}, but staff need to check your booking before confirming. We will contact you shortly.`,
    supportPhone
  )

  try {
    const smsResult = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: {
        event_booking_id: input.bookingId,
        template_key: 'event_payment_manual_review'
      }
    })
    return {
      success: smsResult.success === true,
      code: typeof smsResult.code === 'string' ? smsResult.code : null,
      logFailure: smsResult.logFailure === true || smsResult.code === 'logging_failed'
    }
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    return { success: false, code: thrownSafety.code, logFailure: thrownSafety.logFailure }
  }
}

export type EventPaymentSmsMeta = {
  success: boolean
  code: string | null
  logFailure: boolean
}

function formatSeatCount(count: number): string {
  return `${count} ${count === 1 ? 'seat' : 'seats'}`
}

export type EventBookingSeatUpdateSmsResult = {
  success: boolean
  code?: string | null
  logFailure?: boolean
}

export async function sendEventBookingSeatUpdateSms(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    eventName?: string | null
    oldSeats: number
    newSeats: number
    appBaseUrl?: string
  }
): Promise<EventBookingSeatUpdateSmsResult> {
  if (input.oldSeats === input.newSeats) {
    return { success: false, code: null, logFailure: false }
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingError) {
    logger.error('Failed to load booking for event seat update SMS', {
      metadata: {
        bookingId: input.bookingId,
        error: bookingError.message,
      }
    })
    return { success: false, code: 'safety_unavailable', logFailure: false }
  }

  if (!booking?.customer_id) {
    return { success: false, code: null, logFailure: false }
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', booking.customer_id)
    .maybeSingle()

  if (customerError) {
    logger.error('Failed to load customer for event seat update SMS', {
      metadata: {
        bookingId: input.bookingId,
        customerId: booking.customer_id,
        error: customerError.message,
      }
    })
    return { success: false, code: 'safety_unavailable', logFailure: false }
  }

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return { success: false, code: null, logFailure: false }
  }

  const firstName = getSmartFirstName(customer.first_name)
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const eventName = input.eventName || 'your event'
  const oldLabel = formatSeatCount(Math.max(1, input.oldSeats))
  const newLabel = formatSeatCount(Math.max(1, input.newSeats))

  let manageLink: string | null = null
  try {
    const { data: eventRow } = await supabase
      .from('events')
      .select('start_datetime, date, time')
      .eq('id', booking.event_id)
      .maybeSingle()
    const eventStartIso = eventRow?.start_datetime || null

    const manageToken = await createEventManageToken(supabase, {
      customerId: customer.id,
      bookingId: booking.id,
      eventStartIso,
      appBaseUrl: input.appBaseUrl
    })
    manageLink = manageToken.url
  } catch {
    manageLink = null
  }

  const body = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, your booking for ${eventName} has been updated from ${oldLabel} to ${newLabel}.${manageLink ? ` Manage booking: ${manageLink}` : ''}`,
    supportPhone
  )

  try {
    const smsResult = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: {
        event_booking_id: input.bookingId,
        event_id: booking.event_id,
        template_key: 'event_booking_seats_updated'
      }
    })
    const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
    const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'

    if (smsLogFailure) {
      logger.error('Event booking seat update SMS sent but outbound message logging failed', {
        metadata: {
          bookingId: input.bookingId,
          customerId: customer.id,
          code: smsCode,
          logFailure: smsLogFailure,
        }
      })
    }

    if (!smsResult.success) {
      logger.warn('Event booking seat update SMS send returned non-success', {
        metadata: {
          bookingId: input.bookingId,
          customerId: customer.id,
          error: smsResult.error,
          code: smsCode,
          logFailure: smsLogFailure,
        }
      })
      return {
        success: false,
        code: smsCode ?? undefined,
        logFailure: smsLogFailure
      }
    }
    return {
      success: true,
      code: smsCode ?? undefined,
      logFailure: smsLogFailure
    }
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Event booking seat update SMS send threw unexpectedly', {
      metadata: {
        bookingId: input.bookingId,
        customerId: customer.id,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      }
    })
    return {
      success: false,
      code: thrownSafety.code,
      logFailure: thrownSafety.logFailure
    }
  }
}

export async function sendEventPaymentRetrySms(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    appBaseUrl?: string
  }
): Promise<EventPaymentSmsMeta> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, seats, status, hold_expires_at')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingError) {
    logger.error('Failed to load booking for event payment retry SMS', {
      metadata: {
        bookingId: input.bookingId,
        error: bookingError.message,
      }
    })
    return { success: false, code: 'safety_unavailable', logFailure: false }
  }

  if (!booking || booking.status !== 'pending_payment' || !booking.hold_expires_at) {
    return { success: false, code: null, logFailure: false }
  }

  const holdExpiresAt = parseIsoDate(booking.hold_expires_at)
  if (!holdExpiresAt || holdExpiresAt.getTime() <= Date.now()) {
    return { success: false, code: null, logFailure: false }
  }

  const [{ data: customer, error: customerError }, { data: event, error: eventError }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, first_name, mobile_number, sms_status')
      .eq('id', booking.customer_id)
      .maybeSingle(),
    supabase
      .from('events')
      .select('id, name')
      .eq('id', booking.event_id)
      .maybeSingle()
  ])

  if (customerError || eventError) {
    logger.error('Failed to load customer/event context for event payment retry SMS', {
      metadata: {
        bookingId: booking.id,
        customerId: booking.customer_id,
        eventId: booking.event_id,
        customerError: customerError?.message,
        eventError: eventError?.message,
      }
    })
    return { success: false, code: 'safety_unavailable', logFailure: false }
  }

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return { success: false, code: null, logFailure: false }
  }

  let paymentLink: string
  try {
    const token = await createEventPaymentToken(supabase, {
      customerId: booking.customer_id,
      bookingId: booking.id,
      holdExpiresAt: booking.hold_expires_at,
      appBaseUrl: input.appBaseUrl
    })
    paymentLink = token.url
  } catch {
    return { success: false, code: null, logFailure: false }
  }

  const firstName = getSmartFirstName(customer.first_name)
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const body = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, your event payment wasn't completed. Please try again here: ${paymentLink}`,
    supportPhone
  )

  try {
    const smsResult = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: {
        event_booking_id: booking.id,
        event_id: event?.id ?? null,
        template_key: 'event_payment_retry'
      }
    })
    const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
    const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'

    if (smsLogFailure) {
      logger.error('Event payment retry SMS sent but outbound message logging failed', {
        metadata: {
          bookingId: booking.id,
          customerId: customer.id,
          code: smsCode,
          logFailure: smsLogFailure,
        }
      })
    }

    if (!smsResult.success) {
      logger.warn('Event payment retry SMS send returned non-success', {
        metadata: {
          bookingId: booking.id,
          customerId: customer.id,
          error: smsResult.error,
          code: smsCode,
        }
      })
    }
    return {
      success: smsResult.success === true,
      code: smsCode,
      logFailure: smsLogFailure
    }
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Event payment retry SMS send threw unexpectedly', {
      metadata: {
        bookingId: booking.id,
        customerId: customer.id,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      }
    })
    return { success: false, code: thrownSafety.code, logFailure: thrownSafety.logFailure }
  }
}
