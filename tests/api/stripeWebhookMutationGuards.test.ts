import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/payments/stripe', () => ({
  createStripeRefund: vi.fn(),
  retrieveStripeSetupIntent: vi.fn(),
  verifyStripeWebhookSignature: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/events/event-payments', () => ({
  sendEventBookingSeatUpdateSms: vi.fn(),
  sendEventPaymentConfirmationSms: vi.fn(),
  sendEventPaymentRetrySms: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { retrieveStripeSetupIntent, verifyStripeWebhookSignature } from '@/lib/payments/stripe'
import { sendEventBookingSeatUpdateSms, sendEventPaymentConfirmationSms, sendEventPaymentRetrySms } from '@/lib/events/event-payments'
import { sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { POST } from '@/app/api/stripe/webhook/route'

describe('stripe webhook mutation guards', () => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  })

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret
    }
  })

  it('fails closed when approved-charge status update affects no charge-request rows', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    const chargeRequestLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'charge-request-1',
        table_booking_id: 'table-booking-1',
        metadata: {},
        charge_status: 'pending',
      },
      error: null,
    })
    const chargeRequestLookupEq = vi.fn().mockReturnValue({ maybeSingle: chargeRequestLookupMaybeSingle })
    const chargeRequestLookupSelect = vi.fn().mockReturnValue({ eq: chargeRequestLookupEq })

    const chargeRequestUpdateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const chargeRequestUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: chargeRequestUpdateMaybeSingle })
    const chargeRequestUpdateEq = vi.fn().mockReturnValue({ select: chargeRequestUpdateSelect })
    const chargeRequestUpdate = vi.fn().mockReturnValue({ eq: chargeRequestUpdateEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'charge_requests') {
          return {
            select: chargeRequestLookupSelect,
            update: chargeRequestUpdate,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'evt_approved_charge_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_approved_1',
          amount: 1250,
          currency: 'gbp',
          metadata: {
            payment_kind: 'approved_charge',
            charge_request_id: 'charge-request-1',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
  })

  it('fails closed when blocked seat-increase payment update affects no rows and no terminal payment exists', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-seat-increase')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    const paymentUpdateSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const paymentUpdateEqStatus = vi.fn().mockReturnValue({ select: paymentUpdateSelect })
    const paymentUpdateEqCheckout = vi.fn().mockReturnValue({ eq: paymentUpdateEqStatus })
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEqCheckout })

    const paymentLookupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const paymentLookupLimit = vi.fn().mockReturnValue({ maybeSingle: paymentLookupMaybeSingle })
    const paymentLookupOrder = vi.fn().mockReturnValue({ limit: paymentLookupLimit })
    const paymentLookupEq = vi.fn().mockReturnValue({ order: paymentLookupOrder })
    const paymentSelect = vi.fn().mockReturnValue({ eq: paymentLookupEq })

    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'blocked',
        booking_id: 'event-booking-2',
        reason: 'capacity_blocked',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'payments') {
          return {
            update: paymentUpdate,
            select: paymentSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_seat_increase_blocked_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_seat_increase_1',
          payment_intent: 'pi_seat_increase_1',
          amount_total: 3000,
          currency: 'gbp',
          metadata: {
            payment_kind: 'seat_increase',
            event_booking_id: 'event-booking-2',
            target_seats: '8',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(paymentUpdate).toHaveBeenCalledTimes(1)
    expect(paymentUpdateSelect).toHaveBeenCalledTimes(1)
    expect(paymentLookupMaybeSingle).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
  })

  it('fails closed when checkout-failure payment update affects no rows and no payment row exists', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-checkout-failure-missing-payment')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    const paymentUpdateSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const paymentUpdateEqStatus = vi.fn().mockReturnValue({ select: paymentUpdateSelect })
    const paymentUpdateEqCheckout = vi.fn().mockReturnValue({ eq: paymentUpdateEqStatus })
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEqCheckout })

    const paymentLookupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const paymentLookupLimit = vi.fn().mockReturnValue({ maybeSingle: paymentLookupMaybeSingle })
    const paymentLookupOrder = vi.fn().mockReturnValue({ limit: paymentLookupLimit })
    const paymentLookupEq = vi.fn().mockReturnValue({ order: paymentLookupOrder })
    const paymentSelect = vi.fn().mockReturnValue({ eq: paymentLookupEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'payments') {
          return {
            update: paymentUpdate,
            select: paymentSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'evt_checkout_failure_missing_payment_1',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_checkout_failure_missing_payment_1',
          metadata: {
            payment_kind: 'prepaid_event',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(paymentUpdate).toHaveBeenCalledTimes(1)
    expect(paymentUpdateSelect).toHaveBeenCalledTimes(1)
    expect(paymentLookupMaybeSingle).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
  })

  it('returns 200 and skips retry SMS when checkout-failure update no-ops but payment is already terminal', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-checkout-failure-terminal-payment')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendEventPaymentRetrySms as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    const paymentUpdateSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const paymentUpdateEqStatus = vi.fn().mockReturnValue({ select: paymentUpdateSelect })
    const paymentUpdateEqCheckout = vi.fn().mockReturnValue({ eq: paymentUpdateEqStatus })
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEqCheckout })

    const paymentLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'payment-terminal-1', status: 'succeeded' },
      error: null,
    })
    const paymentLookupLimit = vi.fn().mockReturnValue({ maybeSingle: paymentLookupMaybeSingle })
    const paymentLookupOrder = vi.fn().mockReturnValue({ limit: paymentLookupLimit })
    const paymentLookupEq = vi.fn().mockReturnValue({ order: paymentLookupOrder })
    const paymentSelect = vi.fn().mockReturnValue({ eq: paymentLookupEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'payments') {
          return {
            update: paymentUpdate,
            select: paymentSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'evt_checkout_failure_terminal_payment_1',
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          id: 'cs_checkout_failure_terminal_payment_1',
          metadata: {
            payment_kind: 'prepaid_event',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(paymentUpdate).toHaveBeenCalledTimes(1)
    expect(paymentUpdateSelect).toHaveBeenCalledTimes(1)
    expect(paymentLookupMaybeSingle).toHaveBeenCalledTimes(1)
    expect(sendEventPaymentRetrySms).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs checkout-failure retry SMS logging failures without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-checkout-retry-logging-failure')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendEventPaymentRetrySms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      code: 'logging_failed',
      logFailure: true,
      error: 'messages insert failed',
    })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    const paymentUpdateSelect = vi.fn().mockResolvedValue({
      data: [{ event_booking_id: 'event-booking-retry-1' }],
      error: null,
    })
    const paymentUpdateEqStatus = vi.fn().mockReturnValue({ select: paymentUpdateSelect })
    const paymentUpdateEqCheckout = vi.fn().mockReturnValue({ eq: paymentUpdateEqStatus })
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEqCheckout })

    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'event-booking-retry-1', customer_id: 'customer-retry-1' },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'payments') {
          return {
            update: paymentUpdate,
          }
        }

        if (table === 'bookings') {
          return {
            select: bookingSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'evt_checkout_retry_logging_failure_1',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_checkout_retry_logging_failure_1',
          metadata: {
            payment_kind: 'prepaid_event',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendEventPaymentRetrySms).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Stripe webhook event payment retry SMS reported logging failure',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'event-booking-retry-1',
          checkoutSessionId: 'cs_checkout_retry_logging_failure_1',
          context: 'checkout_failure',
          code: 'logging_failed',
          logFailure: true,
          error: 'messages insert failed',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('returns 200 and keeps idempotency claim when idempotency persistence fails after processing', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-2')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockRejectedValue(new Error('db down'))

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'evt_noop_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_noop_1',
          amount: 1000,
          currency: 'gbp',
          metadata: {},
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true, idempotency_persist_failed: true })
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('returns 200 when blocked checkout retry SMS throws (prevents retry-driven duplicates)', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-3')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendEventPaymentRetrySms as unknown as vi.Mock).mockRejectedValue(new Error('sms send failed'))

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'blocked',
        booking_id: 'event-booking-1',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          payment_intent: 'pi_test_1',
          amount_total: 1000,
          currency: 'gbp',
          metadata: {
            payment_kind: 'prepaid_event',
            event_booking_id: 'event-booking-1',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendEventPaymentRetrySms).toHaveBeenCalledTimes(1)
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs blocked-checkout retry SMS non-success outcomes without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-blocked-retry-non-success')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendEventPaymentRetrySms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      code: 'provider_unavailable',
      logFailure: false,
      error: 'provider timeout',
    })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'blocked',
        booking_id: 'event-booking-blocked-2',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_checkout_blocked_retry_non_success_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_checkout_blocked_retry_non_success_1',
          payment_intent: 'pi_checkout_blocked_retry_non_success_1',
          amount_total: 1000,
          currency: 'gbp',
          metadata: {
            payment_kind: 'prepaid_event',
            event_booking_id: 'event-booking-blocked-2',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendEventPaymentRetrySms).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Stripe webhook event payment retry SMS send returned non-success',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'event-booking-blocked-2',
          checkoutSessionId: 'cs_checkout_blocked_retry_non_success_1',
          context: 'blocked_checkout',
          code: 'provider_unavailable',
          logFailure: false,
          error: 'provider timeout',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs customer stripe_customer_id update error on table card capture confirmation without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-4')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(retrieveStripeSetupIntent as unknown as vi.Mock).mockResolvedValue({
      payment_method: 'pm_test_1',
      customer: 'cus_test_1',
    })
    ;(sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const customersUpdateSelect = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
    const customersUpdateIs = vi.fn().mockReturnValue({ select: customersUpdateSelect })
    const customersUpdateEq = vi.fn().mockReturnValue({ is: customersUpdateIs })
    const customersUpdate = vi.fn().mockReturnValue({ eq: customersUpdateEq })

    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'confirmed',
        table_booking_id: 'table-booking-1',
        customer_id: 'customer-1',
        booking_reference: 'REF-1',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'customers') {
          return {
            update: customersUpdate,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_table_card_capture_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_table_card_capture_1',
          setup_intent: 'seti_test_1',
          metadata: {
            payment_kind: 'table_card_capture',
            table_booking_id: 'table-booking-1',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(customersUpdate).toHaveBeenCalledTimes(1)
    expect(customersUpdateIs).toHaveBeenCalledTimes(1)
    expect(customersUpdateSelect).toHaveBeenCalledWith('id')
    expect(logger.error).toHaveBeenCalledWith(
      'Table card capture failed to update customer with stripe_customer_id',
      expect.objectContaining({
        metadata: expect.objectContaining({
          customerId: 'customer-1',
          tableBookingId: 'table-booking-1',
          checkoutSessionId: 'cs_table_card_capture_1',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs zero-row customer stripe_customer_id updates that remain unset on table card capture confirmation without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-10')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(retrieveStripeSetupIntent as unknown as vi.Mock).mockResolvedValue({
      payment_method: 'pm_test_4',
      customer: 'cus_test_4',
    })
    ;(sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const customersUpdateSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const customersUpdateIs = vi.fn().mockReturnValue({ select: customersUpdateSelect })
    const customersUpdateEq = vi.fn().mockReturnValue({ is: customersUpdateIs })
    const customersUpdate = vi.fn().mockReturnValue({ eq: customersUpdateEq })

    const customersLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'customer-4', stripe_customer_id: null },
      error: null,
    })
    const customersLookupEq = vi.fn().mockReturnValue({ maybeSingle: customersLookupMaybeSingle })
    const customersSelect = vi.fn().mockReturnValue({ eq: customersLookupEq })

    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'confirmed',
        table_booking_id: 'table-booking-4',
        customer_id: 'customer-4',
        booking_reference: 'REF-4',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'customers') {
          return {
            update: customersUpdate,
            select: customersSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_table_card_capture_4',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_table_card_capture_4',
          setup_intent: 'seti_test_4',
          metadata: {
            payment_kind: 'table_card_capture',
            table_booking_id: 'table-booking-4',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(customersUpdateSelect).toHaveBeenCalledWith('id')
    expect(customersSelect).toHaveBeenCalledWith('id, stripe_customer_id')
    expect(logger.error).toHaveBeenCalledWith(
      'Table card capture zero-row stripe_customer_id update left customer unset',
      expect.objectContaining({
        metadata: expect.objectContaining({
          customerId: 'customer-4',
          tableBookingId: 'table-booking-4',
          checkoutSessionId: 'cs_table_card_capture_4',
          stripeCustomerId: 'cus_test_4',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs fulfilled non-success table card capture SMS outcomes without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-8')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({
      success: false,
      code: 'provider_unavailable',
      logFailure: false,
      error: 'provider timeout',
    })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'confirmed',
        table_booking_id: 'table-booking-2',
        customer_id: 'customer-2',
        booking_reference: 'REF-2',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_table_card_capture_2',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_table_card_capture_2',
          metadata: {
            payment_kind: 'table_card_capture',
            table_booking_id: 'table-booking-2',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Table card capture confirmation SMS send returned non-success',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tableBookingId: 'table-booking-2',
          checkoutSessionId: 'cs_table_card_capture_2',
          code: 'provider_unavailable',
          logFailure: false,
          error: 'provider timeout',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs table card capture SMS logging failures without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-9')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({
      success: false,
      code: 'logging_failed',
      logFailure: true,
      error: 'messages insert failed',
    })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'confirmed',
        table_booking_id: 'table-booking-3',
        customer_id: 'customer-3',
        booking_reference: 'REF-3',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_table_card_capture_3',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_table_card_capture_3',
          metadata: {
            payment_kind: 'table_card_capture',
            table_booking_id: 'table-booking-3',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Table card capture confirmation SMS reported logging failure',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tableBookingId: 'table-booking-3',
          checkoutSessionId: 'cs_table_card_capture_3',
          code: 'logging_failed',
          logFailure: true,
          error: 'messages insert failed',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs prepaid event payment confirmation SMS rejection without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-5')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendEventPaymentConfirmationSms as unknown as vi.Mock).mockRejectedValue(new Error('sms send failed'))

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'confirmed',
        booking_id: 'event-booking-1',
        customer_id: 'customer-1',
        event_name: 'Test Event',
        seats: 2,
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_prepaid_event_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_prepaid_event_1',
          payment_intent: 'pi_test_1',
          amount_total: 1000,
          currency: 'gbp',
          metadata: {
            payment_kind: 'prepaid_event',
            event_booking_id: 'event-booking-1',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendEventPaymentConfirmationSms).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Prepaid event payment confirmation SMS task rejected unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'event-booking-1',
          checkoutSessionId: 'cs_prepaid_event_1',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs fulfilled non-success prepaid confirmation SMS outcomes without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-6')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendEventPaymentConfirmationSms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      code: 'provider_unavailable',
      logFailure: false,
      error: 'provider timeout',
    })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'confirmed',
        booking_id: 'event-booking-2',
        customer_id: 'customer-2',
        event_name: 'Test Event 2',
        seats: 3,
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_prepaid_event_2',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_prepaid_event_2',
          payment_intent: 'pi_test_2',
          amount_total: 2500,
          currency: 'gbp',
          metadata: {
            payment_kind: 'prepaid_event',
            event_booking_id: 'event-booking-2',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendEventPaymentConfirmationSms).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Prepaid event payment confirmation SMS send returned non-success',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'event-booking-2',
          checkoutSessionId: 'cs_prepaid_event_2',
          code: 'provider_unavailable',
          logFailure: false,
          error: 'provider timeout',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('logs fulfilled non-success seat-increase SMS outcomes without failing the webhook', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-7')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendEventBookingSeatUpdateSms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      code: 'provider_unavailable',
      logFailure: false,
      error: 'provider timeout',
    })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'updated',
        booking_id: 'event-booking-seat-1',
        customer_id: 'customer-seat-1',
        event_name: 'Seat Event',
        old_seats: 2,
        new_seats: 4,
        delta: 2,
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_seat_increase_updated_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_seat_increase_updated_1',
          payment_intent: 'pi_seat_increase_updated_1',
          amount_total: 5000,
          currency: 'gbp',
          metadata: {
            payment_kind: 'seat_increase',
            event_booking_id: 'event-booking-seat-1',
            target_seats: '4',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(sendEventBookingSeatUpdateSms).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Seat increase seat-update SMS send returned non-success',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'event-booking-seat-1',
          checkoutSessionId: 'cs_seat_increase_updated_1',
          code: 'provider_unavailable',
          logFailure: false,
          error: 'provider timeout',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })
})
