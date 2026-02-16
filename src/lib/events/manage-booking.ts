import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { createStripeCheckoutSession, createStripeRefund } from '@/lib/payments/stripe'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'

export type EventManagePreviewResult = {
  state: 'ready' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  event_start_datetime?: string
  status?: string
  seats?: number
  payment_mode?: 'free' | 'cash_only' | 'prepaid'
  price_per_seat?: number
  can_cancel?: boolean
  can_change_seats?: boolean
}

export type EventManageSeatsUpdateResult = {
  state: 'updated' | 'unchanged' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  event_start_datetime?: string
  status?: string
  payment_mode?: 'free' | 'cash_only' | 'prepaid'
  price_per_seat?: number
  old_seats?: number
  new_seats?: number
  delta?: number
  seats_remaining?: number
}

export type EventManageCancelResult = {
  state: 'cancelled' | 'already_cancelled' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  event_start_datetime?: string
  payment_mode?: 'free' | 'cash_only' | 'prepaid'
  price_per_seat?: number
  seats?: number
  previous_status?: string
}

export type EventRefundPolicy = {
  refundRate: number
  policyBand: 'full' | 'partial' | 'none'
}

export type EventRefundResult = {
  status: 'none' | 'succeeded' | 'pending' | 'failed' | 'manual_required'
  amount: number
  currency: string
  stripeRefundId?: string
  reason?: string
}

export type EventSeatIncreaseCheckoutResult =
  | {
      state: 'created'
      checkoutUrl: string
      bookingId: string
      targetSeats: number
      deltaSeats: number
      amount: number
      currency: string
      sessionId: string
    }
  | {
      state: 'blocked'
      reason:
        | 'token_invalid'
        | 'booking_not_manageable'
        | 'prepaid_required'
        | 'booking_not_confirmed'
        | 'invalid_target_seats'
        | 'event_started'
        | 'invalid_amount'
    }

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const MANAGE_TOKEN_MAX_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000
const MANAGE_TOKEN_FALLBACK_MS = 48 * 60 * 60 * 1000

export function getEventRefundPolicy(eventStartIso: string, now = new Date()): EventRefundPolicy {
  const eventStart = Date.parse(eventStartIso)
  if (!Number.isFinite(eventStart)) {
    return { refundRate: 0, policyBand: 'none' }
  }

  const diffMs = eventStart - now.getTime()
  if (diffMs >= SEVEN_DAYS_MS) {
    return { refundRate: 1, policyBand: 'full' }
  }

  if (diffMs >= THREE_DAYS_MS) {
    return { refundRate: 0.5, policyBand: 'partial' }
  }

  return { refundRate: 0, policyBand: 'none' }
}

function roundCurrencyAmount(value: number): number {
  return Number(value.toFixed(2))
}

function amountToMinor(value: number): number {
  return Math.round(value * 100)
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function computeCheckoutExpiryUnix(holdUntil: Date | null): number | undefined {
  if (!holdUntil) return undefined
  const minWindowMs = 31 * 60 * 1000
  const nowMs = Date.now()
  if (holdUntil.getTime() - nowMs < minWindowMs) {
    return undefined
  }
  return Math.floor(holdUntil.getTime() / 1000)
}

function resolveBaseUrl(appBaseUrl?: string): string {
  return (appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

function computeManageTokenExpiry(eventStartIso?: string | null): string {
  const nowMs = Date.now()
  const maxMs = nowMs + MANAGE_TOKEN_MAX_LIFETIME_MS
  const eventStartMs = eventStartIso ? Date.parse(eventStartIso) : Number.NaN

  if (Number.isFinite(eventStartMs)) {
    const suggestedMs = eventStartMs + MANAGE_TOKEN_FALLBACK_MS
    return new Date(Math.min(Math.max(suggestedMs, nowMs + 60 * 60 * 1000), maxMs)).toISOString()
  }

  return new Date(Math.min(nowMs + MANAGE_TOKEN_FALLBACK_MS, maxMs)).toISOString()
}

function mapRefundStatus(status: string | null): 'refunded' | 'pending' | 'failed' {
  switch (status) {
    case 'succeeded':
      return 'refunded'
    case 'pending':
    case 'requires_action':
      return 'pending'
    default:
      return 'failed'
  }
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '23505'
}

export async function getEventManagePreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<EventManagePreviewResult> {
  const hashedToken = hashGuestToken(rawToken)
  const { data, error } = await supabase.rpc('get_event_booking_manage_preview_v05', {
    p_hashed_token: hashedToken
  })

  if (error) {
    throw error
  }

  return (data ?? {}) as EventManagePreviewResult
}

export async function updateEventBookingSeatsByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    newSeats: number
    actor?: string
  }
): Promise<EventManageSeatsUpdateResult> {
  const hashedToken = hashGuestToken(input.rawToken)
  const { data, error } = await supabase.rpc('update_event_booking_seats_v05', {
    p_hashed_token: hashedToken,
    p_new_seats: input.newSeats,
    p_actor: input.actor || 'guest'
  })

  if (error) {
    throw error
  }

  return (data ?? {}) as EventManageSeatsUpdateResult
}

export async function updateEventBookingSeatsById(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    newSeats: number
    actor?: string
  }
): Promise<EventManageSeatsUpdateResult> {
  const { data, error } = await supabase.rpc('update_event_booking_seats_staff_v05', {
    p_booking_id: input.bookingId,
    p_new_seats: input.newSeats,
    p_actor: input.actor || 'staff'
  })

  if (error) {
    throw error
  }

  return (data ?? {}) as EventManageSeatsUpdateResult
}

export async function cancelEventBookingByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    cancelledBy?: string
  }
): Promise<EventManageCancelResult> {
  const hashedToken = hashGuestToken(input.rawToken)
  const { data, error } = await supabase.rpc('cancel_event_booking_v05', {
    p_hashed_token: hashedToken,
    p_cancelled_by: input.cancelledBy || 'guest'
  })

  if (error) {
    throw error
  }

  return (data ?? {}) as EventManageCancelResult
}

export async function processEventRefund(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    customerId: string
    eventId: string
    amount: number
    reason: string
    metadata?: Record<string, unknown>
  }
): Promise<EventRefundResult> {
  const refundAmount = roundCurrencyAmount(input.amount)
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    return {
      status: 'none',
      amount: 0,
      currency: 'GBP'
    }
  }

  const { data: payment, error: paymentLookupError } = await supabase
    .from('payments')
    .select('id, amount, currency, stripe_payment_intent_id')
    .eq('event_booking_id', input.bookingId)
    .in('charge_type', ['prepaid_event', 'seat_increase'])
    .in('status', ['succeeded', 'partially_refunded'])
    .not('stripe_payment_intent_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (paymentLookupError) {
    throw paymentLookupError
  }

  if (!payment?.stripe_payment_intent_id) {
    return {
      status: 'manual_required',
      amount: refundAmount,
      currency: 'GBP',
      reason: 'payment_intent_not_found'
    }
  }

  const { data: existingRefund, error: existingRefundError } = await (supabase.from('payments') as any)
    .select('id, status, currency, metadata')
    .eq('event_booking_id', input.bookingId)
    .eq('charge_type', 'refund')
    .contains('metadata', { source_payment_id: payment.id })
    .in('status', ['refunded', 'pending', 'succeeded'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingRefundError) {
    throw existingRefundError
  }

  if (existingRefund) {
    const existingMetadata =
      typeof existingRefund.metadata === 'object' && existingRefund.metadata !== null
        ? (existingRefund.metadata as Record<string, unknown>)
        : {}

    const existingStripeRefundId =
      typeof existingMetadata.stripe_refund_id === 'string' ? existingMetadata.stripe_refund_id : undefined

    if (existingRefund.status === 'pending') {
      return {
        status: 'pending',
        amount: refundAmount,
        currency: (existingRefund.currency || payment.currency || 'GBP').toUpperCase(),
        stripeRefundId: existingStripeRefundId
      }
    }

    return {
      status: 'succeeded',
      amount: refundAmount,
      currency: (existingRefund.currency || payment.currency || 'GBP').toUpperCase(),
      stripeRefundId: existingStripeRefundId
    }
  }

  let stripeRefundMeta: { id: string; status: string; currency: string | null } | null = null

  try {
    const stripeRefund = await createStripeRefund({
      paymentIntentId: payment.stripe_payment_intent_id,
      amountMinor: amountToMinor(refundAmount),
      reason: 'requested_by_customer',
      idempotencyKey: `event_refund_${input.bookingId}_${payment.id}_${amountToMinor(refundAmount)}`
    })
    stripeRefundMeta = {
      id: stripeRefund.id,
      status: String(stripeRefund.status || 'unknown'),
      currency: stripeRefund.currency || null
    }

    const mappedStatus = mapRefundStatus(stripeRefund.status)
    const paymentStatus =
      mappedStatus === 'refunded'
        ? 'refunded'
        : mappedStatus === 'pending'
          ? 'pending'
          : 'failed'

    const currency = (stripeRefund.currency || payment.currency || 'GBP').toUpperCase()

    const { error: refundInsertError } = await supabase
      .from('payments')
      .insert({
        event_booking_id: input.bookingId,
        charge_type: 'refund',
        stripe_payment_intent_id: payment.stripe_payment_intent_id,
        amount: refundAmount,
        currency,
        status: paymentStatus,
        metadata: {
          source_payment_id: payment.id,
          stripe_refund_id: stripeRefund.id,
          stripe_refund_status: stripeRefund.status,
          reason: input.reason,
          ...(input.metadata || {})
        }
      })

    if (refundInsertError) {
      throw refundInsertError
    }

    if (mappedStatus === 'refunded' || mappedStatus === 'pending') {
      try {
        await recordAnalyticsEvent(supabase, {
          customerId: input.customerId,
          eventBookingId: input.bookingId,
          eventType: 'refund_created',
          metadata: {
            event_id: input.eventId,
            amount: refundAmount,
            currency,
            stripe_refund_id: stripeRefund.id,
            stripe_refund_status: stripeRefund.status,
            reason: input.reason
          }
        })
      } catch (analyticsError) {
        logger.warn('Failed to record event refund analytics event', {
          metadata: {
            bookingId: input.bookingId,
            customerId: input.customerId,
            error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
          }
        })
      }
    }

    return {
      status: mappedStatus === 'refunded' ? 'succeeded' : mappedStatus,
      amount: refundAmount,
      currency,
      stripeRefundId: stripeRefund.id
    }
  } catch (error) {
    logger.error('Event refund request failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        bookingId: input.bookingId,
        amount: refundAmount
      }
    })

    const { error: failedInsertError } = await supabase
      .from('payments')
      .insert({
        event_booking_id: input.bookingId,
        charge_type: 'refund',
        amount: refundAmount,
        currency: (stripeRefundMeta?.currency || payment.currency || 'GBP').toUpperCase(),
        status: stripeRefundMeta ? 'pending' : 'failed',
        metadata: {
          reason: input.reason,
          error: error instanceof Error ? error.message : String(error),
          source_payment_id: payment.id,
          stripe_refund_id: stripeRefundMeta?.id,
          stripe_refund_status: stripeRefundMeta?.status,
          persistence_gap: stripeRefundMeta ? true : undefined,
          ...(input.metadata || {})
        }
      })

    if (failedInsertError) {
      logger.warn('Failed persisting event refund fallback row', {
        metadata: {
          bookingId: input.bookingId,
          amount: refundAmount,
          error: failedInsertError.message
        }
      })
    }

    return {
      status: stripeRefundMeta ? 'manual_required' : 'failed',
      amount: refundAmount,
      currency: (stripeRefundMeta?.currency || payment.currency || 'GBP').toUpperCase(),
      reason: stripeRefundMeta
        ? 'refund_processed_but_local_record_failed'
        : error instanceof Error
          ? error.message
          : String(error)
    }
  }
}

export async function createEventManageToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    bookingId: string
    eventStartIso?: string | null
    appBaseUrl?: string
  }
): Promise<{ rawToken: string; url: string; expiresAt: string }> {
  const expiresAt = computeManageTokenExpiry(input.eventStartIso)
  const token = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: 'manage',
    eventBookingId: input.bookingId,
    expiresAt
  })

  const baseUrl = resolveBaseUrl(input.appBaseUrl)
  return {
    rawToken: token.rawToken,
    url: `${baseUrl}/g/${token.rawToken}/manage-booking`,
    expiresAt
  }
}

export async function createSeatIncreaseCheckoutByManageToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    targetSeats: number
    appBaseUrl?: string
  }
): Promise<EventSeatIncreaseCheckoutResult> {
  const preview = await getEventManagePreviewByRawToken(supabase, input.rawToken)
  if (preview.state !== 'ready' || !preview.booking_id || !preview.event_id || !preview.event_start_datetime) {
    return { state: 'blocked', reason: 'token_invalid' }
  }

  if (!preview.can_change_seats) {
    return { state: 'blocked', reason: 'booking_not_manageable' }
  }

  if (preview.payment_mode !== 'prepaid') {
    return { state: 'blocked', reason: 'prepaid_required' }
  }

  if (preview.status !== 'confirmed') {
    return { state: 'blocked', reason: 'booking_not_confirmed' }
  }

  const currentSeats = Math.max(1, Number(preview.seats ?? 1))
  const targetSeats = Math.max(1, Math.trunc(input.targetSeats))
  if (targetSeats <= currentSeats) {
    return { state: 'blocked', reason: 'invalid_target_seats' }
  }

  const eventStart = parseIsoDate(preview.event_start_datetime)
  if (!eventStart || eventStart.getTime() <= Date.now()) {
    return { state: 'blocked', reason: 'event_started' }
  }

  const deltaSeats = targetSeats - currentSeats
  const unitPrice = Math.max(0, Number(preview.price_per_seat ?? 0))
  const amount = roundCurrencyAmount(unitPrice * deltaSeats)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { state: 'blocked', reason: 'invalid_amount' }
  }

  const tokenHash = hashGuestToken(input.rawToken)
  const baseUrl = resolveBaseUrl(input.appBaseUrl)
  const encodedToken = encodeURIComponent(input.rawToken)

  const successUrl = `${baseUrl}/g/${encodedToken}/manage-booking?state=seat_increase_success&target_seats=${targetSeats}&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}/g/${encodedToken}/manage-booking?state=seat_increase_cancelled&target_seats=${targetSeats}`

  const session = await createStripeCheckoutSession({
    idempotencyKey: `event_seat_increase_${preview.booking_id}_${targetSeats}_${tokenHash.slice(0, 24)}`,
    successUrl,
    cancelUrl,
    bookingId: preview.booking_id,
    eventId: preview.event_id,
    quantity: deltaSeats,
    unitAmountMinor: amountToMinor(unitPrice),
    currency: 'GBP',
    productName: `${preview.event_name || 'Event booking'} additional seats (${deltaSeats})`,
    tokenHash,
    expiresAtUnix: computeCheckoutExpiryUnix(eventStart),
    metadata: {
      payment_kind: 'seat_increase',
      target_seats: String(targetSeats),
      delta_seats: String(deltaSeats)
    }
  })

  if (!session.url) {
    throw new Error('Stripe checkout did not return a URL')
  }

  const { data: existingPayment, error: existingPaymentLookupError } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .limit(1)
    .maybeSingle()

  if (existingPaymentLookupError) {
    throw new Error(
      `Failed to verify existing seat-increase payment row before checkout persistence: ${existingPaymentLookupError.message}`
    )
  }

  if (!existingPayment) {
    const { data: insertedPayment, error: paymentInsertError } = await supabase
      .from('payments')
      .insert({
        event_booking_id: preview.booking_id,
        charge_type: 'seat_increase',
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent ?? null,
        amount,
        currency: 'GBP',
        status: 'pending',
        metadata: {
          payment_kind: 'seat_increase',
          target_seats: targetSeats,
          delta_seats: deltaSeats,
          checkout_url: session.url
        }
      })
      .select('id')
      .maybeSingle()

    if (paymentInsertError) {
      if (isDuplicateKeyError(paymentInsertError)) {
        const { data: concurrentPayment, error: concurrentLookupError } = await supabase
          .from('payments')
          .select('id')
          .eq('stripe_checkout_session_id', session.id)
          .limit(1)
          .maybeSingle()

        if (concurrentLookupError) {
          throw new Error(
            `Failed to verify concurrent seat-increase payment row after duplicate insert: ${concurrentLookupError.message}`
          )
        }

        if (!concurrentPayment) {
          throw new Error('Failed to resolve concurrent seat-increase payment row after duplicate insert')
        }
      } else {
        throw new Error(`Failed to persist pending seat-increase payment row: ${paymentInsertError.message}`)
      }
    } else if (!insertedPayment) {
      throw new Error('Seat-increase payment insert affected no rows')
    }
  }

  return {
    state: 'created',
    checkoutUrl: session.url,
    bookingId: preview.booking_id,
    targetSeats,
    deltaSeats,
    amount,
    currency: 'GBP',
    sessionId: session.id
  }
}
