import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import {
  verifyStripeWebhookSignature
} from '@/lib/payments/stripe'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  sendTableBookingConfirmedAfterDepositSmsIfAllowed,
} from '@/lib/table-bookings/bookings'

export const runtime = 'nodejs'

type StripeWebhookEvent = {
  id: string
  type: string
  data?: {
    object?: any
  }
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeStripeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id'
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['stripe-signature-present'] = headers['stripe-signature'] ? 'true' : 'false'
  return sanitized
}

async function logStripeWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
  }
): Promise<void> {
  try {
    await supabase.from('webhook_logs').insert({
      webhook_type: 'stripe',
      status: input.status,
      headers: sanitizeStripeHeadersForLog(input.headers),
      body: truncate(input.body, 10000),
      params: {
        event_id: input.eventId ?? null,
        event_type: input.eventType ?? null
      },
      error_message: truncate(input.errorMessage, 500)
    })
  } catch (error) {
    logger.warn('Failed to store Stripe webhook log', {
      metadata: {
        status: input.status,
        eventId: input.eventId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }
}

type TableDepositCompletedResult = {
  state: 'confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  booking_reference?: string
  party_size?: number
}

function getSessionMetadata(stripeSession: any): Record<string, string> {
  if (typeof stripeSession?.metadata === 'object' && stripeSession.metadata !== null) {
    return stripeSession.metadata as Record<string, string>
  }
  return {}
}

async function recordAnalyticsEventSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: string
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record Stripe webhook analytics event', {
      metadata: {
        context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

async function handleCheckoutSessionCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const paymentKind = metadata.payment_kind || 'unknown'

  if (paymentKind === 'table_deposit') {
    const tableBookingId = typeof metadata.table_booking_id === 'string'
      ? metadata.table_booking_id
      : typeof stripeSession?.client_reference_id === 'string'
        ? stripeSession.client_reference_id
        : null

    if (!tableBookingId) {
      return
    }

    const paymentIntentId = typeof stripeSession?.payment_intent === 'string'
      ? stripeSession.payment_intent
      : ''
    const amount = typeof stripeSession?.amount_total === 'number'
      ? Number((stripeSession.amount_total / 100).toFixed(2))
      : null
    const currency = typeof stripeSession?.currency === 'string'
      ? stripeSession.currency.toUpperCase()
      : 'GBP'

    const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('confirm_table_payment_v05', {
      p_table_booking_id: tableBookingId,
      p_checkout_session_id: checkoutSessionId,
      p_payment_intent_id: paymentIntentId || null,
      p_amount: amount,
      p_currency: currency,
    })

    if (rpcError) {
      throw rpcError
    }

    const rpcResult = (rpcResultRaw ?? {}) as TableDepositCompletedResult

    if (rpcResult.state === 'confirmed' && rpcResult.table_booking_id && rpcResult.customer_id) {
      // Lock the actually-captured GBP amount from the Stripe session. Authoritative.
      // Fail-closed: if `amount_total` is null/unparseable, log + skip the lock
      // write rather than guess. We deliberately do NOT fall back to
      // booking.deposit_amount — that's how stale amounts get locked.
      // Spec §6, §7.4, §8.3.
      //
      // Defects WF-003 / SEC-003: the Supabase JS client cannot wrap the RPC
      // and the follow-up UPDATE in a single transaction, so we fail the
      // webhook (throwing → 500 → Stripe retries) when the lock write errors.
      // The booking is already confirmed by the RPC; the retry will re-run
      // confirm_table_payment_v05 (idempotent — `IF v_booking.status =
      // 'pending_payment'` short-circuits) and try the lock write again.
      // Without this, a captured payment can leave the booking confirmed
      // with deposit_amount_locked IS NULL, breaking the canonical-amount
      // invariant that locked > stored > computed.
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
        const { error: lockError } = await supabase
          .from('table_bookings')
          .update({ deposit_amount_locked: amount })
          .eq('id', rpcResult.table_booking_id)
        if (lockError) {
          logger.error('stripe-webhook: failed to lock deposit amount on table booking — failing webhook for Stripe retry', {
            error: new Error(lockError.message),
            metadata: {
              tableBookingId: rpcResult.table_booking_id,
              checkoutSessionId,
              amount,
            },
          })
          throw new Error(`Failed to lock deposit_amount on table booking ${rpcResult.table_booking_id}: ${lockError.message}`)
        }
      } else {
        logger.error('stripe-webhook: missing/invalid amount_total — skipping deposit_amount_locked write', {
          metadata: {
            tableBookingId: rpcResult.table_booking_id,
            checkoutSessionId,
            rawAmount: amount,
          },
        })
      }

      const [analyticsOutcome, smsOutcome] = await Promise.allSettled([
        recordAnalyticsEventSafe(supabase, {
          customerId: rpcResult.customer_id,
          tableBookingId: rpcResult.table_booking_id,
          eventType: 'payment_succeeded',
          metadata: {
            payment_kind: 'table_deposit',
            stripe_checkout_session_id: checkoutSessionId,
            stripe_payment_intent_id: paymentIntentId || null,
            amount,
            currency,
            booking_reference: rpcResult.booking_reference || null,
            party_size: rpcResult.party_size ?? null,
          }
        }, 'table_deposit_payment_succeeded'),
        sendTableBookingConfirmedAfterDepositSmsIfAllowed(supabase, rpcResult.table_booking_id),
      ])

      if (analyticsOutcome.status === 'rejected') {
        const reason = analyticsOutcome.reason instanceof Error
          ? analyticsOutcome.reason.message
          : String(analyticsOutcome.reason)
        logger.warn('Table deposit payment analytics task rejected unexpectedly', {
          metadata: {
            tableBookingId: rpcResult.table_booking_id,
            customerId: rpcResult.customer_id,
            checkoutSessionId,
            error: reason,
          }
        })
      }

      if (smsOutcome.status === 'rejected') {
        const reason = smsOutcome.reason instanceof Error ? smsOutcome.reason.message : String(smsOutcome.reason)
        logger.error('Table deposit confirmation SMS task rejected unexpectedly', {
          error: smsOutcome.reason instanceof Error ? smsOutcome.reason : new Error(String(smsOutcome.reason)),
          metadata: {
            tableBookingId: rpcResult.table_booking_id,
            checkoutSessionId,
            error: reason,
          }
        })
      } else {
        const smsResult = smsOutcome.value as {
          success?: boolean
          code?: string | null
          logFailure?: boolean
          error?: string | null
        } | null
        const smsCode = typeof smsResult?.code === 'string' ? smsResult.code : null
        const smsLogFailure = smsResult?.logFailure === true || smsCode === 'logging_failed'
        if (smsResult && smsResult.success !== true) {
          if (smsLogFailure) {
            logger.error('Table deposit confirmation SMS reported logging failure', {
              metadata: {
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                code: smsCode,
                logFailure: smsLogFailure,
                error: typeof smsResult.error === 'string' ? smsResult.error : null,
              }
            })
          } else {
            logger.warn('Table deposit confirmation SMS send returned non-success', {
              metadata: {
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                code: smsCode,
                logFailure: smsLogFailure,
                error: typeof smsResult.error === 'string' ? smsResult.error : null,
              }
            })
          }
        }
      }
      return
    }

    if (rpcResult.state === 'blocked') {
      const candidateCustomerId =
        typeof rpcResult.customer_id === 'string' && rpcResult.customer_id.length > 0
          ? rpcResult.customer_id
          : null
      const customerId = candidateCustomerId || (
        await (async () => {
          const { data: booking } = await supabase.from('table_bookings')
            .select('customer_id')
            .eq('id', tableBookingId)
            .maybeSingle()
          return typeof booking?.customer_id === 'string' ? booking.customer_id : null
        })()
      )

      if (customerId) {
        await recordAnalyticsEventSafe(supabase, {
          customerId,
          tableBookingId,
          eventType: 'payment_failed',
          metadata: {
            payment_kind: 'table_deposit',
            stripe_checkout_session_id: checkoutSessionId,
            reason: rpcResult.reason || 'blocked',
          }
        }, 'table_deposit_payment_blocked')
      }
    }

    return
  }

  logger.info('Ignoring non-table Stripe checkout session in shared webhook', {
    metadata: {
      checkoutSessionId,
      paymentKind,
    }
  })
}

async function handleApprovedChargePaymentIntentEvent(
  supabase: ReturnType<typeof createAdminClient>,
  paymentIntent: any,
  eventType: string
): Promise<void> {
  const paymentIntentId = typeof paymentIntent?.id === 'string' ? paymentIntent.id : null
  if (!paymentIntentId) {
    return
  }

  const metadata =
    typeof paymentIntent?.metadata === 'object' && paymentIntent.metadata !== null
      ? (paymentIntent.metadata as Record<string, string>)
      : {}

  if (metadata.payment_kind !== 'approved_charge') {
    return
  }

  const chargeRequestId = typeof metadata.charge_request_id === 'string'
    ? metadata.charge_request_id
    : null

  if (!chargeRequestId) {
    return
  }

  const amount = typeof paymentIntent?.amount === 'number'
    ? Number((paymentIntent.amount / 100).toFixed(2))
    : 0
  const currency = typeof paymentIntent?.currency === 'string'
    ? paymentIntent.currency.toUpperCase()
    : 'GBP'

  const mappedStatus = eventType === 'payment_intent.succeeded' ? 'succeeded' : 'failed'
  const paymentStatus = mappedStatus
  const errorMessage =
    eventType === 'payment_intent.payment_failed'
      ? typeof paymentIntent?.last_payment_error?.message === 'string'
        ? paymentIntent.last_payment_error.message
        : 'payment_failed'
      : null

  const { data: chargeRequest, error: chargeRequestError } = await supabase.from('charge_requests')
    .select('id, table_booking_id, metadata, charge_status')
    .eq('id', chargeRequestId)
    .maybeSingle()

  if (chargeRequestError) {
    throw chargeRequestError
  }

  if (!chargeRequest?.table_booking_id) {
    return
  }

  const existingChargeStatus = typeof chargeRequest?.charge_status === 'string' ? chargeRequest.charge_status as string : null
  const shouldSkipFailureDowngrade = mappedStatus === 'failed' && existingChargeStatus === 'succeeded'
  if (shouldSkipFailureDowngrade) {
    logger.warn('Ignoring Stripe payment failure webhook after approved charge already succeeded', {
      metadata: {
        chargeRequestId,
        paymentIntentId,
        eventType
      }
    })
    return
  }

  const { data: updatedChargeRequest, error: chargeRequestUpdateError } = await supabase.from('charge_requests')
    .update({
      charge_status: mappedStatus,
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(chargeRequest?.metadata || {}),
        payment_kind: 'approved_charge',
        payment_intent_event: eventType,
        payment_intent_error: errorMessage
      }
    })
    .eq('id', chargeRequestId)
    .select('id')
    .maybeSingle()

  if (chargeRequestUpdateError) {
    throw chargeRequestUpdateError
  }
  if (!updatedChargeRequest) {
    throw new Error(`Charge request missing during approved charge webhook update: ${chargeRequestId}`)
  }

  let paymentUpdateQuery = supabase.from('payments')
    .update({
      status: paymentStatus,
      metadata: {
        payment_kind: 'approved_charge',
        payment_intent_event: eventType,
        payment_intent_error: errorMessage
      }
    })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('table_booking_id', chargeRequest.table_booking_id)

  if (mappedStatus === 'failed') {
    paymentUpdateQuery = paymentUpdateQuery.in('status', ['pending', 'failed'])
  }

  const { data: updatedPayments, error: paymentUpdateError } = await paymentUpdateQuery.select('id')
  if (paymentUpdateError) {
    throw paymentUpdateError
  }
  if (!Array.isArray(updatedPayments) || updatedPayments.length === 0) {
    throw new Error(`Payment rows missing during approved charge webhook update: ${paymentIntentId}`)
  }

  const { data: booking, error: bookingLookupError } = await supabase.from('table_bookings')
    .select('customer_id')
    .eq('id', chargeRequest.table_booking_id)
    .maybeSingle()

  if (bookingLookupError) {
    throw bookingLookupError
  }

  if (booking?.customer_id) {
    try {
      await recordAnalyticsEvent(supabase, {
        customerId: booking.customer_id,
        tableBookingId: chargeRequest.table_booking_id,
        eventType: mappedStatus === 'succeeded' ? 'charge_succeeded' : 'charge_failed',
        metadata: {
          charge_request_id: chargeRequestId,
          stripe_payment_intent_id: paymentIntentId,
          amount,
          currency,
          source_event: eventType,
          reason: errorMessage
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed to record analytics for approved charge payment intent webhook', {
        metadata: {
          chargeRequestId,
          paymentIntentId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }
  }
}

async function handleChargeRefunded(
  supabase: ReturnType<typeof createAdminClient>,
  charge: any
): Promise<void> {
  const paymentIntentId = typeof charge?.payment_intent === 'string' ? charge.payment_intent : null
  if (!paymentIntentId) {
    return
  }

  const fullyRefunded = charge?.refunded === true
  const newStatus = fullyRefunded ? 'refunded' : 'partially_refunded'

  const { data: payments, error: lookupError } = await supabase.from('payments')
    .select('id, table_booking_id, customer_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .not('table_booking_id', 'is', null)

  if (lookupError) {
    throw lookupError
  }

  if (!Array.isArray(payments) || payments.length === 0) {
    return
  }

  const { error: updateError } = await supabase.from('payments')
    .update({ status: newStatus })
    .eq('stripe_payment_intent_id', paymentIntentId)

  if (updateError) {
    throw updateError
  }

  const payment = payments[0] as { table_booking_id?: string; customer_id?: string }
  const customerId = payment.customer_id

  if (customerId) {
    await recordAnalyticsEventSafe(supabase, {
      customerId,
      tableBookingId: payment.table_booking_id,
      eventType: fullyRefunded ? 'payment_refunded' : 'payment_partially_refunded',
      metadata: {
        stripe_payment_intent_id: paymentIntentId,
        refund_status: newStatus
      }
    }, 'handleChargeRefunded')
  }
}

async function handleCheckoutSessionFailure(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any,
  failureType: string
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const paymentKind = metadata.payment_kind || 'unknown'

  if (paymentKind === 'table_deposit') {
    const nowIso = new Date().toISOString()
    const { data: rows, error } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        metadata: {
          payment_kind: paymentKind,
          stripe_failure_type: failureType,
          updated_at: nowIso
        }
      })
      .eq('stripe_checkout_session_id', checkoutSessionId)
      .eq('charge_type', 'table_deposit')
      .eq('status', 'pending')
      .select('table_booking_id')

    if (error) {
      throw error
    }

    let tableBookingId = rows?.[0]?.table_booking_id as string | undefined

    if (!Array.isArray(rows) || rows.length === 0) {
      const { data: existingPayment, error: existingPaymentLookupError } = await supabase
        .from('payments')
        .select('id, status, table_booking_id')
        .eq('stripe_checkout_session_id', checkoutSessionId)
        .eq('charge_type', 'table_deposit')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingPaymentLookupError) {
        throw new Error(
          `Failed to verify existing table-deposit payment after checkout failure webhook: ${existingPaymentLookupError.message}`
        )
      }

      if (!existingPayment) {
        throw new Error(`Checkout failure webhook missing table-deposit payment row: ${checkoutSessionId}`)
      }

      const existingStatus =
        typeof existingPayment?.status === 'string' ? existingPayment.status as string : null

      if (
        existingStatus !== 'failed' &&
        existingStatus !== 'succeeded' &&
        existingStatus !== 'refunded' &&
        existingStatus !== 'partially_refunded'
      ) {
        throw new Error(
          `Checkout failure webhook table-deposit payment row was not transitioned to failed: ${checkoutSessionId}`
        )
      }

      tableBookingId =
        typeof existingPayment?.table_booking_id === 'string'
          ? existingPayment.table_booking_id as string
          : undefined
    }

    if (!tableBookingId) {
      return
    }

    const { data: booking, error: bookingLookupError } = await supabase.from('table_bookings')
      .select('id, customer_id')
      .eq('id', tableBookingId)
      .maybeSingle()

    if (bookingLookupError) {
      logger.warn('Checkout failure webhook could not load table booking for analytics', {
        metadata: {
          tableBookingId,
          checkoutSessionId,
          error: bookingLookupError.message,
        }
      })
      return
    }

    if (booking?.customer_id) {
      await recordAnalyticsEventSafe(supabase, {
        customerId: booking.customer_id,
        tableBookingId,
        eventType: 'payment_failed',
        metadata: {
          payment_kind: paymentKind,
          stripe_checkout_session_id: checkoutSessionId,
          failure_type: failureType,
        }
      }, 'table_deposit_checkout_failure')
    }

    return
  }

  logger.info('Ignoring non-table Stripe checkout failure in shared webhook', {
    metadata: {
      checkoutSessionId,
      paymentKind,
      failureType,
    }
  })
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 500 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!verifyStripeWebhookSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: StripeWebhookEvent
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const eventId = typeof event.id === 'string' ? event.id.trim() : ''
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const headers = Object.fromEntries(request.headers.entries())
  const requestHash = computeIdempotencyRequestHash(event)
  const idempotencyKey = `webhook:stripe:${eventId}`

  const idempotency = await claimIdempotencyKey(
    supabase,
    idempotencyKey,
    requestHash,
    24 * 30
  )

  if (idempotency.state === 'conflict') {
    await logStripeWebhook(supabase, {
      status: 'idempotency_conflict',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type,
      errorMessage: 'Event id reused with a different payload'
    })
    return NextResponse.json({ error: 'Conflict' }, { status: 409 })
  }

  if (idempotency.state === 'in_progress') {
    await logStripeWebhook(supabase, {
      status: 'in_progress',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type
    })
    return NextResponse.json(
      { error: 'Event is currently being processed' },
      { status: 409 }
    )
  }

  if (idempotency.state === 'replay') {
    await logStripeWebhook(supabase, {
      status: 'duplicate',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type
    })
    return NextResponse.json({ received: true, duplicate: true })
  }

  await logStripeWebhook(supabase, {
    status: 'received',
    headers,
    body: rawBody,
    eventId: event.id,
    eventType: event.type
  })

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(supabase, event.data?.object)
    } else if (event.type === 'checkout.session.expired') {
      await handleCheckoutSessionFailure(supabase, event.data?.object, 'checkout_session_expired')
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await handleCheckoutSessionFailure(supabase, event.data?.object, 'checkout_session_async_failed')
    } else if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      await handleApprovedChargePaymentIntentEvent(supabase, event.data?.object, event.type)
    } else if (event.type === 'charge.refunded') {
      await handleChargeRefunded(supabase, event.data?.object)
    }

    try {
      await persistIdempotencyResponse(
        supabase,
        idempotencyKey,
        requestHash,
        {
          state: 'processed',
          event_id: event.id,
          event_type: event.type,
          processed_at: new Date().toISOString()
        },
        24 * 30
      )
    } catch (persistError) {
      // Returning 500 causes Stripe to retry, which can trigger duplicate sends/mutations when
      // the main handler has already committed but idempotency persistence failed.
      logger.error('Stripe webhook processed but failed to persist idempotency response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: {
          eventId: event.id,
          eventType: event.type
        }
      })

      await logStripeWebhook(supabase, {
        status: 'idempotency_persist_failed',
        headers,
        body: rawBody,
        eventId: event.id,
        eventType: event.type,
        errorMessage: persistError instanceof Error ? persistError.message : String(persistError)
      })

      return NextResponse.json({ received: true, idempotency_persist_failed: true })
    }

    await logStripeWebhook(supabase, {
      status: 'success',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('Failed to process Stripe webhook event', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        eventId: event.id,
        eventType: event.type
      }
    })

    try {
      await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
    } catch (releaseError) {
      logger.error('Failed to release Stripe webhook idempotency claim', {
        error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
        metadata: { eventId: event.id }
      })
    }

    await logStripeWebhook(supabase, {
      status: 'error',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type,
      errorMessage: error instanceof Error ? error.message : String(error)
    })

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
