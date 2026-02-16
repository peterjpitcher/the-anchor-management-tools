import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
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
      error: new Error(typeof (error as any)?.message === 'string' ? (error as any).message : String(error)),
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
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim()

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
        await handleRefundCompleted(supabase, event)
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
  const amount = parseFloat(resource.amount?.value ?? '0')

  if (!bookingId) {
    throw new Error('Parking payment completed webhook missing booking ID')
  }

  const { data: booking, error: bookingLookupError } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    throw new Error(`Failed to load parking booking: ${bookingLookupError.message}`)
  }

  if (!booking) {
    throw new Error(`Parking booking not found for payment webhook: ${bookingId}`)
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
    .eq('booking_id', bookingId)
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
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
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
      action: 'payment_webhook_confirmed',
      entity_type: 'parking_booking',
      entity_id: bookingId,
      metadata: {
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

  if (!bookingId) {
    throw new Error('Parking payment denied webhook missing booking ID')
  }

  const { data: deniedPayment, error: paymentUpdateError } = await supabase
    .from('parking_booking_payments')
    .update({
      status: 'failed',
      metadata: {
        webhook_event_id: event.id,
        failure_reason: resource.status_details?.reason || 'DENIED'
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

    if (existingPayment.status === 'failed' || existingPayment.status === 'paid' || existingPayment.status === 'refunded') {
      return
    }

    throw new Error(`Unsupported parking payment status for denied webhook: ${existingPayment.status}`)
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_webhook_denied',
      entity_type: 'parking_booking',
      entity_id: bookingId,
      metadata: {
        event_id: event.id,
        reason: resource.status_details?.reason
      }
    })

  if (auditError) {
    throw new Error(`Failed to write denied parking payment audit log: ${auditError.message}`)
  }
}

async function handleRefundCompleted(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const captureLink = resource.links?.find((link: any) => link.rel === 'up')?.href
  const captureId = captureLink ? captureLink.split('/').pop() : null
  const refundId = resource.id
  const amount = parseFloat(resource.amount?.value ?? '0')

  if (!captureId) {
    throw new Error('Parking refund webhook missing capture ID')
  }

  const { data: payment, error: paymentLookupError } = await supabase
    .from('parking_booking_payments')
    .select('*')
    .eq('transaction_id', captureId)
    .maybeSingle()

  if (paymentLookupError) {
    throw new Error(`Failed to load payment for refund webhook: ${paymentLookupError.message}`)
  }

  if (!payment) {
    throw new Error(`Parking payment not found for capture: ${captureId}`)
  }

  const { data: paymentUpdateRow, error: paymentUpdateError } = await supabase
    .from('parking_booking_payments')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      metadata: {
        ...(payment.metadata || {}),
        refund_id: refundId,
        refund_amount: amount
      }
    })
    .eq('id', payment.id)
    .select('id')
    .maybeSingle()

  if (paymentUpdateError) {
    throw new Error(`Failed to mark parking payment refunded: ${paymentUpdateError.message}`)
  }
  if (!paymentUpdateRow) {
    throw new Error(`Parking payment missing during refund webhook update: ${payment.id}`)
  }

  const { data: refundBookingUpdateRow, error: bookingUpdateError } = await supabase
    .from('parking_bookings')
    .update({
      payment_status: 'refunded',
      status: 'cancelled'
    })
    .eq('id', payment.booking_id)
    .select('id')
    .maybeSingle()

  if (bookingUpdateError) {
    throw new Error(`Failed to update parking booking refund state: ${bookingUpdateError.message}`)
  }
  if (!refundBookingUpdateRow) {
    throw new Error(`Parking booking missing during refund webhook update: ${payment.booking_id}`)
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_webhook_refunded',
      entity_type: 'parking_booking',
      entity_id: payment.booking_id,
      metadata: {
        refund_id: refundId,
        amount,
        event_id: event.id
      }
    })

  if (auditError) {
    throw new Error(`Failed to write refunded parking payment audit log: ${auditError.message}`)
  }
}
