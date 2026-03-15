import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'

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

  sanitized['paypal-transmission-sig-present'] = headers['paypal-transmission-sig'] ? 'true' : 'false'
  return sanitized
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
    errorDetails?: unknown
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
      source: 'table_bookings',
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null,
  })

  if (error) {
    logger.error('Failed to store PayPal table-bookings webhook log', {
      error: new Error(
        typeof (error as any)?.message === 'string' ? (error as any).message : String(error),
      ),
      metadata: {
        status: input.status,
        eventId: input.eventId,
        eventType: input.eventType,
      },
    })
  }
}

async function handleDepositCaptureCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
) {
  const resource = event.resource
  const captureId: string = resource.id ?? ''
  // PayPal includes the originating order ID in supplementary_data
  const orderId: string =
    resource.supplementary_data?.related_ids?.order_id ?? ''

  if (!captureId) {
    throw new Error('Table-bookings capture webhook missing captureId (resource.id)')
  }

  if (!orderId) {
    throw new Error(
      'Table-bookings capture webhook missing orderId (resource.supplementary_data.related_ids.order_id)',
    )
  }

  const { data: booking, error: fetchError } = await supabase
    .from('table_bookings')
    .select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id')
    .eq('paypal_deposit_order_id', orderId)
    .maybeSingle()

  if (fetchError) {
    throw new Error(`Failed to look up table booking for deposit webhook: ${fetchError.message}`)
  }

  if (!booking) {
    logger.error('Table booking not found for PayPal deposit webhook', {
      metadata: { orderId, captureId, eventId: event.id },
    })
    // Return — acknowledge PayPal without error so it doesn't retry
    return
  }

  if (booking.paypal_deposit_capture_id) {
    // Already processed (e.g. browser capture succeeded before webhook arrived)
    logger.info('Table booking deposit already captured; ignoring webhook', {
      metadata: { bookingId: booking.id, captureId, orderId },
    })
    return
  }

  const { error: updateError } = await supabase
    .from('table_bookings')
    .update({
      payment_status: 'completed',
      status: 'confirmed',
      payment_method: 'paypal',
      paypal_deposit_capture_id: captureId,
    })
    .eq('id', booking.id)
    .is('paypal_deposit_capture_id', null) // Guard against race with browser-side capture

  if (updateError) {
    throw new Error(
      `Failed to update table booking for deposit webhook: ${updateError.message}`,
    )
  }

  await logAuditEvent({
    operation_type: 'payment.captured',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    additional_info: {
      capture_id: captureId,
      order_id: orderId,
      event_id: event.id,
      source: 'webhook',
      amount: resource.amount?.value ?? null,
    },
  })
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const webhookId = process.env.PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID?.trim()

  try {
    if (!webhookId) {
      const errorMessage = 'PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID not configured'
      logger.error(errorMessage)
      await logWebhook(supabase, { status: 'configuration_error', headers, body, errorMessage })
      return NextResponse.json(
        { received: false, error: errorMessage },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 },
      )
    }

    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
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
    } catch (parseError) {
      await logWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        errorMessage: 'Invalid JSON payload',
        errorDetails: parseError instanceof Error ? { message: parseError.message } : null,
      })
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? event.event_type : 'unknown'

    if (!eventId) {
      await logWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        eventType,
        errorMessage: 'Missing event id',
      })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }

    // Only handle PAYMENT.CAPTURE.COMPLETED — acknowledge and ignore all others
    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
      await logWebhook(supabase, { status: 'ignored', headers, body, eventId, eventType })
      return NextResponse.json({ received: true, ignored: true })
    }

    // Idempotency: check webhook_logs for a previously processed record with this event ID
    const { data: existingLog, error: logCheckError } = await (
      supabase.from('webhook_logs') as any
    )
      .select('id')
      .eq('params->>event_id', eventId)
      .eq('params->>source', 'table_bookings')
      .in('status', ['processed', 'received'])
      .maybeSingle()

    if (logCheckError) {
      logger.error('Failed to check webhook_logs for duplicate table-bookings event', {
        error: new Error(
          typeof logCheckError?.message === 'string' ? logCheckError.message : String(logCheckError),
        ),
        metadata: { eventId },
      })
      // Fail open — continue processing rather than block
    }

    if (existingLog) {
      await logWebhook(supabase, { status: 'duplicate', headers, body, eventId, eventType })
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Record receipt before processing (idempotency anchor)
    await logWebhook(supabase, { status: 'received', headers, body, eventId, eventType })

    await handleDepositCaptureCompleted(supabase, event)

    // Mark as processed
    await (supabase.from('webhook_logs') as any)
      .update({ status: 'processed' })
      .eq('params->>event_id', eventId)
      .eq('params->>source', 'table_bookings')

    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('PayPal table-bookings webhook error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await logWebhook(supabase, {
      status: 'error',
      headers,
      body,
      errorMessage: error instanceof Error ? error.message : 'Webhook processing failed',
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
