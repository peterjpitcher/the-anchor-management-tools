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

// Prefix used in customId for private booking deposit orders
const DEPOSIT_CUSTOM_ID_PREFIX = 'pb-deposit-'

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
      event_type: input.eventType ?? null,
      source: 'private_bookings'
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null
  })

  if (error) {
    logger.error('Failed to store PayPal private-bookings webhook log', {
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

    // Check if this event is for a private booking deposit
    const customId = event?.resource?.custom_id ?? ''
    if (typeof customId !== 'string' || !customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX)) {
      // Not a private booking event — acknowledge without processing
      await logPayPalWebhook(supabase, {
        status: 'ignored',
        headers,
        body,
        eventId,
        eventType
      })
      return NextResponse.json({ received: true, ignored: true })
    }

    idempotencyKey = `webhook:paypal:private-bookings:${eventId}`
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
        await handleDepositCaptureCompleted(supabase, event)
        break
      case 'PAYMENT.CAPTURE.DENIED':
        await handleDepositCaptureDenied(supabase, event)
        break
      default:
        logger.info('Unhandled PayPal private-bookings webhook event type', {
          metadata: { eventId, eventType }
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
      logger.error('PayPal private-bookings webhook processed but failed to persist idempotency response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: { eventId, eventType }
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
        logger.error('Failed to release PayPal private-bookings webhook idempotency claim', {
          error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
          metadata: {
            idempotencyKey,
            eventId: idempotencyKey.replace('webhook:paypal:private-bookings:', '')
          }
        })
      }
    }

    logger.error('PayPal private-bookings webhook error', {
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

async function handleDepositCaptureCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  event: any
) {
  const resource = event.resource
  const customId: string = resource.custom_id ?? ''
  const captureId: string = resource.id ?? ''

  if (!customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX)) {
    throw new Error(`Private-bookings webhook received unexpected custom_id: ${customId}`)
  }

  const bookingId = customId.slice(DEPOSIT_CUSTOM_ID_PREFIX.length)
  if (!bookingId) {
    throw new Error('Private booking deposit webhook missing booking ID in custom_id')
  }

  const { data: booking, error: bookingLookupError } = await supabase
    .from('private_bookings')
    .select('id, deposit_paid_date, status')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    throw new Error(`Failed to load private booking for deposit webhook: ${bookingLookupError.message}`)
  }

  if (!booking) {
    throw new Error(`Private booking not found for deposit webhook: ${bookingId}`)
  }

  if (booking.deposit_paid_date) {
    // Already recorded — idempotent, no-op
    logger.info('Private booking deposit already recorded; ignoring duplicate webhook', {
      metadata: { bookingId, captureId }
    })
    return
  }

  const { error: updateError } = await supabase
    .from('private_bookings')
    .update({
      deposit_paid_date: new Date().toISOString(),
      deposit_payment_method: 'paypal',
      paypal_deposit_capture_id: captureId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .is('deposit_paid_date', null) // Guard against race with UI-side capture

  if (updateError) {
    throw new Error(`Failed to record private booking deposit from webhook: ${updateError.message}`)
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'paypal_deposit_captured_via_webhook',
      entity_type: 'private_booking',
      entity_id: bookingId,
      metadata: {
        capture_id: captureId,
        event_id: event.id,
        amount: resource.amount?.value ?? null,
      }
    })

  if (auditError) {
    throw new Error(`Failed to write private booking deposit webhook audit log: ${auditError.message}`)
  }
}

async function handleDepositCaptureDenied(
  supabase: ReturnType<typeof createAdminClient>,
  event: any
) {
  const resource = event.resource
  const customId: string = resource.custom_id ?? ''

  if (!customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX)) {
    throw new Error(`Private-bookings denied webhook received unexpected custom_id: ${customId}`)
  }

  const bookingId = customId.slice(DEPOSIT_CUSTOM_ID_PREFIX.length)
  if (!bookingId) {
    throw new Error('Private booking deposit denied webhook missing booking ID in custom_id')
  }

  // Clear the order ID so a new payment order can be created
  const { error: updateError } = await supabase
    .from('private_bookings')
    .update({
      paypal_deposit_order_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .is('deposit_paid_date', null) // Only clear if deposit not yet recorded

  if (updateError) {
    throw new Error(`Failed to clear denied PayPal order on private booking: ${updateError.message}`)
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'paypal_deposit_capture_denied',
      entity_type: 'private_booking',
      entity_id: bookingId,
      metadata: {
        event_id: event.id,
        reason: resource.status_details?.reason ?? 'DENIED',
      }
    })

  if (auditError) {
    throw new Error(`Failed to write private booking deposit denied audit log: ${auditError.message}`)
  }
}
