import { NextRequest, NextResponse } from 'next/server'
import { resolveWebhookIdForUrl, verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { applyInvoicePayPalCapture, positivePennies } from '@/lib/invoices/paypal-capture'
import { INVOICE_PAYMENT_CUSTOM_ID_PREFIX } from '@/lib/invoices/paypal-custom-id'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'

/**
 * PayPal webhook for invoice payments.
 *
 * This is the path that saves a payment when the customer closes the tab before
 * being redirected back, which is common. It is not the only path: the portal
 * return and the reconciliation cron cover the same ground, and all three write
 * through `record_invoice_paypal_payment_atomic`, which is keyed on the capture
 * id. Arriving second is normal and records nothing twice.
 *
 * NOTE: this endpoint has to be subscribed in the PayPal dashboard to receive
 * anything. Until it is, the 15 minute reconciliation cron is what settles
 * invoices, so payments are still recorded, just later.
 */

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
    'x-request-id',
    'x-vercel-id',
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
  ]
  const result: Record<string, string> = {}
  for (const key of allowedKeys) {
    if (headers[key]) result[key] = headers[key]
  }
  return result
}

async function logWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
  },
) {
  const { error } = await (supabase.from('webhook_logs') as any).insert({
    webhook_type: 'paypal',
    status: input.status,
    headers: sanitizeHeadersForLog(input.headers),
    body: truncate(input.body, 10000),
    params: {
      event_id: input.eventId ?? null,
      event_type: input.eventType ?? null,
      source: 'invoices',
    },
    error_message: truncate(input.errorMessage, 500),
  })

  if (error) {
    logger.error('Failed to store PayPal invoices webhook log', {
      error: new Error(error instanceof Error ? error.message : String(error)),
      metadata: { status: input.status, eventId: input.eventId },
    })
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  // Deliberately does NOT fall back to PAYPAL_WEBHOOK_ID: that is another
  // endpoint's id, and verifying against it would reject every genuine event
  // here. When the id cannot be resolved we fail closed and PayPal retries.
  const webhookId =
    process.env.PAYPAL_INVOICES_WEBHOOK_ID?.trim()
    || (await resolveWebhookIdForUrl(
      `${process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/api/webhooks/paypal/invoices`,
    ))

  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false

  try {
    if (!webhookId) {
      const errorMessage = 'No PayPal webhook is registered for the invoices endpoint'
      logger.error(errorMessage)
      await logWebhook(supabase, { status: 'configuration_error', headers, body, errorMessage })
      return NextResponse.json(
        { received: false, error: errorMessage },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 },
      )
    }

    // Never trust an unverified body: it would let anyone mark invoices paid.
    if (!(await verifyPayPalWebhook(headers, body, webhookId))) {
      await logWebhook(supabase, {
        status: 'signature_failed',
        headers,
        body,
        errorMessage: 'Invalid PayPal signature',
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let event: any
    try {
      event = JSON.parse(body)
    } catch {
      await logWebhook(supabase, { status: 'invalid_payload', headers, body })
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? event.event_type : 'unknown'

    if (!eventId) {
      await logWebhook(supabase, { status: 'invalid_payload', headers, body, eventType })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }

    // custom_id is the only routing key. Anything that is not ours is
    // acknowledged so PayPal stops retrying it against this endpoint.
    const customId = event?.resource?.custom_id ?? ''
    if (typeof customId !== 'string' || !customId.startsWith(INVOICE_PAYMENT_CUSTOM_ID_PREFIX)) {
      await logWebhook(supabase, { status: 'ignored', headers, body, eventId, eventType })
      return NextResponse.json({ received: true, ignored: true })
    }

    idempotencyKey = `webhook:paypal:invoices:${eventId}`
    requestHash = computeIdempotencyRequestHash(event)

    const claim = await claimIdempotencyKey(
      supabase,
      idempotencyKey,
      requestHash,
      IDEMPOTENCY_TTL_HOURS,
    )

    // Only a completed delivery can be acknowledged as a duplicate. A held
    // claim may still fail, so PayPal must retry it.
    if (claim.state === 'in_progress' || claim.state === 'conflict') {
      return NextResponse.json({ error: 'Webhook processing has not completed' }, { status: 503 })
    }
    if (claim.state === 'replay') {
      await logWebhook(supabase, { status: 'duplicate', headers, body, eventId, eventType })
      return NextResponse.json({ received: true, duplicate: true })
    }

    claimHeld = true
    await logWebhook(supabase, { status: 'received', headers, body, eventId, eventType })

    const invoiceId = customId.slice(INVOICE_PAYMENT_CUSTOM_ID_PREFIX.length)

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const captureId = typeof event?.resource?.id === 'string' ? event.resource.id : null
        const rawAmount = event?.resource?.amount?.value
        const pennies = positivePennies(rawAmount)
        const amount = pennies === null ? NaN : pennies / 100
        const currency = event?.resource?.amount?.currency_code

        if (!captureId || !Number.isFinite(amount) || amount <= 0) {
          logger.error('[InvoicePayPal webhook] Capture event missing usable amount or id', {
            error: new Error('invoice_capture_unreadable'),
            metadata: { eventId, invoiceId, captureId, rawAmount },
          })
          throw new Error('invoice_capture_unreadable')
        }

        if (currency !== 'GBP') {
          logger.error('[InvoicePayPal webhook] Capture was not in GBP, not applied', {
            error: new Error('invoice_capture_wrong_currency'),
            metadata: { eventId, invoiceId, currency },
          })
          throw new Error('invoice_capture_wrong_currency')
        }
        if (event.resource.status !== 'COMPLETED') throw new Error('invoice_capture_not_completed')

        const result = await applyInvoicePayPalCapture({
          invoiceId,
          amount,
          captureId,
          source: 'webhook',
          capturedAt: event.resource.create_time ?? null,
          orderId: event.resource.supplementary_data?.related_ids?.order_id ?? null,
        })

        if (result.error) {
          logger.error('[InvoicePayPal webhook] Could not record the capture', {
            error: new Error(result.error),
            metadata: { eventId, invoiceId, captureId },
          })
          throw new Error(result.error)
        }
        break
      }

      case 'PAYMENT.CAPTURE.DENIED': {
        // Release the order so a new link can be issued and nothing keeps
        // polling one PayPal has already refused. Guarded on the id so a
        // newer order created since is left alone.
        const orderId = typeof event?.resource?.supplementary_data?.related_ids?.order_id === 'string'
          ? event.resource.supplementary_data.related_ids.order_id
          : null

        if (orderId) {
          const { error: releaseError } = await supabase
            .from('invoices')
            .update({ paypal_order_id: null, updated_at: new Date().toISOString() })
            .eq('id', invoiceId)
            .eq('paypal_order_id', orderId)
          if (releaseError) throw releaseError
        }

        const { error: auditError } = await supabase.from('audit_logs').insert({
          operation_type: 'paypal_capture_denied',
          resource_type: 'invoice',
          resource_id: invoiceId,
          operation_status: 'failure',
          additional_info: { event_id: eventId, event_type: eventType, order_id: orderId },
        })
        if (auditError) throw auditError
        break
      }

      default:
        logger.info('Unhandled PayPal invoices webhook event type', {
          metadata: { eventId, eventType },
        })
    }

    try {
      await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, {
        received: true,
        event_id: eventId,
      })
      claimHeld = false
    } catch (persistError) {
      logger.error('Failed to persist PayPal invoices webhook idempotency response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: { eventId },
      })
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('PayPal invoices webhook failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await logWebhook(supabase, {
      status: 'error',
      headers,
      body,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  } finally {
    // A held claim would make PayPal's retry look like a duplicate and drop it.
    if (claimHeld && idempotencyKey && requestHash) {
      await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash).catch(() => {})
    }
  }
}
