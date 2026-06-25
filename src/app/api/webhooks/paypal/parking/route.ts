import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

const IDEMPOTENCY_TTL_HOURS = 24 * 30

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id',
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-time'
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['paypal-transmission-sig-present'] = headers['paypal-transmission-sig'] ? 'true' : 'false'
  return sanitized
}

function parsePayPalMoney(value: unknown): number | null {
  const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null
}

function payPalMoneyMatches(actual: number, expected: number): boolean {
  return Math.abs(Number(actual.toFixed(2)) - Number(expected.toFixed(2))) <= 0.01
}

function normalizeCurrency(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null
}

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
    headers: sanitizeHeadersForLog(input.headers),
    body: truncate(input.body, 10000),
    params: {
      event_id: input.eventId ?? null,
      event_type: input.eventType ?? null
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null
  })

  if (error) {
    logger.error('Failed to store PayPal parking webhook log', {
      error: new Error(error instanceof Error ? error.message : String(error)),
      metadata: {
        status: input.status,
        eventId: input.eventId,
        eventType: input.eventType
      }
    })
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const webhookId = (process.env.PAYPAL_PARKING_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()

  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false

  try {
    if (!webhookId) {
      const errorMessage = 'PAYPAL_WEBHOOK_ID not configured'
      logger.error(errorMessage)
      await logPayPalWebhook(supabase, {
        status: 'configuration_error',
        headers,
        body,
        errorMessage
      })

      return NextResponse.json(
        { received: false, error: errorMessage },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 }
      )
    }

    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
      await logPayPalWebhook(supabase, {
        status: 'signature_failed',
        headers,
        body,
        errorMessage: 'Invalid PayPal signature'
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let event: any
    try {
      event = JSON.parse(body)
    } catch (parseError) {
      await logPayPalWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        errorMessage: 'Invalid JSON payload',
        errorDetails: parseError instanceof Error ? { message: parseError.message } : null
      })
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? event.event_type : 'unknown'

    if (!eventId) {
      await logPayPalWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        eventType,
        errorMessage: 'Missing event id'
      })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }

    idempotencyKey = `webhook:paypal:parking:${eventId}`
    requestHash = computeIdempotencyRequestHash(event)

    const claim = await claimIdempotencyKey(
      supabase,
      idempotencyKey,
      requestHash,
      IDEMPOTENCY_TTL_HOURS
    )

    if (claim.state === 'conflict') {
      await logPayPalWebhook(supabase, {
        status: 'idempotency_conflict',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: 'Event id reused with a different payload'
      })
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }

    if (claim.state === 'in_progress') {
      await logPayPalWebhook(supabase, {
        status: 'in_progress',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: 'Event is currently being processed'
      })
      return NextResponse.json(
        { error: 'Event is currently being processed' },
        { status: 409 }
      )
    }

    if (claim.state === 'replay') {
      await logPayPalWebhook(supabase, {
        status: 'duplicate',
        headers,
        body,
        eventId,
        eventType
      })
      return NextResponse.json({ received: true, duplicate: true })
    }

    claimHeld = true

    await logPayPalWebhook(supabase, {
      status: 'received',
      headers,
      body,
      eventId,
      eventType
    })

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await handlePaymentCompleted(supabase, event)
        break
      case 'PAYMENT.CAPTURE.DENIED':
        await handlePaymentDenied(supabase, event)
        break
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.REFUND.PENDING':
      case 'PAYMENT.REFUND.FAILED':
        await handleRefundEvent(supabase, event, 'parking')
        break
      default:
        logger.info('Unhandled PayPal parking webhook event type', {
          metadata: {
            eventId,
            eventType
          }
        })
    }

    try {
      await persistIdempotencyResponse(
        supabase,
        idempotencyKey,
        requestHash,
        {
          state: 'processed',
          event_id: eventId,
          event_type: eventType,
          processed_at: new Date().toISOString()
        },
        IDEMPOTENCY_TTL_HOURS
      )
      claimHeld = false
    } catch (persistError) {
      // Returning 500 causes PayPal to retry, which can repeat non-transactional side effects
      // (webhook logs, audit logs) even when the main handler has already committed.
      logger.error('PayPal webhook processed but failed to persist idempotency response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: {
          eventId,
          eventType
        }
      })

      await logPayPalWebhook(supabase, {
        status: 'idempotency_persist_failed',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: persistError instanceof Error ? persistError.message : String(persistError)
      })

      return NextResponse.json({ received: true, idempotency_persist_failed: true })
    }

    await logPayPalWebhook(supabase, {
      status: 'success',
      headers,
      body,
      eventId,
      eventType
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    if (claimHeld && idempotencyKey && requestHash) {
      try {
        await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
      } catch (releaseError) {
        logger.error('Failed to release PayPal webhook idempotency claim', {
          error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
          metadata: {
            idempotencyKey,
            eventId: idempotencyKey.replace('webhook:paypal:parking:', '')
          }
        })
      }
    }

    logger.error('PayPal parking webhook error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await logPayPalWebhook(supabase, {
      status: 'error',
      headers,
      body,
      errorMessage: error instanceof Error ? error.message : 'Webhook processing failed'
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function handlePaymentCompleted(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const bookingId = resource.custom_id
  const captureId = resource.id
  const amount = parsePayPalMoney(resource.amount?.value)
  const currency = normalizeCurrency(resource.amount?.currency_code)

  if (!bookingId) {
    throw new Error('Parking payment completed webhook missing booking ID')
  }
  if (amount === null || !currency) {
    throw new Error('Parking payment completed webhook missing amount or currency')
  }

  const { data: booking, error: bookingLookupError } = await supabase
    .from('parking_bookings')
    .select('id, payment_status, status, reference')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    throw new Error(`Failed to load parking booking: ${bookingLookupError.message}`)
  }

  if (!booking) {
    throw new Error(`Parking booking not found for payment webhook: ${bookingId}`)
  }

  const { data: expectedPayment, error: expectedPaymentLookupError } = await supabase
    .from('parking_booking_payments')
    .select('id, transaction_id, status, amount, currency')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (expectedPaymentLookupError) {
    throw new Error(`Failed to load expected parking payment: ${expectedPaymentLookupError.message}`)
  }
  if (!expectedPayment) {
    throw new Error(`No parking payment found for booking ${bookingId}`)
  }

  const expectedAmount = parsePayPalMoney(expectedPayment.amount)
  const expectedCurrency = normalizeCurrency(expectedPayment.currency)
  if (
    expectedAmount === null ||
    !expectedCurrency ||
    !payPalMoneyMatches(amount, expectedAmount) ||
    currency !== expectedCurrency
  ) {
    throw new Error(`PayPal capture amount or currency mismatch for parking booking ${bookingId}`)
  }

  const { data: updatedPayment, error: paymentUpdateError } = await supabase
    .from('parking_booking_payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      transaction_id: captureId,
      metadata: {
        capture_id: captureId,
        webhook_event_id: event.id,
        amount
      }
    })
    .eq('id', expectedPayment.id)
    .eq('status', 'pending')
    .select('id, transaction_id')
    .maybeSingle()

  if (paymentUpdateError) {
    throw new Error(`Failed to update parking payment from webhook: ${paymentUpdateError.message}`)
  }

  if (!updatedPayment) {
    const { data: existingPayment, error: existingPaymentLookupError } = await supabase
      .from('parking_booking_payments')
      .select('id, transaction_id, status')
      .eq('id', expectedPayment.id)
      .maybeSingle()

    if (existingPaymentLookupError) {
      throw new Error(`Failed to verify existing parking payment: ${existingPaymentLookupError.message}`)
    }

    if (!existingPayment) {
      throw new Error(`No parking payment found for booking ${bookingId}`)
    }

    if (
      existingPayment.transaction_id &&
      captureId &&
      existingPayment.transaction_id !== captureId
    ) {
      throw new Error(
        `Capture id mismatch for booking ${bookingId}: existing=${existingPayment.transaction_id} incoming=${captureId}`
      )
    }

    if (existingPayment.status === 'refunded') {
      logger.warn('Ignoring stale PayPal capture completion for already-refunded booking', {
        metadata: { bookingId }
      })
      return
    }

    if (existingPayment.status === 'failed') {
      const { data: recoveredPayment, error: recoverPaymentError } = await supabase
        .from('parking_booking_payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          transaction_id: captureId,
          metadata: {
            capture_id: captureId,
            webhook_event_id: event.id,
            amount
          }
        })
        .eq('id', existingPayment.id)
        .eq('status', 'failed')
        .select('id')
        .maybeSingle()

      if (recoverPaymentError) {
        throw new Error(`Failed to recover failed parking payment to paid: ${recoverPaymentError.message}`)
      }

      if (!recoveredPayment) {
        throw new Error(`Failed to recover parking payment ${existingPayment.id} to paid`)
      }
    } else if (existingPayment.status !== 'paid') {
      throw new Error(`Unsupported parking payment status for completion webhook: ${existingPayment.status}`)
    }
  }

  if (booking.payment_status !== 'refunded') {
    if (booking.status === 'cancelled') {
      const { data: cancelledBookingPaymentRow, error: cancelledBookingPaymentUpdateError } = await supabase
        .from('parking_bookings')
        .update({
          payment_status: 'paid'
        })
        .eq('id', bookingId)
        .select('id')
        .maybeSingle()

      if (cancelledBookingPaymentUpdateError) {
        throw new Error(`Failed to update cancelled parking booking payment state: ${cancelledBookingPaymentUpdateError.message}`)
      }
      if (!cancelledBookingPaymentRow) {
        throw new Error(`Cancelled parking booking missing during payment webhook update: ${bookingId}`)
      }
    } else {
      const { data: bookingUpdateRow, error: bookingUpdateError } = await supabase
        .from('parking_bookings')
        .update({
          payment_status: 'paid',
          status: 'confirmed',
          confirmed_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .select('id')
        .maybeSingle()

      if (bookingUpdateError) {
        throw new Error(`Failed to update parking booking from webhook: ${bookingUpdateError.message}`)
      }
      if (!bookingUpdateRow) {
        throw new Error(`Parking booking missing during payment webhook update: ${bookingId}`)
      }
    }
  } else {
    logger.warn('Skipping booking status update for refunded parking booking', {
      metadata: { bookingId }
    })
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      operation_type: 'payment_webhook_confirmed',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        amount,
        event_id: event.id,
        transaction_id: captureId,
        reference: booking.reference
      }
    })

  if (auditError) {
    throw new Error(`Failed to write parking payment webhook audit log: ${auditError.message}`)
  }
}

async function handlePaymentDenied(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const bookingId = resource.custom_id
  const reason = resource.status_details?.reason || 'DENIED'

  if (!bookingId) {
    throw new Error('Parking payment denied webhook missing booking ID')
  }

  const { data: deniedPayment, error: paymentUpdateError } = await supabase
    .from('parking_booking_payments')
    .update({
      status: 'failed',
      metadata: {
        webhook_event_id: event.id,
        failure_reason: reason
      }
    })
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (paymentUpdateError) {
    throw new Error(`Failed to mark parking payment denied: ${paymentUpdateError.message}`)
  }

  if (!deniedPayment) {
    const { data: existingPayment, error: existingPaymentLookupError } = await supabase
      .from('parking_booking_payments')
      .select('id, status')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingPaymentLookupError) {
      throw new Error(`Failed to verify existing parking payment after denied webhook: ${existingPaymentLookupError.message}`)
    }

    if (!existingPayment) {
      throw new Error(`No parking payment found for denied webhook booking ${bookingId}`)
    }

    if (existingPayment.status === 'failed') {
      await markParkingBookingPaymentFailed(supabase, bookingId, event.id)
    } else if (existingPayment.status === 'paid' || existingPayment.status === 'refunded' || existingPayment.status === 'expired') {
      return
    } else {
      throw new Error(`Unsupported parking payment status for denied webhook: ${existingPayment.status}`)
    }
  } else {
    await markParkingBookingPaymentFailed(supabase, bookingId, event.id)
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      operation_type: 'payment_webhook_denied',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'failure',
      additional_info: {
        event_id: event.id,
        reason
      }
    })

  if (auditError) {
    throw new Error(`Failed to write denied parking payment audit log: ${auditError.message}`)
  }
}

async function markParkingBookingPaymentFailed(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  eventId: string
) {
  const { data: updatedBooking, error: bookingUpdateError } = await supabase
    .from('parking_bookings')
    .update({ payment_status: 'failed' })
    .eq('id', bookingId)
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()

  if (bookingUpdateError) {
    throw new Error(`Failed to mark parking booking payment failed: ${bookingUpdateError.message}`)
  }

  if (updatedBooking) {
    return
  }

  const { data: booking, error: bookingLookupError } = await supabase
    .from('parking_bookings')
    .select('id, payment_status')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    throw new Error(`Failed to verify parking booking payment state: ${bookingLookupError.message}`)
  }

  if (!booking) {
    throw new Error(`Parking booking not found for denied payment webhook: ${bookingId}`)
  }

  if (booking.payment_status === 'failed') {
    return
  }

  if (booking.payment_status === 'paid' || booking.payment_status === 'refunded' || booking.payment_status === 'expired') {
    logger.warn('Ignoring stale PayPal capture denial for terminal parking booking', {
      metadata: {
        bookingId,
        eventId,
        paymentStatus: booking.payment_status
      }
    })
    return
  }

  throw new Error(`Unsupported parking booking payment status for denied webhook: ${booking.payment_status}`)
}
