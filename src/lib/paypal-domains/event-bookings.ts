import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEventPaymentOutcome } from '@/lib/events/event-payment-notify'
import { reconcileEventRefund } from '@/lib/events/refund-reconciliation'
import { recordEventPayPalRefund } from '@/lib/events/paypal-webhook-refund'
import { readPayPalRefundResource } from '@/lib/paypal-refund-resource'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
import {
  getCaptureAmount,
  getCaptureCurrency,
  getCaptureId,
  getCaptureOrderId,
  getEventBookingIdFromCustomId,
  recordManualReviewAudit,
} from '@/lib/paypal-domains/event-bookings-helpers'

/**
 * Event booking payment handlers. The logic is the route's, unchanged; it moved here so every
 * PayPal webhook URL can dispatch to the same code.
 */

export type EventBookingOutcome = {
  /** Persisted as the idempotency response. */
  result: Record<string, unknown>
  /** What PayPal is told. Deliberately separate from `result`: this route has always answered
   *  with its state, and the exact shape differs between a refund and a capture. */
  responseBody: Record<string, unknown>
  /** 202 asks a human to look; 200 is settled. */
  httpStatus: number
  /** Set on refunds and reversals: whether the money was recorded, and why not when it was not. */
  money?: { recorded: boolean; manualReview: boolean; reason?: string | null }
}

/**
 * A refund or reversal on an event ticket capture.
 *
 * A refund the app issued already has its row (found by PayPal refund id) and only needs its
 * status settled. One made in the PayPal dashboard, or a reversal, has no row yet and is recorded
 * the way the staff refund path records one. `bookingId` is the booking the router placed it under.
 */
export async function handleEventBookingRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
  eventId: string,
  bookingId: string | null = null,
  kind: 'refund' | 'reversal' = 'refund'
): Promise<EventBookingOutcome> {
  const refund = readPayPalRefundResource(event)
  const refundId = refund.refundId ?? ''
  const refundStatus = refund.rawStatus

  if (!refundId) {
    if (kind === 'reversal') {
      const state = { state: 'manual_review', reason: 'not_a_refund_resource', event_id: eventId, booking_id: bookingId }
      return {
        result: state,
        responseBody: state,
        httpStatus: 202,
        money: { recorded: false, manualReview: true, reason: 'not_a_refund_resource' },
      }
    }
    const state = { state: 'ignored', reason: 'missing_refund_id', event_id: eventId }
    return { result: state, responseBody: state, httpStatus: 200 }
  }

  const reconciled = await reconcileEventRefund(supabase, {
    paypalRefundId: refundId,
    paypalStatus: refundStatus,
  })

  if (reconciled.matched || !bookingId) {
    const state = {
      state: 'refund_reconciled',
      matched: reconciled.matched,
      changed: reconciled.changed,
      outcome: reconciled.outcome,
      event_id: eventId,
      booking_id: reconciled.bookingId,
    }
    return {
      result: state,
      responseBody: state,
      httpStatus: 200,
      money: { recorded: reconciled.matched, manualReview: false },
    }
  }

  // Not a refund the app issued: record it.
  const recorded = await recordEventPayPalRefund(supabase, {
    bookingId,
    refund,
    kind,
    eventId,
    eventType: typeof event?.event_type === 'string' ? event.event_type : 'unknown',
  })

  const manualReview = recorded.state === 'manual_review'
  const state = {
    state: manualReview ? 'manual_review' : `refund_${recorded.state}`,
    reason: recorded.reason ?? null,
    event_id: eventId,
    booking_id: bookingId,
    payment_id: recorded.paymentId ?? null,
  }

  return {
    result: state,
    responseBody: state,
    httpStatus: manualReview ? 202 : 200,
    money: { recorded: !manualReview, manualReview, reason: recorded.reason ?? null },
  }
}

export async function handleEventBookingCapture(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  eventId: string
): Promise<EventBookingOutcome> {
  const resource = event.resource || {}
  const orderId = getCaptureOrderId(resource)
  const captureId = getCaptureId(resource)
  const amount = getCaptureAmount(resource)
  const currency = getCaptureCurrency(resource)
  let bookingId = getEventBookingIdFromCustomId(resource)

  if (!captureId || !orderId || amount === null) {
    return {
      result: { state: 'ignored', reason: 'missing_capture_fields', event_id: eventId },
      responseBody: { ignored: true, reason: 'missing_capture_fields' },
      httpStatus: 200,
    }
  }

  if (!bookingId) {
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('event_booking_id')
      .eq('paypal_order_id', orderId)
      .eq('payment_provider', 'paypal')
      .eq('charge_type', 'prepaid_event')
      .maybeSingle()

    if (paymentError) throw paymentError
    bookingId = payment?.event_booking_id || null
  }

  if (!bookingId) {
    return {
      result: { state: 'ignored', reason: 'not_event_booking', event_id: eventId },
      responseBody: { ignored: true },
      httpStatus: 200,
    }
  }

  const { data: confirmRaw, error: confirmError } = await supabase.rpc(
    'confirm_event_paypal_payment_v01',
    {
      p_event_booking_id: bookingId,
      p_paypal_order_id: orderId,
      p_paypal_capture_id: captureId,
      p_amount: amount,
      p_currency: currency,
      p_source: 'paypal_webhook',
    }
  )

  if (confirmError) throw confirmError
  const confirm = (confirmRaw || {}) as Record<string, unknown>
  const state = typeof confirm.state === 'string' ? confirm.state : 'blocked'
  const reason = typeof confirm.reason === 'string' ? confirm.reason : null
  let responseState = state
  let responseStatus = 200

  // Email first, a text only when no email goes (BK-167, owner decision D14).
  if (state === 'confirmed' || state === 'already_confirmed') {
    await notifyEventPaymentOutcome(supabase, {
      bookingId,
      outcome: 'confirmed',
      amount,
      currency,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
      // A repeat confirmation re-checks the email only: a text cannot be de-duplicated the same way.
      textAllowed: state === 'confirmed',
    })
  } else {
    // manual_review, blocked, and anything unexpected all need a human, never a silent ack.
    await notifyEventPaymentOutcome(supabase, { bookingId, outcome: 'manual_review', amount, currency })
    await recordManualReviewAudit(supabase, {
      bookingId,
      eventId,
      orderId,
      captureId,
      amount,
      currency,
      state,
      reason,
    })
    // Raised after the audit row, which throws on failure, so a retried delivery alerts instead.
    await alertEventPaymentNeedsAPerson(supabase, {
      bookingId,
      kind: state === 'manual_review' ? 'manual_review' : 'paid_booking_not_payable',
      reason,
      amount,
      currency,
      orderId,
      captureId,
      source: 'PayPal webhook',
    })
    responseState = 'manual_review'
    responseStatus = 202
  }

  return {
    result: {
      state: responseState,
      original_state: responseState === state ? undefined : state,
      reason,
      event_id: eventId,
      booking_id: bookingId,
      processed_at: new Date().toISOString(),
    },
    // Exactly what this route has always told PayPal: no booking id, no timestamp.
    responseBody: {
      state: responseState,
      original_state: responseState === state ? undefined : state,
      reason,
    },
    httpStatus: responseStatus,
  }
}

/**
 * PayPal refused a capture on an event ticket payment (PAYMENT.CAPTURE.DENIED). BK-019,
 * customer bookings review of 24 October 2026: these used to reach handleEventBookingCapture,
 * which confirmed the booking and marked it paid with no money behind it.
 *
 * The payment row is marked failed. A booking still waiting for payment is left to its hold,
 * which runs out as any unpaid hold does (the guest then gets the usual "seats released"
 * message, which is true). A booking already confirmed on this payment is not cancelled by the
 * app: a person decides, so it is recorded as needing review and staff are told. The audit row
 * is written directly and throws on failure, so the webhook never reports a denial it did not
 * record. No message goes to the guest from here.
 */
export async function handleEventBookingDenied(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
  eventId: string
): Promise<EventBookingOutcome> {
  const resource = event?.resource || {}
  const orderId = getCaptureOrderId(resource)
  const captureId = getCaptureId(resource)
  const amount = getCaptureAmount(resource)
  const currency = getCaptureCurrency(resource)
  const reason = typeof resource?.status_details?.reason === 'string' ? resource.status_details.reason : 'DENIED'
  let bookingId = getEventBookingIdFromCustomId(resource)

  if (!orderId && !captureId) {
    const state = { state: 'ignored', reason: 'missing_capture_fields', event_id: eventId }
    return { result: state, responseBody: { ignored: true, reason: 'missing_capture_fields' }, httpStatus: 200 }
  }

  let paymentQuery = supabase
    .from('payments')
    .select('id, event_booking_id, status, metadata')
    .eq('payment_provider', 'paypal')
    .eq('charge_type', 'prepaid_event')
  paymentQuery = orderId ? paymentQuery.eq('paypal_order_id', orderId) : paymentQuery.eq('paypal_capture_id', captureId as string)
  const { data: payment, error: paymentError } = await paymentQuery.maybeSingle()
  if (paymentError) throw paymentError
  bookingId = bookingId || payment?.event_booking_id || null

  if (!bookingId) {
    const state = { state: 'ignored', reason: 'not_event_booking', event_id: eventId }
    return { result: state, responseBody: { ignored: true }, httpStatus: 200 }
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .maybeSingle()
  if (bookingError) throw bookingError

  const nowIso = new Date().toISOString()
  if (payment?.id && payment.status !== 'failed') {
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        ...(captureId ? { paypal_capture_id: captureId } : {}),
        metadata: {
          ...((payment.metadata ?? {}) as Record<string, unknown>),
          capture_status: 'DENIED',
          capture_status_reason: reason,
          capture_status_at: nowIso,
          denied_event_id: eventId,
          ...(payment.status === 'succeeded' ? { previously_recorded_as: 'succeeded' } : {}),
        },
        updated_at: nowIso,
      })
      .eq('id', payment.id)
    if (updateError) throw updateError
  }

  // A confirmed booking whose only payment PayPal refused: a person decides whether it stands.
  const needsDecision = booking?.status === 'confirmed'
  const { error: auditError } = await supabase.from('audit_logs').insert({
    operation_type: 'event_payment.paypal_capture_denied',
    resource_type: 'event_booking',
    resource_id: bookingId,
    operation_status: 'failure',
    additional_info: {
      event_id: eventId,
      order_id: orderId,
      capture_id: captureId,
      amount,
      currency,
      reason,
      booking_status: booking?.status ?? null,
      payment_id: payment?.id ?? null,
      source: 'paypal_event_bookings_webhook',
      ...(needsDecision
        ? { action_needed: 'PayPal refused the payment for a confirmed booking. Decide whether the booking stands, and ask the guest to pay again if so.' }
        : {}),
    },
  })
  if (auditError) {
    throw new Error(`Failed to audit PayPal event-booking capture denial: ${auditError.message}`)
  }

  if (needsDecision) {
    await alertEventPaymentNeedsAPerson(supabase, {
      bookingId,
      kind: 'capture_denied_on_confirmed_booking',
      reason,
      amount,
      currency,
      orderId,
      captureId,
      source: 'PayPal webhook',
    })
  }

  const state = needsDecision ? 'manual_review' : 'capture_denied'
  return {
    result: { state, reason, event_id: eventId, booking_id: bookingId, processed_at: nowIso },
    responseBody: { state, reason },
    httpStatus: needsDecision ? 202 : 200,
  }
}
