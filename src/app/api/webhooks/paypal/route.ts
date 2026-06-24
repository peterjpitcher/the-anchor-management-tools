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

// This top-level handler receives PayPal webhook events that are not routed to a
// resource-specific sub-handler (e.g. /api/webhooks/paypal/parking).
// It verifies the PayPal webhook signature, logs the event to the audit log,
// and returns 200 for unhandled event types so PayPal does not retry them.

export const dynamic = 'force-dynamic'

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
    'paypal-transmission-time',
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  // Record whether the signature header was present, never its raw value.
  sanitized['paypal-transmission-sig-present'] = headers['paypal-transmission-sig'] ? 'true' : 'false'
  return sanitized
}

async function logPayPalWebhookEvent(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
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
    },
    error_message: truncate(input.errorMessage ?? null, 500),
  })

  if (error) {
    logger.error('Failed to store PayPal general webhook log', {
      error: new Error(
        error instanceof Error ? error.message : String(error)
      ),
      metadata: {
        status: input.status,
        eventId: input.eventId,
        eventType: input.eventType,
      },
    })
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim()
  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false
  let parsedEventId: string | undefined
  let parsedEventType: string | undefined

  try {
    if (!webhookId) {
      const errorMessage = 'PAYPAL_WEBHOOK_ID not configured'
      logger.error(errorMessage)
      await logPayPalWebhookEvent(supabase, {
        status: 'configuration_error',
        headers,
        body,
        errorMessage,
      })
      // Return 500 only in production so misconfigured dev environments still work.
      return NextResponse.json(
        { received: false, error: errorMessage },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 }
      )
    }

    // Verify the PayPal webhook signature before processing any payload.
    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
      await logPayPalWebhookEvent(supabase, {
        status: 'signature_failed',
        headers,
        body,
        errorMessage: 'Invalid PayPal webhook signature',
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let event: Record<string, unknown>
    try {
      event = JSON.parse(body) as Record<string, unknown>
    } catch (parseError) {
      await logPayPalWebhookEvent(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        errorMessage: 'Invalid JSON payload',
      })
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? (event.event_type as string) : 'unknown'
    const resource = event?.resource as Record<string, unknown> | undefined
    parsedEventId = eventId
    parsedEventType = eventType

    if (!eventId) {
      await logPayPalWebhookEvent(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        eventType,
        errorMessage: 'Missing event id',
      })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }

    idempotencyKey = `webhook:paypal:general:${eventId}`
    requestHash = computeIdempotencyRequestHash(event)

    const claim = await claimIdempotencyKey(
      supabase,
      idempotencyKey,
      requestHash,
      IDEMPOTENCY_TTL_HOURS
    )

    if (claim.state === 'conflict') {
      await logPayPalWebhookEvent(supabase, {
        status: 'idempotency_conflict',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: 'Event id reused with a different payload',
      })
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }

    if (claim.state === 'in_progress') {
      await logPayPalWebhookEvent(supabase, {
        status: 'in_progress',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: 'Event is currently being processed',
      })
      return NextResponse.json(
        { error: 'Event is currently being processed' },
        { status: 409 }
      )
    }

    if (claim.state === 'replay') {
      await logPayPalWebhookEvent(supabase, {
        status: 'duplicate',
        headers,
        body,
        eventId,
        eventType,
      })
      return NextResponse.json({ received: true, duplicate: true })
    }

    claimHeld = true

    await logPayPalWebhookEvent(supabase, {
      status: 'received',
      headers,
      body,
      eventId,
      eventType,
    })

    // Handle known events that affect invoice payment status.
    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const captureId = typeof resource?.id === 'string' ? resource.id : null
        const amountValue = (resource?.amount as Record<string, unknown> | undefined)?.value
        const amount = typeof amountValue === 'string' ? parseFloat(amountValue) : null
        const customId = typeof resource?.custom_id === 'string' ? resource.custom_id : null

        // Write an audit log entry so the event is traceable even without
        // a dedicated handler. Resource-specific sub-routes handle the full
        // business logic for known entity types.
        await supabase.from('audit_logs').insert({
          operation_type: 'paypal_capture_completed',
          resource_type: 'paypal_webhook',
          resource_id: eventId || null,
          operation_status: 'success',
          additional_info: {
            event_id: eventId,
            event_type: eventType,
            capture_id: captureId,
            amount,
            custom_id: customId,
          },
        })
        break
      }

      case 'PAYMENT.CAPTURE.DENIED': {
        const captureId = typeof resource?.id === 'string' ? resource.id : null
        const customId = typeof resource?.custom_id === 'string' ? resource.custom_id : null
        const statusDetails = resource?.status_details as Record<string, unknown> | undefined
        const reason =
          typeof statusDetails?.reason === 'string' ? statusDetails.reason : 'DENIED'

        await supabase.from('audit_logs').insert({
          operation_type: 'paypal_capture_denied',
          resource_type: 'paypal_webhook',
          resource_id: eventId || null,
          operation_status: 'failure',
          additional_info: {
            event_id: eventId,
            event_type: eventType,
            capture_id: captureId,
            custom_id: customId,
            reason,
          },
        })
        break
      }

      default:
        // Return 200 for unhandled event types so PayPal stops retrying them.
        logger.info('Unhandled PayPal general webhook event type', {
          metadata: { eventId, eventType },
        })
        break
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
          processed_at: new Date().toISOString(),
        },
        IDEMPOTENCY_TTL_HOURS
      )
      claimHeld = false
    } catch (persistError) {
      logger.error('PayPal general webhook processed but failed to persist idempotency response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: {
          eventId,
          eventType,
        },
      })

      await logPayPalWebhookEvent(supabase, {
        status: 'idempotency_persist_failed',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: persistError instanceof Error ? persistError.message : String(persistError),
      })

      return NextResponse.json({ received: true, idempotency_persist_failed: true })
    }

    await logPayPalWebhookEvent(supabase, {
      status: 'success',
      headers,
      body,
      eventId,
      eventType,
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    if (claimHeld && idempotencyKey && requestHash) {
      try {
        await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
      } catch (releaseError) {
        logger.error('Failed to release PayPal general webhook idempotency claim', {
          error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
          metadata: {
            idempotencyKey,
            eventId: parsedEventId,
            eventType: parsedEventType,
          },
        })
      }
    }

    logger.error('PayPal general webhook error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await logPayPalWebhookEvent(supabase, {
      status: 'error',
      headers,
      body,
      eventId: parsedEventId,
      eventType: parsedEventType,
      errorMessage:
        error instanceof Error ? error.message : 'Webhook processing failed',
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
