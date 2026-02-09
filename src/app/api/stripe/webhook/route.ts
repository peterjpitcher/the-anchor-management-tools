import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  createStripeRefund,
  retrieveStripeSetupIntent,
  verifyStripeWebhookSignature
} from '@/lib/payments/stripe'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentRetrySms
} from '@/lib/events/event-payments'
import { sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed } from '@/lib/table-bookings/bookings'

export const runtime = 'nodejs'

type StripeWebhookEvent = {
  id: string
  type: string
  data?: {
    object?: any
  }
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
    await (supabase.from('webhook_logs') as any).insert({
      webhook_type: 'stripe',
      status: input.status,
      headers: input.headers,
      body: input.body.slice(0, 10000),
      params: {
        event_id: input.eventId ?? null,
        event_type: input.eventType ?? null
      },
      error_message: input.errorMessage ?? null
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

type CheckoutCompletedResult = {
  state: 'confirmed' | 'already_confirmed' | 'blocked'
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  seats?: number
}

type SeatIncreaseCompletedResult = {
  state: 'updated' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  old_seats?: number
  new_seats?: number
  delta?: number
}

type TableCardCaptureCompletedResult = {
  state: 'confirmed' | 'already_confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  booking_reference?: string
  status?: string
}

function mapRefundStatus(status: string | null): 'refunded' | 'pending' | 'failed' {
  switch (status) {
    case 'succeeded':
      return 'refunded'
    case 'pending':
    case 'requires_action':
      return 'pending'
    default:
      return 'failed'
  }
}

function getSessionMetadata(stripeSession: any): Record<string, string> {
  if (typeof stripeSession?.metadata === 'object' && stripeSession.metadata !== null) {
    return stripeSession.metadata as Record<string, string>
  }
  return {}
}

async function handleSeatIncreaseCheckoutCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const bookingId = typeof metadata.event_booking_id === 'string'
    ? metadata.event_booking_id
    : typeof stripeSession?.client_reference_id === 'string'
      ? stripeSession.client_reference_id
      : null
  const targetSeats = Number.parseInt(metadata.target_seats || '', 10)
  const paymentIntentId = typeof stripeSession?.payment_intent === 'string'
    ? stripeSession.payment_intent
    : ''
  const amount = typeof stripeSession?.amount_total === 'number'
    ? Number((stripeSession.amount_total / 100).toFixed(2))
    : 0
  const currency = typeof stripeSession?.currency === 'string'
    ? stripeSession.currency.toUpperCase()
    : 'GBP'

  if (!bookingId || !Number.isFinite(targetSeats) || targetSeats < 1) {
    return
  }

  const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('apply_event_seat_increase_payment_v05', {
    p_event_booking_id: bookingId,
    p_target_seats: targetSeats,
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId,
    p_amount: amount,
    p_currency: currency
  })

  if (rpcError) {
    throw rpcError
  }

  const rpcResult = (rpcResultRaw ?? {}) as SeatIncreaseCompletedResult

  if (rpcResult.state === 'updated' && rpcResult.booking_id && rpcResult.customer_id) {
    await recordAnalyticsEvent(supabase, {
      customerId: rpcResult.customer_id,
      eventBookingId: rpcResult.booking_id,
      eventType: 'payment_succeeded',
      metadata: {
        payment_kind: 'seat_increase',
        stripe_checkout_session_id: checkoutSessionId,
        stripe_payment_intent_id: paymentIntentId || null,
        amount,
        currency,
        old_seats: rpcResult.old_seats ?? null,
        new_seats: rpcResult.new_seats ?? null,
        delta: rpcResult.delta ?? null
      }
    })
    return
  }

  if (rpcResult.state === 'blocked') {
    await supabase
      .from('payments')
      .update({
        status: 'failed',
        metadata: {
          payment_kind: 'seat_increase',
          apply_reason: rpcResult.reason || 'blocked'
        }
      })
      .eq('stripe_checkout_session_id', checkoutSessionId)
      .eq('status', 'pending')

    if (paymentIntentId && amount > 0) {
      try {
        const refund = await createStripeRefund({
          paymentIntentId,
          amountMinor: Math.round(amount * 100),
          reason: 'requested_by_customer',
          idempotencyKey: `seat_increase_refund_${checkoutSessionId}`
        })

        const refundStatus = mapRefundStatus(refund.status)
        const paymentStatus = refundStatus === 'refunded' ? 'refunded' : refundStatus === 'pending' ? 'pending' : 'failed'

        await supabase.from('payments').insert({
          event_booking_id: bookingId,
          charge_type: 'refund',
          stripe_payment_intent_id: paymentIntentId,
          amount,
          currency,
          status: paymentStatus,
          metadata: {
            payment_kind: 'seat_increase',
            stripe_refund_id: refund.id,
            stripe_refund_status: refund.status,
            seat_increase_block_reason: rpcResult.reason || null,
            checkout_session_id: checkoutSessionId
          }
        })
      } catch (refundError) {
        logger.error('Failed to auto-refund blocked seat increase payment', {
          error: refundError instanceof Error ? refundError : new Error(String(refundError)),
          metadata: { bookingId, checkoutSessionId }
        })
      }
    }

    if (rpcResult.customer_id && rpcResult.booking_id) {
      await recordAnalyticsEvent(supabase, {
        customerId: rpcResult.customer_id,
        eventBookingId: rpcResult.booking_id,
        eventType: 'payment_failed',
        metadata: {
          payment_kind: 'seat_increase',
          reason: rpcResult.reason || 'blocked',
          stripe_checkout_session_id: checkoutSessionId
        }
      })
    }
  }
}

async function handleCheckoutSessionCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any,
  appBaseUrl: string
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const paymentKind = metadata.payment_kind || 'prepaid_event'

  if (paymentKind === 'table_card_capture') {
    const tableBookingId = typeof metadata.table_booking_id === 'string'
      ? metadata.table_booking_id
      : typeof stripeSession?.client_reference_id === 'string'
        ? stripeSession.client_reference_id
        : null

    if (!tableBookingId) {
      return
    }

    const setupIntentId = typeof stripeSession?.setup_intent === 'string'
      ? stripeSession.setup_intent
      : ''

    let paymentMethodId = ''
    let stripeCustomerId = ''
    if (setupIntentId) {
      try {
        const setupIntent = await retrieveStripeSetupIntent(setupIntentId)
        paymentMethodId = setupIntent.payment_method || ''
        stripeCustomerId = setupIntent.customer || ''
      } catch (error) {
        logger.warn('Failed to fetch setup intent details for table card capture', {
          metadata: {
            tableBookingId,
            setupIntentId,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('complete_table_card_capture_v05', {
      p_table_booking_id: tableBookingId,
      p_setup_intent_id: setupIntentId || null,
      p_payment_method_id: paymentMethodId || null
    })

    if (rpcError) {
      throw rpcError
    }

    const rpcResult = (rpcResultRaw ?? {}) as TableCardCaptureCompletedResult

    if (rpcResult.state === 'confirmed' && rpcResult.table_booking_id && rpcResult.customer_id) {
      await Promise.allSettled([
        stripeCustomerId
          ? supabase
              .from('customers')
              .update({
                stripe_customer_id: stripeCustomerId,
                updated_at: new Date().toISOString()
              })
              .eq('id', rpcResult.customer_id)
              .is('stripe_customer_id', null)
          : Promise.resolve(),
        recordAnalyticsEvent(supabase, {
          customerId: rpcResult.customer_id,
          tableBookingId: rpcResult.table_booking_id,
          eventType: 'card_capture_completed',
          metadata: {
            stripe_checkout_session_id: checkoutSessionId,
            stripe_setup_intent_id: setupIntentId || null,
            stripe_customer_id: stripeCustomerId || null,
            stripe_payment_method_id: paymentMethodId || null,
            booking_reference: rpcResult.booking_reference || null
          }
        }),
        sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed(supabase, rpcResult.table_booking_id)
      ])
      return
    }

    if (rpcResult.state === 'blocked' && rpcResult.table_booking_id) {
      const { data: booking } = await supabase
        .from('table_bookings')
        .select('customer_id')
        .eq('id', rpcResult.table_booking_id)
        .maybeSingle()

      if (booking?.customer_id) {
        await recordAnalyticsEvent(supabase, {
          customerId: booking.customer_id,
          tableBookingId: rpcResult.table_booking_id,
          eventType: 'card_capture_expired',
          metadata: {
            reason: rpcResult.reason || 'blocked',
            stripe_checkout_session_id: checkoutSessionId
          }
        })
      }
    }

    return
  }

  if (paymentKind === 'seat_increase') {
    await handleSeatIncreaseCheckoutCompleted(supabase, stripeSession)
    return
  }

  const bookingId = typeof metadata.event_booking_id === 'string'
    ? metadata.event_booking_id
    : typeof stripeSession?.client_reference_id === 'string'
      ? stripeSession.client_reference_id
      : null

  if (!bookingId) {
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

  const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('confirm_event_payment_v05', {
    p_event_booking_id: bookingId,
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId,
    p_amount: amount,
    p_currency: currency
  })

  if (rpcError) {
    throw rpcError
  }

  const rpcResult = (rpcResultRaw ?? {}) as CheckoutCompletedResult

  if (rpcResult.state === 'confirmed' && rpcResult.booking_id && rpcResult.customer_id) {
    await Promise.allSettled([
      recordAnalyticsEvent(supabase, {
        customerId: rpcResult.customer_id,
        eventBookingId: rpcResult.booking_id,
        eventType: 'payment_succeeded',
        metadata: {
          stripe_checkout_session_id: checkoutSessionId,
          stripe_payment_intent_id: paymentIntentId || null,
          amount: amount ?? null,
          currency
        }
      }),
      sendEventPaymentConfirmationSms(supabase, {
        bookingId: rpcResult.booking_id,
        eventName: rpcResult.event_name || 'your event',
        seats: Math.max(1, Number(rpcResult.seats ?? 1)),
        appBaseUrl
      })
    ])
  }

  if (rpcResult.state === 'blocked' && rpcResult.booking_id) {
    await sendEventPaymentRetrySms(supabase, {
      bookingId: rpcResult.booking_id,
      appBaseUrl
    })
  }
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

  const { data: chargeRequest } = await (supabase.from('charge_requests') as any)
    .select('id, table_booking_id, metadata')
    .eq('id', chargeRequestId)
    .maybeSingle()

  if (!chargeRequest?.table_booking_id) {
    return
  }

  await (supabase.from('charge_requests') as any)
    .update({
      charge_status: mappedStatus,
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
      metadata: {
        ...((chargeRequest as any)?.metadata || {}),
        payment_kind: 'approved_charge',
        payment_intent_event: eventType,
        payment_intent_error: errorMessage
      }
    })
    .eq('id', chargeRequestId)

  await (supabase.from('payments') as any)
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

  const { data: booking } = await (supabase.from('table_bookings') as any)
    .select('customer_id')
    .eq('id', chargeRequest.table_booking_id)
    .maybeSingle()

  if (booking?.customer_id) {
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
  }
}

async function handleCheckoutSessionFailure(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any,
  failureType: string,
  appBaseUrl: string
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const paymentKind = metadata.payment_kind || 'prepaid_event'

  if (paymentKind === 'table_card_capture') {
    return
  }

  const { data: rows, error } = await supabase
    .from('payments')
    .update({
      status: 'failed',
      metadata: {
        payment_kind: paymentKind,
        stripe_failure_type: failureType,
        updated_at: new Date().toISOString()
      }
    })
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .eq('status', 'pending')
    .select('event_booking_id')

  if (error) {
    throw error
  }

  const bookingId = rows?.[0]?.event_booking_id as string | undefined
  if (!bookingId) {
    return
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, customer_id')
    .eq('id', bookingId)
    .maybeSingle()

  if (booking?.customer_id) {
    await recordAnalyticsEvent(supabase, {
      customerId: booking.customer_id,
      eventBookingId: bookingId,
      eventType: 'payment_failed',
      metadata: {
        payment_kind: paymentKind,
        stripe_checkout_session_id: checkoutSessionId,
        failure_type: failureType
      }
    })
  }

  if (paymentKind !== 'seat_increase') {
    await sendEventPaymentRetrySms(supabase, {
      bookingId,
      appBaseUrl
    })
  }
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

  const supabase = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const headers = Object.fromEntries(request.headers.entries())

  await logStripeWebhook(supabase, {
    status: 'received',
    headers,
    body: rawBody,
    eventId: event.id,
    eventType: event.type
  })

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(supabase, event.data?.object, appBaseUrl)
    } else if (event.type === 'checkout.session.expired') {
      await handleCheckoutSessionFailure(supabase, event.data?.object, 'checkout_session_expired', appBaseUrl)
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await handleCheckoutSessionFailure(supabase, event.data?.object, 'checkout_session_async_failed', appBaseUrl)
    } else if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      await handleApprovedChargePaymentIntentEvent(supabase, event.data?.object, event.type)
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
