import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { refundPayPalPayment } from '@/lib/paypal'
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
  paypalRefundId?: string
  paypalRefundIds?: string[]
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
        | 'online_seat_increase_unavailable'
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

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
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
  switch ((status || '').toUpperCase()) {
    case 'COMPLETED':
    case 'SUCCEEDED':
      return 'refunded'
    case 'PENDING':
      return 'pending'
    default:
      return 'failed'
  }
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
    sourcePaymentId?: string
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

  let paymentQuery = supabase
    .from('payments')
    .select('id, amount, currency, paypal_capture_id')
    .eq('event_booking_id', input.bookingId)
    .in('charge_type', ['prepaid_event', 'seat_increase'])
    .in('status', ['succeeded', 'partially_refunded'])
    .eq('payment_provider', 'paypal')
    .not('paypal_capture_id', 'is', null)
    .order('created_at', { ascending: false })

  if (input.sourcePaymentId) {
    paymentQuery = paymentQuery.eq('id', input.sourcePaymentId)
  }

  const { data: payments, error: paymentLookupError } = await paymentQuery

  if (paymentLookupError) {
    throw paymentLookupError
  }

  const paymentRows = Array.isArray(payments) ? payments : []

  if (paymentRows.length === 0) {
    return {
      status: 'manual_required',
      amount: refundAmount,
      currency: 'GBP',
      reason: 'paypal_capture_not_found'
    }
  }

  let remaining = refundAmount
  let processedAmount = 0
  let sawPending = false
  let sawFailure = false
  let sawManualRequired = false
  const paypalRefundIds: string[] = []
  const currency = (paymentRows[0]?.currency || 'GBP').toUpperCase()

  for (const payment of paymentRows) {
    if (remaining <= 0.004) break
    if (!payment?.paypal_capture_id) continue

    const { data: existingReasonRefunds, error: existingReasonError } = await supabase.from('payments')
      .select('id, amount, status, currency, metadata')
      .eq('charge_type', 'refund')
      .contains('metadata', { source_payment_id: payment.id, reason: input.reason })
      .in('status', ['refunded', 'pending', 'succeeded'])
      .order('created_at', { ascending: false })

    if (existingReasonError) {
      throw existingReasonError
    }

    for (const existingRefund of existingReasonRefunds || []) {
      const existingAmount = Math.max(0, Number(existingRefund.amount || 0))
      if (existingAmount <= 0) continue

      processedAmount += existingAmount
      remaining = roundCurrencyAmount(Math.max(0, remaining - existingAmount))

      if (existingRefund.status === 'pending') {
        sawPending = true
      }

      const metadata =
        typeof existingRefund.metadata === 'object' && existingRefund.metadata !== null
          ? (existingRefund.metadata as Record<string, unknown>)
          : {}
      if (typeof metadata.paypal_refund_id === 'string') {
        paypalRefundIds.push(metadata.paypal_refund_id)
      }
    }

    if (remaining <= 0.004) break

    const { data: allRefundsForPayment, error: allRefundsError } = await supabase.from('payments')
      .select('amount')
      .eq('charge_type', 'refund')
      .contains('metadata', { source_payment_id: payment.id })
      .in('status', ['refunded', 'pending', 'succeeded'])

    if (allRefundsError) {
      throw allRefundsError
    }

    const alreadyRefunded = (allRefundsForPayment || []).reduce(
      (sum, row) => sum + Math.max(0, Number(row.amount || 0)),
      0
    )
    const paymentAmount = Math.max(0, Number(payment.amount || 0))
    const available = roundCurrencyAmount(Math.max(0, paymentAmount - alreadyRefunded))
    if (available <= 0) continue

    const amountForPayment = roundCurrencyAmount(Math.min(remaining, available))
    let paypalRefundMeta: { id: string; status: string; currency: string | null } | null = null

    try {
      const paypalRefund = await refundPayPalPayment(
        payment.paypal_capture_id,
        amountForPayment,
        `event-refund-${input.bookingId}-${payment.id}-${input.reason}-${Math.round(amountForPayment * 100)}`.slice(0, 108)
      )
      paypalRefundMeta = {
        id: paypalRefund.refundId,
        status: String(paypalRefund.status || 'unknown'),
        currency: 'GBP'
      }

      const mappedStatus = mapRefundStatus(paypalRefund.status)
      const paymentStatus =
        mappedStatus === 'refunded'
          ? 'refunded'
          : mappedStatus === 'pending'
            ? 'pending'
            : 'failed'

      const { error: refundInsertError } = await supabase
        .from('payments')
        .insert({
          event_booking_id: input.bookingId,
          charge_type: 'refund',
          payment_provider: 'paypal',
          payment_method: 'paypal',
          amount: amountForPayment,
          currency: (payment.currency || 'GBP').toUpperCase(),
          status: paymentStatus,
          metadata: {
            source_payment_id: payment.id,
            source_paypal_capture_id: payment.paypal_capture_id,
            paypal_refund_id: paypalRefund.refundId,
            paypal_refund_status: paypalRefund.status,
            paypal_refund_status_details: paypalRefund.statusDetails,
            reason: input.reason,
            ...(input.metadata || {})
          }
        })

      if (refundInsertError) {
        throw refundInsertError
      }

      paypalRefundIds.push(paypalRefund.refundId)
      processedAmount = roundCurrencyAmount(processedAmount + amountForPayment)
      remaining = roundCurrencyAmount(Math.max(0, remaining - amountForPayment))

      if (mappedStatus === 'pending') {
        sawPending = true
      }

      if (mappedStatus === 'refunded') {
        const totalRefundedForPayment = roundCurrencyAmount(alreadyRefunded + amountForPayment)
        await supabase
          .from('payments')
          .update({
            status: totalRefundedForPayment + 0.004 >= paymentAmount ? 'refunded' : 'partially_refunded',
            updated_at: new Date().toISOString()
          })
          .eq('id', payment.id)
      }

      if (mappedStatus === 'refunded' || mappedStatus === 'pending') {
        try {
          await recordAnalyticsEvent(supabase, {
            customerId: input.customerId,
            eventBookingId: input.bookingId,
            eventType: 'refund_created',
            metadata: {
              event_id: input.eventId,
              amount: amountForPayment,
              currency: (payment.currency || 'GBP').toUpperCase(),
              paypal_refund_id: paypalRefund.refundId,
              paypal_refund_status: paypalRefund.status,
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
    } catch (error) {
      sawFailure = true
      logger.error('Event refund request failed', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          bookingId: input.bookingId,
          paymentId: payment.id,
          amount: amountForPayment
        }
      })

      const { error: failedInsertError } = await supabase
        .from('payments')
        .insert({
          event_booking_id: input.bookingId,
          charge_type: 'refund',
          payment_provider: 'paypal',
          payment_method: 'paypal',
          amount: amountForPayment,
          currency: (paypalRefundMeta?.currency || payment.currency || 'GBP').toUpperCase(),
          status: paypalRefundMeta ? 'pending' : 'failed',
          metadata: {
            reason: input.reason,
            error: error instanceof Error ? error.message : String(error),
            source_payment_id: payment.id,
            source_paypal_capture_id: payment.paypal_capture_id,
            paypal_refund_id: paypalRefundMeta?.id,
            paypal_refund_status: paypalRefundMeta?.status,
            persistence_gap: paypalRefundMeta ? true : undefined,
            ...(input.metadata || {})
          }
        })

      if (paypalRefundMeta) {
        sawManualRequired = true
        paypalRefundIds.push(paypalRefundMeta.id)
      }

      if (failedInsertError) {
        logger.warn('Failed persisting event refund fallback row', {
          metadata: {
            bookingId: input.bookingId,
            amount: amountForPayment,
            error: failedInsertError.message
          }
        })
      }

      break
    }
  }

  const amount = roundCurrencyAmount(processedAmount)
  if (amount <= 0) {
    return {
      status: sawFailure ? 'failed' : 'manual_required',
      amount: refundAmount,
      currency,
      reason: sawFailure ? 'paypal_refund_failed' : 'insufficient_refundable_capture_balance'
    }
  }

  const fullAmountProcessed = amount + 0.004 >= refundAmount
  const status =
    sawManualRequired || !fullAmountProcessed
      ? 'manual_required'
      : sawFailure
        ? 'failed'
        : sawPending
          ? 'pending'
          : 'succeeded'

  return {
    status,
    amount,
    currency,
    paypalRefundId: paypalRefundIds[0],
    paypalRefundIds,
    reason: fullAmountProcessed ? undefined : 'partial_refund_only'
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

  return {
    state: 'blocked',
    reason: 'online_seat_increase_unavailable'
  }
}
