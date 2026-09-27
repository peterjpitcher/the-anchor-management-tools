import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { gatePayPalWebhook, sanitizePayPalHeadersForLog } from '@/lib/paypal-webhook-gate'
import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
import {
  PAYPAL_REFUND_EVENT_TYPES,
  PAYPAL_REVERSAL_EVENT_TYPE,
  routePayPalEvent,
  type PayPalRouteDecision,
} from '@/lib/paypal-webhook-router'
import { readPayPalRefundResource } from '@/lib/paypal-refund-resource'
import { alertStaffToPayPalMoneyEvent } from '@/lib/paypal-money-alerts'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { handleInvoiceCapture, handleInvoiceDenied, handleInvoiceRefund } from '@/lib/paypal-domains/invoices'
import {
  handleDepositCaptureCompleted as handlePrivateBookingCapture,
  handleDepositCaptureDenied as handlePrivateBookingDenied,
} from '@/lib/paypal-domains/private-bookings'
import {
  handleDepositCaptureCompleted as handleTableBookingCapture,
  handleDepositCaptureDenied as handleTableBookingDenied,
} from '@/lib/paypal-domains/table-bookings'
import { handlePaymentCompleted as handleParkingCapture, handlePaymentDenied as handleParkingDenied } from '@/lib/paypal-domains/parking'
import {
  handleEventBookingCapture,
  handleEventBookingRefund,
  type EventBookingOutcome,
} from '@/lib/paypal-domains/event-bookings'

/**
 * One pipeline for every PayPal webhook delivery, whichever URL it arrives on.
 *
 * PayPal fans every event on the app out to every registered webhook, so five URLs were five
 * copies of the same feed. They now all run this, which means:
 *
 *  - ONE idempotency namespace. The same event arriving on two URLs is processed once, not
 *    once per URL, and the second arrival is acknowledged as a duplicate.
 *  - Positive routing. The URL an event lands on no longer implies whose event it is, which is
 *    what let the table-bookings route log "success" for five captures that were really
 *    invoices and private bookings.
 *  - An event we cannot place is acknowledged and logged `unrouted`, never 500. A 500 would
 *    have PayPal retry someone else's event against us for three days.
 *
 * Once a single URL is the only registration, the rest can be deleted with no change here.
 */

const IDEMPOTENCY_TTL_HOURS = 24 * 30

type DispatchOptions = {
  /** Path under the app URL, used to resolve this URL's webhook id. */
  endpointPath: string
  /** Label for messages and logs. */
  endpointName: string
  /** This endpoint's own webhook id env var, used only during a PayPal registry outage. */
  envOverride?: string | null
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

async function logWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    source: string
    eventId?: string
    eventType?: string
    errorMessage?: string
    errorDetails?: unknown
  },
) {
  const { error } = await (supabase.from('webhook_logs') as any).insert({
    webhook_type: 'paypal',
    status: input.status,
    headers: sanitizePayPalHeadersForLog(input.headers),
    body: truncate(input.body, 10000),
    params: {
      event_id: input.eventId ?? null,
      event_type: input.eventType ?? null,
      // The domain the event was routed to, not the URL it arrived on. The URL means nothing.
      source: input.source,
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null,
  })

  if (error) {
    logger.error('Failed to store PayPal webhook log', {
      error: new Error(error instanceof Error ? error.message : String(error)),
      metadata: { status: input.status, eventId: input.eventId, eventType: input.eventType },
    })
  }
}

/**
 * What a refund or reversal handler did with the money: recorded it, or left it for a person.
 * Capture handlers return nothing and are always a plain "processed".
 */
type MoneyOutcome = { recorded: boolean; manualReview: boolean; reason?: string | null; state?: string }

function fromRefundOutcome(
  outcome: { state: string; manualReview?: boolean; reason?: string } | void,
): MoneyOutcome | null {
  // Tolerates a handler (or a test double) that returns nothing: that is an ordinary success.
  if (!outcome) return { recorded: true, manualReview: false }
  const manualReview = outcome.manualReview === true
  return { recorded: !manualReview, manualReview, reason: outcome.reason ?? null, state: outcome.state }
}

async function runDomainHandler(
  supabase: ReturnType<typeof createAdminClient>,
  decision: PayPalRouteDecision,
  event: any, // PayPal webhook event payload is not typed in this project
  eventId: string,
  eventType: string,
): Promise<{ result: Record<string, unknown>; httpStatus: number; responseBody: Record<string, unknown> }> {
  if (decision.domain === null) {
    throw new Error('runDomainHandler called without a domain')
  }

  const isRefund = PAYPAL_REFUND_EVENT_TYPES.has(eventType)
  const isReversal = eventType === PAYPAL_REVERSAL_EVENT_TYPE
  const moneyKind = isReversal ? 'reversal' : 'refund'
  let money: MoneyOutcome | null = null
  let eventOutcome: EventBookingOutcome | null = null

  switch (decision.domain) {
    case 'invoices': {
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        await handleInvoiceCapture(event, eventId, decision.key)
      } else if (eventType === 'PAYMENT.CAPTURE.DENIED') {
        await handleInvoiceDenied(supabase, event, eventId, decision.key)
      } else if (isRefund || isReversal) {
        money = fromRefundOutcome(await handleInvoiceRefund(supabase, event, eventId, decision.key, moneyKind))
      }
      break
    }

    case 'private_bookings': {
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        await handlePrivateBookingCapture(supabase, event)
      } else if (eventType === 'PAYMENT.CAPTURE.DENIED') {
        await handlePrivateBookingDenied(supabase, event)
      } else if (isRefund || isReversal) {
        money = fromRefundOutcome(await handleRefundEvent(supabase, event, 'private_booking', { kind: moneyKind }))
      }
      break
    }

    case 'table_bookings': {
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        await handleTableBookingCapture(supabase, event)
      } else if (eventType === 'PAYMENT.CAPTURE.DENIED') {
        await handleTableBookingDenied(supabase, event, decision.key)
      } else if (isRefund || isReversal) {
        money = fromRefundOutcome(await handleRefundEvent(supabase, event, 'table_booking', { kind: moneyKind }))
      }
      break
    }

    case 'parking': {
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        await handleParkingCapture(supabase, event)
      } else if (eventType === 'PAYMENT.CAPTURE.DENIED') {
        await handleParkingDenied(supabase, event)
      } else if (isRefund || isReversal) {
        money = fromRefundOutcome(await handleRefundEvent(supabase, event, 'parking', { kind: moneyKind }))
      }
      break
    }

    case 'event_bookings': {
      eventOutcome = isRefund || isReversal
        ? await handleEventBookingRefund(supabase, event, eventId, decision.key, moneyKind)
        : await handleEventBookingCapture(supabase, event, eventId)
      money = eventOutcome.money ?? null
      break
    }
  }

  // Every reversal is a person's business, recorded or not; a refund only when it could not be
  // recorded. Staff are told once per PayPal refund id, never the customer. Raised only once the
  // handler has succeeded: a failed write has already thrown, and PayPal's retry alerts instead.
  if (money && (isReversal || money.manualReview)) {
    await alertStaffToPayPalMoneyEvent(supabase, {
      kind: isReversal ? 'reversal' : 'refund_review',
      domain: decision.domain,
      key: decision.key,
      eventId,
      eventType,
      refund: readPayPalRefundResource(event),
      recorded: money.recorded,
      reason: money.reason ?? null,
    })
  }

  if (eventOutcome) {
    // Event bookings answer PayPal with their own state, as this route always has.
    return eventOutcome
  }

  const manualReview = money?.manualReview === true
  return {
    result: {
      state: manualReview ? 'manual_review' : 'processed',
      ...(money ? { money_state: money.state ?? null, reason: money.reason ?? null } : {}),
      event_id: eventId,
      event_type: eventType,
      domain: decision.domain,
      processed_at: new Date().toISOString(),
    },
    // 202 is still an acknowledgement (PayPal stops), but logs the delivery as `manual_review`.
    httpStatus: manualReview ? 202 : 200,
    // A bare acknowledgement is all PayPal needs, and all these routes have ever returned.
    // The detail goes to the idempotency record and the log, not over the wire.
    responseBody: { received: true },
  }
}

export async function handlePayPalWebhook(
  request: NextRequest,
  options: DispatchOptions,
): Promise<Response> {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false
  // Before routing we do not know whose event this is, so a failure is attributed to the URL it
  // arrived on, in the same underscore form the routed values use.
  let source = options.endpointName.replace(/-/g, '_')
  let loggedEventId: string | undefined
  let loggedEventType: string | undefined

  try {
    const gate = await gatePayPalWebhook({
      endpointPath: options.endpointPath,
      endpointName: options.endpointName,
      headers,
      body,
      envOverride: options.envOverride,
    })

    if (!gate.ok) {
      await logWebhook(supabase, {
        status: gate.logStatus,
        headers,
        body,
        source,
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
      await logWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        source,
        eventType,
        errorMessage: 'Missing event id',
      })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }
    loggedEventId = eventId

    // One namespace for the whole app, NOT one per URL. The same event delivered to several
    // registered URLs must be processed once between them.
    idempotencyKey = `webhook:paypal:${eventId}`
    requestHash = computeIdempotencyRequestHash(event)

    const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash, IDEMPOTENCY_TTL_HOURS)

    if (claim.state === 'conflict') {
      await logWebhook(supabase, {
        status: 'idempotency_conflict',
        headers,
        body,
        source,
        eventId,
        eventType,
        errorMessage: 'Event id reused with a different payload',
      })
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }

    if (claim.state === 'in_progress') {
      // Another URL's delivery of this same event is mid-flight. 409 so PayPal retries; by then
      // it will read as a duplicate.
      await logWebhook(supabase, {
        status: 'in_progress',
        headers,
        body,
        source,
        eventId,
        eventType,
        errorMessage: 'Event is currently being processed',
      })
      return NextResponse.json({ error: 'Event is currently being processed' }, { status: 409 })
    }

    if (claim.state === 'replay') {
      await logWebhook(supabase, { status: 'duplicate', headers, body, source, eventId, eventType })
      return NextResponse.json({ received: true, duplicate: true })
    }

    claimHeld = true

    const decision = await routePayPalEvent(supabase, event)

    if (decision.domain === null) {
      // Not ours, or not placeable. Acknowledge so PayPal stops retrying, and leave a row a
      // human can find. Never 500 here.
      source = 'unrouted'
      await logWebhook(supabase, {
        status: 'unrouted',
        headers,
        body,
        source,
        eventId,
        eventType,
        errorMessage: decision.reason,
        errorDetails: { arrived_on: options.endpointName, reason: decision.reason },
      })

      await persistIdempotencyResponse(
        supabase,
        idempotencyKey,
        requestHash,
        { state: 'unrouted', reason: decision.reason, event_id: eventId, event_type: eventType },
        IDEMPOTENCY_TTL_HOURS,
      )
      claimHeld = false

      return NextResponse.json({ received: true, unrouted: true })
    }

    source = decision.domain

    await logWebhook(supabase, {
      status: 'received',
      headers,
      body,
      source,
      eventId,
      eventType,
      errorDetails: { arrived_on: options.endpointName, routed_via: decision.via },
    })

    const outcome = await runDomainHandler(supabase, decision, event, eventId, eventType)

    try {
      await persistIdempotencyResponse(
        supabase,
        idempotencyKey,
        requestHash,
        outcome.result,
        IDEMPOTENCY_TTL_HOURS,
      )
      claimHeld = false
    } catch (persistError) {
      // Returning 500 would have PayPal retry, repeating non-transactional side effects (logs,
      // emails) even though the handler has already committed.
      logger.error('PayPal webhook processed but failed to persist idempotency response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: { eventId, eventType, domain: decision.domain },
      })

      await logWebhook(supabase, {
        status: 'idempotency_persist_failed',
        headers,
        body,
        source,
        eventId,
        eventType,
        errorMessage: persistError instanceof Error ? persistError.message : String(persistError),
      })

      return NextResponse.json({ received: true, idempotency_persist_failed: true })
    }

    await logWebhook(supabase, {
      status: outcome.httpStatus === 202 ? 'manual_review' : 'success',
      headers,
      body,
      source,
      eventId,
      eventType,
    })

    return NextResponse.json({ received: true, ...outcome.responseBody }, { status: outcome.httpStatus })
  } catch (error) {
    if (claimHeld && idempotencyKey && requestHash) {
      try {
        await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
      } catch (releaseError) {
        logger.error('Failed to release PayPal webhook idempotency claim', {
          error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
          metadata: { idempotencyKey },
        })
      }
    }

    logger.error('PayPal webhook error', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { arrivedOn: options.endpointName, eventId: loggedEventId },
    })

    await logWebhook(supabase, {
      status: 'error',
      headers,
      body,
      source,
      eventId: loggedEventId,
      eventType: loggedEventType,
      errorMessage: error instanceof Error ? error.message : 'Webhook processing failed',
    })

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
