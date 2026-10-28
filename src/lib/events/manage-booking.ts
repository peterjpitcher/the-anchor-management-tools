import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAppUrl } from '@/lib/env'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { refundPayPalPayment } from '@/lib/paypal'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import {
  bookingItemsAreMultiType,
  getDefaultTicketTypeId,
  loadBookingItems
} from '@/lib/events/ticket-type-queries'
import { settleWrite } from '@/lib/supabase/settle-write'
import { londonCalendarDaysUntil } from '@/lib/dateUtils'

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
  /** True when each ticket carries a named guest (20261027133100). */
  has_named_guests?: boolean
  /** Why the seat change is not offered, when the database says. */
  seat_change_blocked_reason?: string | null
}

/**
 * Why a guest cannot change the size of this booking from their link, or null when they can.
 * The same rules staff work under (updateEventBookingSeatsById), plus owner decision D7 (customer
 * bookings review of 24 October 2026):
 *   - guest_details_locked: each ticket carries a named guest, so it changes guest by guest (BK-022)
 *   - change_by_request: the booking is paid online, so any change goes to a manager, who decides
 *     the refund starting from what the guest paid (BK-021). It used to refund the list price at
 *     once, with no person involved.
 *   - multi_ticket_type_booking: the seats come from the ticket lines and cannot be edited directly
 */
export type GuestSeatChangeBlock = 'guest_details_locked' | 'change_by_request' | 'multi_ticket_type_booking'

/** The part of the rule the preview alone answers, for the page to choose what to offer. */
export function guestSeatChangeBlockFromPreview(preview: EventManagePreviewResult): GuestSeatChangeBlock | null {
  if (preview.payment_mode === 'prepaid' && preview.status === 'confirmed') return 'change_by_request'
  if (preview.has_named_guests || preview.seat_change_blocked_reason === 'guest_details_locked') return 'guest_details_locked'
  return null
}

export async function guestSeatChangeBlock(
  supabase: SupabaseClient<any, 'public', any>,
  preview: EventManagePreviewResult,
): Promise<GuestSeatChangeBlock | null> {
  const fromPreview = guestSeatChangeBlockFromPreview(preview)
  if (fromPreview) return fromPreview
  if (preview.booking_id && preview.event_id) {
    const items = await loadBookingItems(supabase, preview.booking_id)
    if (items.length > 0) {
      const defaultTypeId = await getDefaultTicketTypeId(supabase, preview.event_id)
      if (bookingItemsAreMultiType(items, defaultTypeId)) return 'multi_ticket_type_booking'
    }
  }
  return null
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
  /**
   * Set when PayPal refunded the money but the original ticket payment could not be marked
   * refunded, so it still reads as paid. The refund itself counts as done (status is unchanged);
   * a staff-facing caller should show this so nobody refunds the booking a second time. Never
   * show it to a guest.
   */
  staffWarning?: string
}

const EVENT_REFUND_PAYMENT_NOT_UPDATED_WARNING =
  'The refund went through, but the original payment was not updated to show it. Do not refund ' +
  'again: tell the developer so the payment record can be corrected.'

const MANAGE_TOKEN_MAX_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000
const MANAGE_TOKEN_FALLBACK_MS = 48 * 60 * 60 * 1000

/**
 * The ticket refund band: in full 7 or more days before, half 3 to 6 days before, none inside 3.
 * The days are whole London calendar days from today to the event's London date, as the ticket
 * email and the website promise and as table deposits count (BK-111). It used to count elapsed
 * hours, so a guest giving up seats on the evening a week before a 19:00 event got half back.
 */
export function getEventRefundPolicy(eventStartIso: string, now = new Date()): EventRefundPolicy {
  const days = londonCalendarDaysUntil(eventStartIso, now)
  if (days === null) {
    return { refundRate: 0, policyBand: 'none' }
  }

  if (days >= 7) {
    return { refundRate: 1, policyBand: 'full' }
  }

  if (days >= 3) {
    return { refundRate: 0.5, policyBand: 'partial' }
  }

  return { refundRate: 0, policyBand: 'none' }
}

function roundCurrencyAmount(value: number): number {
  return Number(value.toFixed(2))
}

function resolveBaseUrl(appBaseUrl?: string): string {
  return (appBaseUrl || getAppUrl()).replace(/\/+$/, '')
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
  // Guards shared by every caller (staff event UI, linked table-booking party
  // size): prepaid confirmed bookings must not change size without money
  // moving, and multi-ticket-type bookings derive their seat count from the
  // ticket lines — editing seats directly desyncs line items, charge and
  // door lists.
  const { data: bookingRow, error: bookingLookupError } = await supabase.from('bookings')
    .select('id, event_id, status, seats, is_reminder_only, event:events(id, payment_mode)')
    .eq('id', input.bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    throw bookingLookupError
  }

  if (!bookingRow?.id) {
    return { state: 'blocked', reason: 'booking_not_found', booking_id: input.bookingId }
  }

  const currentSeats = Math.max(1, Number(bookingRow.seats ?? 1))
  if (input.newSeats !== currentSeats) {
    const eventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const isPrepaidConfirmed =
      bookingRow.status === 'confirmed' &&
      bookingRow.is_reminder_only !== true &&
      (eventRecord as { payment_mode?: string | null } | null)?.payment_mode === 'prepaid'

    if (isPrepaidConfirmed) {
      return {
        state: 'blocked',
        reason: 'prepaid_paid_booking',
        booking_id: bookingRow.id,
        event_id: bookingRow.event_id ?? undefined,
        old_seats: currentSeats,
        new_seats: currentSeats,
        delta: 0
      }
    }

    try {
      const bookingItems = await loadBookingItems(supabase, input.bookingId)
      if (bookingItems.length > 0 && bookingRow.event_id) {
        const defaultTypeId = await getDefaultTicketTypeId(supabase, bookingRow.event_id)
        if (bookingItemsAreMultiType(bookingItems, defaultTypeId)) {
          return {
            state: 'blocked',
            reason: 'multi_ticket_type_booking',
            booking_id: bookingRow.id,
            event_id: bookingRow.event_id ?? undefined,
            old_seats: currentSeats,
            new_seats: currentSeats,
            delta: 0
          }
        }
      }
    } catch (itemsError) {
      logger.warn('Failed to check booking items before seat update', {
        metadata: {
          bookingId: input.bookingId,
          error: itemsError instanceof Error ? itemsError.message : String(itemsError)
        }
      })
    }
  }

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

/**
 * The PayPal-Request-Id for one refund. PayPal answers a repeated request id with the refund it
 * already made, so two refunds that share one move money once. It used to be built from the
 * reason and the amount alone: two £40 manual refunds on one booking were the same request
 * (BK-024). With an idempotency key it is built from that key, which the caller makes once per
 * refund asked for; without one it keeps its old form, so a retry stays the same request.
 */
function paypalRefundRequestId(input: {
  bookingId: string
  paymentId: string
  reason: string
  idempotencyKey: string | null
  amount: number
}): string {
  const pennies = Math.round(input.amount * 100)
  if (!input.idempotencyKey) {
    return `event-refund-${input.bookingId}-${input.paymentId}-${input.reason}-${pennies}`.slice(0, 108)
  }
  const scope = createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 24)
  return `event-refund-${input.paymentId}-${scope}-${pennies}`
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

  // Idempotency: when the caller supplies a stable metadata.idempotency_key,
  // return any prior refund carrying that key instead of issuing a new one.
  // Guards against double-refund on retries / concurrent cancels regardless of
  // the (per-reason) dedup below.
  const idempotencyKey =
    input.metadata && typeof input.metadata['idempotency_key'] === 'string'
      ? (input.metadata['idempotency_key'] as string)
      : null
  if (idempotencyKey) {
    const { data: priorRefunds, error: priorRefundError } = await supabase.from('payments')
      .select('id, amount, currency, status, metadata')
      .eq('charge_type', 'refund')
      .contains('metadata', { idempotency_key: idempotencyKey })
      .in('status', ['refunded', 'pending', 'succeeded'])
      .order('created_at', { ascending: false })

    if (priorRefundError) {
      throw priorRefundError
    }

    if (Array.isArray(priorRefunds) && priorRefunds.length > 0) {
      const totalPrior = priorRefunds.reduce(
        (sum, row) => sum + Math.max(0, Number(row.amount || 0)),
        0
      )
      const anyPending = priorRefunds.some((row) => row.status === 'pending')
      const refundIds = priorRefunds
        .map((row) => (row.metadata as Record<string, unknown> | null)?.['paypal_refund_id'])
        .filter((id): id is string => typeof id === 'string')
      return {
        status: anyPending ? 'pending' : 'succeeded',
        amount: roundCurrencyAmount(totalPrior),
        currency: (priorRefunds[0]?.currency || 'GBP').toUpperCase(),
        paypalRefundId: refundIds[0],
        paypalRefundIds: refundIds.length > 0 ? refundIds : undefined,
        reason: 'idempotent_replay'
      }
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
  let paymentRecordNotUpdated = false
  // Stays true while every capture looked at has nothing left on it.
  let everyCaptureFullyRefunded = true
  const paypalRefundIds: string[] = []
  const currency = (paymentRows[0]?.currency || 'GBP').toUpperCase()

  for (const payment of paymentRows) {
    if (remaining <= 0.004) break
    if (!payment?.paypal_capture_id) continue

    // Earlier refunds with the same reason used to count as this one already done, so a second
    // manual refund, or a second seat reduction in the same band, moved no money and still
    // reported success (BK-024). Repeats are now caught by the idempotency key above alone, and
    // what has already gone back only limits what is left to refund on the capture.
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
    everyCaptureFullyRefunded = false

    const amountForPayment = roundCurrencyAmount(Math.min(remaining, available))
    let paypalRefundMeta: { id: string; status: string; currency: string | null } | null = null

    try {
      const paypalRefund = await refundPayPalPayment(
        payment.paypal_capture_id,
        amountForPayment,
        paypalRefundRequestId({
          bookingId: input.bookingId,
          paymentId: payment.id,
          reason: input.reason,
          idempotencyKey,
          amount: amountForPayment,
        }),
        payment.currency
      )
      paypalRefundMeta = {
        id: paypalRefund.refundId,
        status: String(paypalRefund.status || 'unknown'),
        currency: paypalRefund.currency || (payment.currency || 'GBP').toUpperCase()
      }

      const mappedStatus = mapRefundStatus(paypalRefund.status)
      const paymentStatus =
        mappedStatus === 'refunded'
          ? 'refunded'
          : mappedStatus === 'pending'
            ? 'pending'
            : 'failed'

      const refundMetadata = {
        source_payment_id: payment.id,
        source_paypal_capture_id: payment.paypal_capture_id,
        paypal_refund_id: paypalRefund.refundId,
        paypal_refund_status: paypalRefund.status,
        paypal_refund_status_details: paypalRefund.statusDetails,
        reason: input.reason,
        ...(input.metadata || {})
      }

      // PayPal tells the webhook about this refund too. If that delivery landed between PayPal
      // answering and this write, it has already recorded the refund, so adopt its row (with
      // this refund's reason and idempotency key) instead of recording the money twice.
      const { data: webhookRow, error: webhookRowError } = await supabase
        .from('payments')
        .select('id, metadata')
        .eq('charge_type', 'refund')
        .contains('metadata', { paypal_refund_id: paypalRefund.refundId })
        .limit(1)
        .maybeSingle()

      if (webhookRowError) {
        throw webhookRowError
      }

      let adoptedRow = webhookRow

      if (!adoptedRow) {
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
            metadata: refundMetadata
          })

        if (refundInsertError?.code === '23505') {
          // The webhook recorded this refund id between the look above and this insert (the
          // unique index payments_paypal_refund_id_unique refused the second row): adopt its row.
          const { data: racedRow, error: racedRowError } = await supabase
            .from('payments')
            .select('id, metadata')
            .eq('charge_type', 'refund')
            .contains('metadata', { paypal_refund_id: paypalRefund.refundId })
            .limit(1)
            .maybeSingle()

          if (racedRowError || !racedRow) {
            throw racedRowError ?? refundInsertError
          }
          adoptedRow = racedRow
        } else if (refundInsertError) {
          throw refundInsertError
        }
      }

      if (adoptedRow) {
        const { error: adoptError } = await supabase
          .from('payments')
          .update({
            metadata: {
              ...((adoptedRow.metadata as Record<string, unknown> | null) ?? {}),
              ...refundMetadata,
              initiated_by_type: 'staff',
              recorded_first_by: 'paypal_webhook'
            }
          })
          .eq('id', adoptedRow.id)

        if (adoptError) {
          throw adoptError
        }
      }

      paypalRefundIds.push(paypalRefund.refundId)
      processedAmount = roundCurrencyAmount(processedAmount + amountForPayment)
      remaining = roundCurrencyAmount(Math.max(0, remaining - amountForPayment))

      if (mappedStatus === 'pending') {
        sawPending = true
      }

      if (mappedStatus === 'refunded') {
        const totalRefundedForPayment = roundCurrencyAmount(alreadyRefunded + amountForPayment)
        // Never thrown: the catch below would count a refund PayPal has already made as a
        // failure. The refund stands; staff are told the payment row is out of date instead.
        const paymentMarked = await settleWrite(
          supabase
            .from('payments')
            .update({
              status: totalRefundedForPayment + 0.004 >= paymentAmount ? 'refunded' : 'partially_refunded',
              updated_at: new Date().toISOString()
            })
            .eq('id', payment.id),
          {
            table: 'payments',
            what: 'Recording the payment refund status',
            ids: { paymentId: payment.id, paypalRefundId: paypalRefund.refundId },
            note: 'the refund itself went through'
          }
        )
        if (!paymentMarked) {
          paymentRecordNotUpdated = true
        }
      }

      // An adopted webhook row already raised its analytics event.
      if (!adoptedRow && (mappedStatus === 'refunded' || mappedStatus === 'pending')) {
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
    // Every capture was already refunded in full, so nothing is owed and nothing failed (BK-136):
    // a whole-event cancellation after a partial refund used to report this as a refund that
    // needed staff follow-up, and the guest was told so.
    if (!sawFailure && everyCaptureFullyRefunded) {
      return { status: 'succeeded', amount: 0, currency, reason: 'nothing_left_to_refund' }
    }
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
    reason: fullAmountProcessed ? undefined : 'partial_refund_only',
    ...(paymentRecordNotUpdated ? { staffWarning: EVENT_REFUND_PAYMENT_NOT_UPDATED_WARNING } : {})
  }
}

export type EventManualRefundMethod = 'cash' | 'card_terminal'

/**
 * Records a refund handed back at the bar, in cash or on the card terminal, against tickets paid
 * there (BK-135, customer bookings review of 24 October 2026). The refund code only knew PayPal,
 * so a cash or card ticket could be "refunded" from the dialog without any record: the booking
 * still read as paid and offered the same money back again.
 *
 * It writes one refund payments row per bar payment it draws on (payment_provider 'manual', the
 * method, the amount and who recorded it), moves each source payment to partially_refunded or
 * refunded, and replays an earlier call with the same idempotency key instead of recording twice.
 * No money moves here: the member of staff has handed it back. Never more than the bar payments
 * still hold.
 */
export async function recordManualEventRefund(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    amount: number
    method: EventManualRefundMethod
    reason: string
    idempotencyKey: string
    recordedBy: string | null
    note?: string | null
    metadata?: Record<string, unknown>
  }
): Promise<EventRefundResult> {
  const refundAmount = roundCurrencyAmount(input.amount)
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    return { status: 'none', amount: 0, currency: 'GBP' }
  }

  const { data: priorRefunds, error: priorRefundError } = await supabase.from('payments')
    .select('id, amount, currency, status')
    .eq('charge_type', 'refund')
    .contains('metadata', { idempotency_key: input.idempotencyKey })
    .in('status', ['refunded', 'pending', 'succeeded'])
  if (priorRefundError) throw priorRefundError
  if (Array.isArray(priorRefunds) && priorRefunds.length > 0) {
    const total = priorRefunds.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0)
    return { status: 'succeeded', amount: roundCurrencyAmount(total), currency: 'GBP', reason: 'idempotent_replay' }
  }

  const { data: payments, error: paymentLookupError } = await supabase.from('payments')
    .select('id, amount, currency')
    .eq('event_booking_id', input.bookingId)
    .in('charge_type', ['prepaid_event', 'seat_increase'])
    .in('status', ['succeeded', 'partially_refunded'])
    .eq('payment_provider', 'manual')
    .order('created_at', { ascending: true })
  if (paymentLookupError) throw paymentLookupError

  let remaining = refundAmount
  let recorded = 0
  for (const payment of payments ?? []) {
    if (remaining <= 0.004) break
    const { data: refundsForPayment, error: refundsError } = await supabase.from('payments')
      .select('amount')
      .eq('charge_type', 'refund')
      .contains('metadata', { source_payment_id: payment.id })
      .in('status', ['refunded', 'pending', 'succeeded'])
    if (refundsError) throw refundsError
    const alreadyRefunded = (refundsForPayment ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0)
    const paymentAmount = Math.max(0, Number(payment.amount || 0))
    const available = roundCurrencyAmount(Math.max(0, paymentAmount - alreadyRefunded))
    if (available <= 0) continue

    const amountForPayment = roundCurrencyAmount(Math.min(remaining, available))
    const { error: insertError } = await supabase.from('payments').insert({
      event_booking_id: input.bookingId,
      charge_type: 'refund',
      payment_provider: 'manual',
      payment_method: input.method,
      amount: amountForPayment,
      currency: (payment.currency || 'GBP').toUpperCase(),
      status: 'refunded',
      metadata: {
        ...(input.metadata || {}),
        source_payment_id: payment.id,
        reason: input.reason,
        refund_method: input.method,
        recorded_by: input.recordedBy,
        note: input.note || null,
        idempotency_key: input.idempotencyKey,
      },
    })
    if (insertError) throw insertError

    recorded = roundCurrencyAmount(recorded + amountForPayment)
    remaining = roundCurrencyAmount(Math.max(0, remaining - amountForPayment))
    const totalRefunded = roundCurrencyAmount(alreadyRefunded + amountForPayment)
    // Never thrown: the refund row is the record that the money went back.
    await settleWrite(
      supabase.from('payments')
        .update({
          status: totalRefunded + 0.004 >= paymentAmount ? 'refunded' : 'partially_refunded',
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.id),
      {
        table: 'payments',
        what: 'Recording the cash or card refund on the original payment',
        ids: { paymentId: payment.id, bookingId: input.bookingId },
        note: 'the refund itself is recorded'
      }
    )
  }

  if (recorded <= 0) {
    return { status: 'manual_required', amount: refundAmount, currency: 'GBP', reason: 'no_bar_payment_to_refund' }
  }
  return {
    status: recorded + 0.004 >= refundAmount ? 'succeeded' : 'manual_required',
    amount: recorded,
    currency: 'GBP',
    reason: recorded + 0.004 >= refundAmount ? undefined : 'partial_refund_only'
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
