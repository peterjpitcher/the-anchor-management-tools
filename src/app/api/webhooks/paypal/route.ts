import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

// This top-level handler receives PayPal webhook events that are not routed to a
// resource-specific sub-handler (e.g. /api/webhooks/paypal/parking).
// It verifies the PayPal webhook signature, logs the event to the audit log,
// and returns 200 for unhandled event types so PayPal does not retry them.

export const dynamic = 'force-dynamic'

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
        typeof (error as any)?.message === 'string' ? (error as any).message : String(error)
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

    await logPayPalWebhookEvent(supabase, {
      status: 'success',
      headers,
      body,
      eventId,
      eventType,
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('PayPal general webhook error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await logPayPalWebhookEvent(supabase, {
      status: 'error',
      headers,
      body,
      errorMessage:
        error instanceof Error ? error.message : 'Webhook processing failed',
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
