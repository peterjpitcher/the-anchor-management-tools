import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'

export const dynamic = 'force-dynamic'

const IDEMPOTENCY_TTL_HOURS = 24 * 30

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

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const webhookId = (process.env.PAYPAL_EVENT_BOOKINGS_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()
  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false

  try {
    if (!webhookId) {
      return NextResponse.json(
        { received: false, error: 'PAYPAL_EVENT_BOOKINGS_WEBHOOK_ID not configured' },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 }
      )
    }

    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(body)
    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? event.event_type : 'unknown'
    if (!eventId) {
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }

    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
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

    if (state === 'confirmed') {
      await sendEventPaymentConfirmationSms(supabase, {
        bookingId,
        eventName: 'your event',
        seats: 1,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
      })
    } else if (state === 'manual_review') {
      await sendEventPaymentManualReviewSms(supabase, { bookingId })
    }

    await persistIdempotencyResponse(
      supabase,
      idempotencyKey,
      requestHash,
      {
        state,
        event_id: eventId,
        booking_id: bookingId,
        processed_at: new Date().toISOString(),
      },
      IDEMPOTENCY_TTL_HOURS
    )
    claimHeld = false

    return NextResponse.json({ received: true, state })
  } catch (error) {
    if (claimHeld && idempotencyKey && requestHash) {
      await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash).catch(() => undefined)
    }
    logger.error('PayPal event-bookings webhook error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
