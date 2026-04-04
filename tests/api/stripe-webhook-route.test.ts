import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must appear before any imports of the mocked modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
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
  sendTableBookingConfirmedAfterDepositSmsIfAllowed: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { verifyStripeWebhookSignature } from '@/lib/payments/stripe'
import { POST } from '@/app/api/stripe/webhook/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/stripe/webhook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  }) as unknown as Request
}

function buildStripeEvent(
  type: string,
  dataObject: Record<string, unknown> = {},
  id = 'evt_test_123'
): string {
  return JSON.stringify({
    id,
    type,
    data: { object: dataObject },
  })
}

/** Minimal admin client stub that accepts webhook_logs inserts and is otherwise inert. */
function stubAdminClient() {
  const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        // Provide a safe fallback chain for any unexpected table access
        const noop = { data: null, error: null }
        const chain: Record<string, unknown> = {}
        const proxy = (): typeof chain => chain
        chain.select = proxy
        chain.insert = vi.fn().mockResolvedValue(noop)
        chain.update = proxy
        chain.eq = proxy
        chain.in = proxy
        chain.order = proxy
        chain.limit = proxy
        chain.maybeSingle = vi.fn().mockResolvedValue(noop)
        chain.single = vi.fn().mockResolvedValue(noop)
        return chain
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
    webhookLogInsert,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stripe webhook route', () => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
  })

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret
    }
  })

  // -----------------------------------------------------------------------
  // Signature verification
  // -----------------------------------------------------------------------

  describe('signature verification', () => {
    it('should return 401 when signature is invalid', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(false)

      const body = buildStripeEvent('checkout.session.completed')
      const req = makeRequest(body, { 'stripe-signature': 'bad_sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Invalid signature')
    })

    it('should return 401 when stripe-signature header is missing', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(false)

      const body = buildStripeEvent('checkout.session.completed')
      const req = makeRequest(body)
      const res = await POST(req as any)

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Invalid signature')
    })

    it('should proceed when signature is valid', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

      const body = buildStripeEvent('unknown.event.type', {}, 'evt_valid')
      const req = makeRequest(body, { 'stripe-signature': 'valid_sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Missing STRIPE_WEBHOOK_SECRET
  // -----------------------------------------------------------------------

  describe('missing webhook secret', () => {
    it('should return 500 when STRIPE_WEBHOOK_SECRET is not set', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET

      const body = buildStripeEvent('checkout.session.completed')
      const req = makeRequest(body, { 'stripe-signature': 'sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(500)
      const json = await res.json()
      expect(json.error).toBe('STRIPE_WEBHOOK_SECRET not configured')
    })
  })

  // -----------------------------------------------------------------------
  // Malformed payload
  // -----------------------------------------------------------------------

  describe('malformed payload', () => {
    it('should return 400 for non-JSON body', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)

      const req = makeRequest('this is not json', { 'stripe-signature': 'sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Invalid payload')
    })

    it('should return 400 when event id is missing', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)

      const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
      const req = makeRequest(body, { 'stripe-signature': 'sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Missing event id')
    })
  })

  // -----------------------------------------------------------------------
  // Event handling — checkout.session.completed
  // -----------------------------------------------------------------------

  describe('checkout.session.completed', () => {
    it('should call confirm_event_payment_v05 RPC for prepaid event', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-cs')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)

      const rpcMock = vi.fn().mockResolvedValue({
        data: { state: 'confirmed', booking_id: 'b1', customer_id: 'c1', event_name: 'Quiz Night', seats: 4 },
        error: null,
      })
      const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'webhook_logs') return { insert: webhookLogInsert }
          const noop = { data: null, error: null }
          const chain: Record<string, unknown> = {}
          const proxy = (): typeof chain => chain
          chain.select = proxy; chain.insert = vi.fn().mockResolvedValue(noop)
          chain.update = proxy; chain.eq = proxy; chain.maybeSingle = vi.fn().mockResolvedValue(noop)
          return chain
        }),
        rpc: rpcMock,
      })

      const sessionObject = {
        id: 'cs_test_1',
        payment_intent: 'pi_test_1',
        amount_total: 2000,
        currency: 'gbp',
        metadata: { event_booking_id: 'b1' },
      }
      const body = buildStripeEvent('checkout.session.completed', sessionObject, 'evt_cs_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      expect(rpcMock).toHaveBeenCalledWith('confirm_event_payment_v05', expect.objectContaining({
        p_event_booking_id: 'b1',
        p_checkout_session_id: 'cs_test_1',
      }))
    })
  })

  // -----------------------------------------------------------------------
  // Event handling — payment_intent.succeeded
  // -----------------------------------------------------------------------

  describe('payment_intent.succeeded', () => {
    it('should process approved charge payment intent', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-pi')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)

      const chargeRequestLookup = vi.fn().mockResolvedValue({
        data: {
          id: 'cr-1',
          table_booking_id: 'tb-1',
          metadata: {},
          charge_status: 'pending',
        },
        error: null,
      })
      const chargeRequestUpdateMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'cr-1' },
        error: null,
      })
      const paymentUpdateSelect = vi.fn().mockResolvedValue({
        data: [{ id: 'pay-1' }],
        error: null,
      })
      const bookingLookup = vi.fn().mockResolvedValue({
        data: { customer_id: 'cust-1' },
        error: null,
      })

      const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'webhook_logs') return { insert: webhookLogInsert }
          if (table === 'charge_requests') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({ maybeSingle: chargeRequestLookup }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({ maybeSingle: chargeRequestUpdateMaybeSingle }),
                }),
              }),
            }
          }
          if (table === 'payments') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({ select: paymentUpdateSelect }),
                }),
              }),
            }
          }
          if (table === 'table_bookings') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({ maybeSingle: bookingLookup }),
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      const piObject = {
        id: 'pi_test_charge',
        amount: 5000,
        currency: 'gbp',
        metadata: { payment_kind: 'approved_charge', charge_request_id: 'cr-1' },
      }
      const body = buildStripeEvent('payment_intent.succeeded', piObject, 'evt_pi_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Unknown event type — should be handled gracefully
  // -----------------------------------------------------------------------

  describe('unknown event type', () => {
    it('should return 200 and acknowledge unknown events without error', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-unk')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

      const body = buildStripeEvent('customer.subscription.created', { id: 'sub_1' }, 'evt_unk_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(true)
      // Should NOT have called any RPC for unrecognised event types
      expect(client.rpc).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Idempotency — duplicate event replay
  // -----------------------------------------------------------------------

  describe('idempotency', () => {
    it('should return duplicate response on replay state', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-dup')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'replay' })

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

      const body = buildStripeEvent('checkout.session.completed', {}, 'evt_dup_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.duplicate).toBe(true)
    })

    it('should return 409 on idempotency conflict', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-conf')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'conflict' })

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

      const body = buildStripeEvent('checkout.session.completed', {}, 'evt_conf_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(409)
    })

    it('should return 409 when event is in-progress', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-ip')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'in_progress' })

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

      const body = buildStripeEvent('checkout.session.completed', {}, 'evt_ip_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(409)
    })
  })

  // -----------------------------------------------------------------------
  // Processing error — handler throws, claim is released
  // -----------------------------------------------------------------------

  describe('handler error', () => {
    it('should return 500 and release idempotency claim on processing error', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-err')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
      ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)

      const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
      const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'webhook_logs') return { insert: webhookLogInsert }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
        rpc: rpcMock,
      })

      const sessionObject = {
        id: 'cs_err_1',
        metadata: { event_booking_id: 'b-err' },
      }
      const body = buildStripeEvent('checkout.session.completed', sessionObject, 'evt_err_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(500)
      expect(releaseIdempotencyClaim).toHaveBeenCalledWith(
        expect.anything(),
        'webhook:stripe:evt_err_1',
        'hash-err'
      )
    })
  })

  // -----------------------------------------------------------------------
  // charge.refunded event
  // -----------------------------------------------------------------------

  describe('charge.refunded', () => {
    it('should update payment status to refunded for fully refunded charge', async () => {
      ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-ref')
      ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)

      const paymentLookupResult = vi.fn().mockResolvedValue({
        data: [{ id: 'pay-1', table_booking_id: 'tb-1', customer_id: 'cust-1' }],
        error: null,
      })
      const paymentUpdateResult = vi.fn().mockResolvedValue({ error: null })
      const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'webhook_logs') return { insert: webhookLogInsert }
          if (table === 'payments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: paymentLookupResult,
              }),
              update: vi.fn().mockReturnValue({
                eq: paymentUpdateResult,
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      const chargeObject = {
        payment_intent: 'pi_refund_1',
        refunded: true,
      }
      const body = buildStripeEvent('charge.refunded', chargeObject, 'evt_ref_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(true)
    })
  })
})
