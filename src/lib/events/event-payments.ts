import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { createStripeCheckoutSession, type StripeCheckoutSession } from '@/lib/payments/stripe'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
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

function isDuplicateKeyError(error: unknown): boolean {
  const pgError = error as { code?: string } | null
  return pgError?.code === '23505'
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
  const { data: existingPayment, error: existingPaymentLookupError } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .limit(1)
    .maybeSingle()

  if (existingPaymentLookupError) {
    throw new Error(
      `Failed to verify pending event payment row before checkout persistence: ${existingPaymentLookupError.message}`
    )
  }

  if (!existingPayment) {
    const { data: insertedPayment, error: paymentInsertError } = await supabase
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
      .select('id')
      .maybeSingle()

    if (paymentInsertError) {
      if (!isDuplicateKeyError(paymentInsertError)) {
        throw new Error(
          `Failed to persist pending event payment row: ${paymentInsertError.message}`
        )
      }

      const { data: concurrentPayment, error: concurrentLookupError } = await supabase
        .from('payments')
        .select('id')
        .eq('stripe_checkout_session_id', session.id)
        .limit(1)
        .maybeSingle()

      if (concurrentLookupError) {
        throw new Error(
          `Failed to resolve concurrent pending event payment row after duplicate insert: ${concurrentLookupError.message}`
        )
      }

      if (!concurrentPayment) {
        throw new Error('Failed to resolve concurrent pending event payment row after duplicate insert')
      }
    } else if (!insertedPayment) {
      throw new Error('Pending event payment insert affected no rows')
    }
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
): Promise<EventPaymentSmsMeta> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id')
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
