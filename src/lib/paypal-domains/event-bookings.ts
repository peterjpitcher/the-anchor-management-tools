import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import {
  sendEventPaymentConfirmationEmail,
  sendEventPaymentManualReviewEmail,
} from '@/lib/email/event-ticket-emails'
import { reconcileEventRefund } from '@/lib/events/refund-reconciliation'
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
}

export async function handleEventBookingRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
  eventId: string
): Promise<EventBookingOutcome> {
  const refundResource = event.resource || {}
  const refundId = typeof refundResource?.id === 'string' ? refundResource.id.trim() : ''
  const refundStatus = typeof refundResource?.status === 'string' ? refundResource.status : null

  if (!refundId) {
    const state = { state: 'ignored', reason: 'missing_refund_id', event_id: eventId }
    return { result: state, responseBody: state, httpStatus: 200 }
  }

  const reconciled = await reconcileEventRefund(supabase, {
    paypalRefundId: refundId,
    paypalStatus: refundStatus,
  })

  const state = {
    state: 'refund_reconciled',
    matched: reconciled.matched,
    changed: reconciled.changed,
    outcome: reconciled.outcome,
    event_id: eventId,
    booking_id: reconciled.bookingId,
  }

  return { result: state, responseBody: state, httpStatus: 200 }
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

  if (state === 'confirmed') {
    await sendEventPaymentConfirmationSms(supabase, {
      bookingId,
      eventName: 'your event',
      seats: 1,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
    })
    await sendEventPaymentConfirmationEmail(supabase, {
      bookingId,
      amount,
      currency,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
    })
  } else if (state === 'already_confirmed') {
    await sendEventPaymentConfirmationEmail(supabase, {
      bookingId,
      amount,
      currency,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
    })
  } else {
    // manual_review, blocked, and anything unexpected all need a human, never a silent ack.
    await sendEventPaymentManualReviewSms(supabase, { bookingId })
    await sendEventPaymentManualReviewEmail(supabase, {
      bookingId,
      amount,
      currency,
    })
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
