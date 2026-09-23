import { NextRequest, NextResponse } from 'next/server'
import { gatePayPalWebhook, sanitizePayPalHeadersForLog } from '@/lib/paypal-webhook-gate'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
import { finalizeDepositPayment } from '@/services/private-bookings'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

const IDEMPOTENCY_TTL_HOURS = 24 * 30

// Prefix used in customId for private booking deposit orders
const DEPOSIT_CUSTOM_ID_PREFIX = 'pb-deposit-'

// Refund event types that bypass the custom_id prefix check
const REFUND_EVENT_TYPES = [
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.REFUND.PENDING',
  'PAYMENT.REFUND.FAILED',
]

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}


async function writePrivateBookingAudit(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    operationType: string
    bookingId: string
    operationStatus?: 'success' | 'failure'
    additionalInfo: Record<string, unknown>
  }
) {
  return supabase.from('audit_logs').insert({
    operation_type: params.operationType,
    resource_type: 'private_booking',
    resource_id: params.bookingId,
    operation_status: params.operationStatus ?? 'success',
    additional_info: params.additionalInfo,
  })
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
    headers: sanitizePayPalHeadersForLog(input.headers),
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

  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false

  try {
    // The id is resolved from PayPal by this endpoint's own URL. The configured
    // PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID stopped matching the registered webhook (a recreated
    // webhook gets a new id), so every delivery from 26 March to 22 September 2026 failed
    // verification. It is kept only as an emergency override for a PayPal registry outage, and
    // can never beat a positively resolved id.
    const gate = await gatePayPalWebhook({
      endpointPath: '/api/webhooks/paypal/private-bookings',
      endpointName: 'private-bookings',
      headers,
      body,
      envOverride: process.env.PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID,
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

    // Check if this event is for a private booking deposit.
    // Refund events don't carry custom_id on the refund resource, so bypass the prefix check.
    const isRefundEvent = REFUND_EVENT_TYPES.includes(eventType)
    const customId = event?.resource?.custom_id ?? ''
    if (!isRefundEvent && (typeof customId !== 'string' || !customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX))) {
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
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.REFUND.PENDING':
      case 'PAYMENT.REFUND.FAILED':
        await handleRefundEvent(supabase, event, 'private_booking')
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

  const capturedAmount = Number(resource.amount?.value ?? 0)

  // D15: Audit log BEFORE finalization so the capture attempt is recorded
  // even if finalizeDepositPayment throws
  const { error: preAuditError } = await writePrivateBookingAudit(supabase, {
    operationType: 'paypal_deposit_capture_attempted_via_webhook',
    bookingId,
    additionalInfo: {
      capture_id: captureId,
      event_id: event.id,
      amount: resource.amount?.value ?? null,
      status: 'attempted',
    }
  })

  if (preAuditError) {
    logger.error('Failed to write pre-finalization PayPal webhook audit log', {
      error: new Error(preAuditError.message),
      metadata: { bookingId, captureId }
    })
  }

  const finalizeResult = await finalizeDepositPayment({
    bookingId,
    amount: capturedAmount,
    method: 'paypal',
    paypalCaptureId: captureId,
  }, supabase)

  if (finalizeResult.alreadyRecorded) {
    logger.info('Private booking deposit already recorded; ignoring duplicate webhook', {
      metadata: { bookingId, captureId }
    })
    return
  }

  const { error: auditError } = await writePrivateBookingAudit(supabase, {
    operationType: 'paypal_deposit_captured_via_webhook',
    bookingId,
    additionalInfo: {
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

  // Clear the order ID so a new payment order can be created, but ONLY the order this denial
  // is actually about. A denial can arrive days after the fact now that retries are accepted,
  // and by then staff may have issued a replacement order: clearing by booking id alone would
  // wipe the live checkout and its recovery lookup. The invoices handler already guards this
  // way. A denial that names no order gets an audit row for manual review instead.
  const deniedOrderId = typeof resource?.supplementary_data?.related_ids?.order_id === 'string'
    ? resource.supplementary_data.related_ids.order_id.trim()
    : ''

  if (!deniedOrderId) {
    logger.error('Private booking deposit denial carried no order id; not clearing any order', {
      metadata: { bookingId, eventId: event.id },
    })

    const { error: unresolvedAuditError } = await writePrivateBookingAudit(supabase, {
      operationType: 'paypal_deposit_capture_denied_unresolved',
      bookingId,
      operationStatus: 'failure',
      additionalInfo: {
        event_id: event.id,
        reason: resource.status_details?.reason ?? 'DENIED',
        action_needed:
          'PayPal denied a deposit capture but named no order. Check the booking against PayPal by hand.',
      }
    })

    if (unresolvedAuditError) {
      throw new Error(`Failed to write private booking unresolved denial audit log: ${unresolvedAuditError.message}`)
    }
    return
  }

  const { data: cleared, error: updateError } = await (supabase
    .from('private_bookings') as any)
    .update({
      paypal_deposit_order_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('paypal_deposit_order_id', deniedOrderId) // Never clear a replacement order
    .is('deposit_paid_date', null) // Only clear if deposit not yet recorded
    .select('id')

  if (updateError) {
    throw new Error(`Failed to clear denied PayPal order on private booking: ${updateError.message}`)
  }

  const clearedCount = Array.isArray(cleared) ? cleared.length : 0
  if (clearedCount === 0) {
    logger.info('Private booking denial left the current order alone', {
      metadata: { bookingId, deniedOrderId, eventId: event.id },
    })
  }

  const { error: auditError } = await writePrivateBookingAudit(supabase, {
    operationType: 'paypal_deposit_capture_denied',
    bookingId,
    additionalInfo: {
      event_id: event.id,
      order_id: deniedOrderId,
      cleared: clearedCount > 0,
      reason: resource.status_details?.reason ?? 'DENIED',
    }
  })

  if (auditError) {
    throw new Error(`Failed to write private booking deposit denied audit log: ${auditError.message}`)
  }
}
