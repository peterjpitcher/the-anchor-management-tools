import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { createStripeCheckoutSession, type StripeCheckoutSession } from '@/lib/payments/stripe'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { createEventManageToken } from '@/lib/events/manage-booking'

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

function formatPence(amount: number): number {
  return Math.round(amount * 100)
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
  rawToken: string
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
  if (!tokenExpiry || tokenExpiry.getTime() <= Date.now()) {
    return { state: 'blocked', reason: 'token_expired' }
  }

  if (!token.event_booking_id) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, seats, status, hold_expires_at')
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

  if (booking.status !== 'pending_payment') {
    return { state: 'blocked', reason: 'booking_not_pending_payment' }
  }

  const holdExpiry = parseIsoDate(booking.hold_expires_at)
  if (!holdExpiry || holdExpiry.getTime() <= Date.now()) {
    return { state: 'blocked', reason: 'hold_expired' }
  }

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('id, name, price_per_seat, price')
    .eq('id', booking.event_id)
    .maybeSingle()

  if (eventError) {
    throw eventError
  }

  if (!eventRow) {
    return { state: 'blocked', reason: 'event_not_found' }
  }

  const seats = Math.max(1, Number(booking.seats ?? 1))
  const unitPrice = Number(eventRow.price_per_seat ?? eventRow.price ?? 0)
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

function computeStripeSessionExpiryUnix(holdExpiresAtIso: string): number | undefined {
  const holdExpiry = parseIsoDate(holdExpiresAtIso)
  if (!holdExpiry) {
    return undefined
  }

  const now = Date.now()
  const holdExpiryMs = holdExpiry.getTime()
  const minimumWindowMs = 31 * 60 * 1000
  if (holdExpiryMs - now < minimumWindowMs) {
    return undefined
  }

  return Math.floor(holdExpiryMs / 1000)
}

export async function createEventCheckoutSessionByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    appBaseUrl?: string
  }
): Promise<
  | {
      state: 'created'
      checkoutUrl: string
      session: StripeCheckoutSession
      bookingId: string
    }
  | {
      state: 'blocked'
      reason: EventPaymentPreviewResult extends { state: 'blocked'; reason: infer R } ? R : string
    }
> {
  const preview = await getEventPaymentPreviewByRawToken(supabase, input.rawToken)
  if (preview.state !== 'ready') {
    return preview
  }

  const baseUrl = resolveBaseUrl(input.appBaseUrl)
  const tokenEncoded = encodeURIComponent(input.rawToken)

  const successUrl = `${baseUrl}/g/${tokenEncoded}/event-payment?state=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}/g/${tokenEncoded}/event-payment?state=cancelled`

  const session = await createStripeCheckoutSession({
    idempotencyKey: `event_booking_checkout_${preview.bookingId}_${preview.tokenHash.slice(0, 24)}`,
    successUrl,
    cancelUrl,
    bookingId: preview.bookingId,
    eventId: preview.eventId,
    quantity: preview.seats,
    unitAmountMinor: formatPence(preview.unitPrice),
    currency: preview.currency,
    productName: `${preview.eventName} (${preview.seats} seat${preview.seats === 1 ? '' : 's'})`,
    tokenHash: preview.tokenHash,
    expiresAtUnix: computeStripeSessionExpiryUnix(preview.holdExpiresAt)
  })

  if (!session.url) {
    throw new Error('Stripe checkout session did not return a URL')
  }

  const nowIso = new Date().toISOString()
  const { error: paymentInsertError } = await supabase
    .from('payments')
    .insert({
      event_booking_id: preview.bookingId,
      charge_type: 'prepaid_event',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent ?? null,
      amount: preview.totalAmount,
      currency: preview.currency,
      status: 'pending',
      metadata: {
        source: 'guest_token',
        token_hash: preview.tokenHash,
        checkout_url: session.url,
        created_at: nowIso
      }
    })

  if (paymentInsertError) {
    logger.error('Failed to store pending event payment row', {
      error: new Error(paymentInsertError.message),
      metadata: { bookingId: preview.bookingId, checkoutSessionId: session.id }
    })
  }

  return {
    state: 'created',
    checkoutUrl: session.url,
    session,
    bookingId: preview.bookingId
  }
}

export async function sendEventPaymentConfirmationSms(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    eventName: string
    seats: number
    appBaseUrl?: string
  }
): Promise<void> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingError || !booking?.customer_id) {
    return
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', booking.customer_id)
    .maybeSingle()

  if (customerError || !customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return
  }

  const firstName = customer.first_name || 'there'
  const seatWord = input.seats === 1 ? 'seat' : 'seats'
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
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
    `The Anchor: Hi ${firstName}, payment received. Your booking for ${input.eventName} is confirmed for ${input.seats} ${seatWord}.${manageLink ? ` Manage booking: ${manageLink}` : ''}`,
    supportPhone
  )

  await sendSMS(customer.mobile_number, body, {
    customerId: customer.id,
    metadata: {
      event_booking_id: input.bookingId,
      template_key: 'event_payment_confirmed'
    }
  })
}

export async function sendEventPaymentRetrySms(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    appBaseUrl?: string
  }
): Promise<void> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, seats, status, hold_expires_at')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingError || !booking || booking.status !== 'pending_payment' || !booking.hold_expires_at) {
    return
  }

  const holdExpiresAt = parseIsoDate(booking.hold_expires_at)
  if (!holdExpiresAt || holdExpiresAt.getTime() <= Date.now()) {
    return
  }

  const [{ data: customer }, { data: event }] = await Promise.all([
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

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return
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
    return
  }

  const firstName = customer.first_name || 'there'
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const body = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, your event payment wasn't completed. Please try again here: ${paymentLink}`,
    supportPhone
  )

  await sendSMS(customer.mobile_number, body, {
    customerId: customer.id,
    metadata: {
      event_booking_id: booking.id,
      event_id: event?.id ?? null,
      template_key: 'event_payment_retry'
    }
  })
}
