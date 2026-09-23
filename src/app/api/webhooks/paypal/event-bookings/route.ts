import { NextRequest, NextResponse } from 'next/server'
import { gatePayPalWebhook, sanitizePayPalHeadersForLog } from '@/lib/paypal-webhook-gate'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import {
  sendEventPaymentConfirmationEmail,
  sendEventPaymentManualReviewEmail,
} from '@/lib/email/event-ticket-emails'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { reconcileEventRefund } from '@/lib/events/refund-reconciliation'

export const dynamic = 'force-dynamic'

const IDEMPOTENCY_TTL_HOURS = 24 * 30

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

/**
 * This route wrote nothing to webhook_logs at all, so the absence of rows for it could not
 * prove it had never received a delivery, and a health check had nothing to read. Only
 * diagnostic metadata is stored: no signature, and the body is truncated exactly as the other
 * routes truncate theirs.
 */
async function logPayPalWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
    errorDetails?: unknown
  }
) {
  const { error } = await (supabase.from('webhook_logs') as any).insert({
    webhook_type: 'paypal',
    status: input.status,
    headers: sanitizePayPalHeadersForLog(input.headers),
    body: truncate(input.body, 10000),
    params: {
      event_id: input.eventId ?? null,
      event_type: input.eventType ?? null,
      source: 'event_bookings',
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null,
  })

  if (error) {
    logger.error('Failed to store PayPal event-bookings webhook log', {
      error: new Error(error instanceof Error ? error.message : String(error)),
      metadata: { status: input.status, eventId: input.eventId, eventType: input.eventType },
    })
  }
}

const REFUND_EVENT_TYPES = new Set([
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.REFUND.COMPLETED',
  'PAYMENT.REFUND.FAILED',
  'PAYMENT.REFUND.CANCELLED',
])

function getCaptureOrderId(resource: any): string | null {
  const raw = resource?.supplementary_data?.related_ids?.order_id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function getCaptureId(resource: any): string | null {
  const raw = resource?.id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function getCaptureAmount(resource: any): number | null {
  const parsed = Number(resource?.amount?.value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

function getCaptureCurrency(resource: any): string {
  const raw = resource?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : 'GBP'
}

function getEventBookingIdFromCustomId(resource: any): string | null {
  const customId = typeof resource?.custom_id === 'string' ? resource.custom_id.trim() : ''
  if (!customId.startsWith('event_booking:')) return null
  const bookingId = customId.slice('event_booking:'.length).trim()
  return bookingId || null
}

async function recordManualReviewAudit(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    bookingId: string
    eventId: string
    orderId: string
    captureId: string
    amount: number
    currency: string
    state: string
    reason: string | null
  }
) {
  const { error } = await supabase.from('audit_logs').insert({
    operation_type: 'event_payment.paypal_webhook_manual_review',
    resource_type: 'event_booking',
    resource_id: input.bookingId,
    operation_status: 'failure',
    additional_info: {
      event_id: input.eventId,
      order_id: input.orderId,
      capture_id: input.captureId,
      amount: input.amount,
      currency: input.currency,
      state: input.state,
      reason: input.reason,
      source: 'paypal_event_bookings_webhook',
    },
  })

  if (error) {
    throw new Error(`Failed to audit PayPal event-booking manual review: ${error.message}`)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false
  let loggedEventId: string | undefined
  let loggedEventType: string | undefined

  try {
    const gate = await gatePayPalWebhook({
      endpointPath: '/api/webhooks/paypal/event-bookings',
      endpointName: 'event-bookings',
      headers,
      body,
      envOverride: process.env.PAYPAL_EVENT_BOOKINGS_WEBHOOK_ID,
    })

    if (!gate.ok) {
      await logPayPalWebhook(supabase, {
        status: gate.logStatus,
        headers,
        body,
        errorMessage: gate.errorMessage,
        errorDetails: gate.diagnostics,
      })
      return NextResponse.json(gate.responseBody, { status: gate.httpStatus })
    }

    const event = gate.event
    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? event.event_type : 'unknown'
    loggedEventType = eventType
    if (!eventId) {
      await logPayPalWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        eventType,
        errorMessage: 'Missing event id',
      })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }
    loggedEventId = eventId
    await logPayPalWebhook(supabase, { status: 'received', headers, body, eventId, eventType })

    // Refund lifecycle events → reconcile the local refund row + notify.
    if (REFUND_EVENT_TYPES.has(eventType)) {
      idempotencyKey = `webhook:paypal:event-bookings:${eventId}`
      requestHash = computeIdempotencyRequestHash(event)
      const refundClaim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash, IDEMPOTENCY_TTL_HOURS)
      if (refundClaim.state === 'conflict') {
        return NextResponse.json({ error: 'Conflict' }, { status: 409 })
      }
      if (refundClaim.state === 'in_progress') {
        return NextResponse.json({ error: 'Event is currently being processed' }, { status: 409 })
      }
      if (refundClaim.state === 'replay') {
        return NextResponse.json({ received: true, duplicate: true })
      }
      claimHeld = true

      const refundResource = event.resource || {}
      const refundId = typeof refundResource?.id === 'string' ? refundResource.id.trim() : ''
      const refundStatus = typeof refundResource?.status === 'string' ? refundResource.status : null

      let reconcileState: Record<string, unknown> = { state: 'ignored', reason: 'missing_refund_id', event_id: eventId }
      if (refundId) {
        const reconciled = await reconcileEventRefund(supabase, { paypalRefundId: refundId, paypalStatus: refundStatus })
        reconcileState = {
          state: 'refund_reconciled',
          matched: reconciled.matched,
          changed: reconciled.changed,
          outcome: reconciled.outcome,
          event_id: eventId,
          booking_id: reconciled.bookingId,
        }
      }

      await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, reconcileState, IDEMPOTENCY_TTL_HOURS)
      claimHeld = false
      await logPayPalWebhook(supabase, { status: 'success', headers, body, eventId, eventType })
      return NextResponse.json({ received: true, ...reconcileState })
    }

    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
      await logPayPalWebhook(supabase, { status: 'ignored', headers, body, eventId, eventType })
      return NextResponse.json({ received: true, ignored: true })
    }

    idempotencyKey = `webhook:paypal:event-bookings:${eventId}`
    requestHash = computeIdempotencyRequestHash(event)
    const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash, IDEMPOTENCY_TTL_HOURS)

    if (claim.state === 'conflict') {
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }
    if (claim.state === 'in_progress') {
      return NextResponse.json({ error: 'Event is currently being processed' }, { status: 409 })
    }
    if (claim.state === 'replay') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    claimHeld = true

    const resource = event.resource || {}
    const orderId = getCaptureOrderId(resource)
    const captureId = getCaptureId(resource)
    const amount = getCaptureAmount(resource)
    const currency = getCaptureCurrency(resource)
    let bookingId = getEventBookingIdFromCustomId(resource)

    if (!captureId || !orderId || amount === null) {
      await persistIdempotencyResponse(
        supabase,
        idempotencyKey,
        requestHash,
        { state: 'ignored', reason: 'missing_capture_fields', event_id: eventId },
        IDEMPOTENCY_TTL_HOURS
      )
      claimHeld = false
      return NextResponse.json({ received: true, ignored: true, reason: 'missing_capture_fields' })
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
      await persistIdempotencyResponse(
        supabase,
        idempotencyKey,
        requestHash,
        { state: 'ignored', reason: 'not_event_booking', event_id: eventId },
        IDEMPOTENCY_TTL_HOURS
      )
      claimHeld = false
      return NextResponse.json({ received: true, ignored: true })
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
    } else if (state === 'manual_review') {
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
      responseStatus = 202
    } else {
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

    await persistIdempotencyResponse(
      supabase,
      idempotencyKey,
      requestHash,
      {
        state: responseState,
        original_state: responseState === state ? undefined : state,
        reason,
        event_id: eventId,
        booking_id: bookingId,
        processed_at: new Date().toISOString(),
      },
      IDEMPOTENCY_TTL_HOURS
    )
    claimHeld = false

    await logPayPalWebhook(supabase, {
      status: responseStatus === 202 ? 'manual_review' : 'success',
      headers,
      body,
      eventId,
      eventType,
      errorMessage: responseStatus === 202 ? (reason ?? 'manual review') : undefined,
    })

    return NextResponse.json(
      { received: true, state: responseState, original_state: responseState === state ? undefined : state, reason },
      { status: responseStatus }
    )
  } catch (error) {
    if (claimHeld && idempotencyKey && requestHash) {
      await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash).catch(() => undefined)
    }
    logger.error('PayPal event-bookings webhook error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await logPayPalWebhook(supabase, {
      status: 'error',
      headers,
      body,
      eventId: loggedEventId,
      eventType: loggedEventType,
      errorMessage: error instanceof Error ? error.message : 'Webhook processing failed',
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
