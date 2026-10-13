import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

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
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/stripe/webhook/route'
import { schemaCheckedTable } from '../helpers/schemaCheckedTable'

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
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(false)

      const body = buildStripeEvent('checkout.session.completed')
      const req = makeRequest(body, { 'stripe-signature': 'bad_sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Invalid signature')
    })

    it('should return 401 when stripe-signature header is missing', async () => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(false)

      const body = buildStripeEvent('checkout.session.completed')
      const req = makeRequest(body)
      const res = await POST(req as any)

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Invalid signature')
    })

    it('should proceed when signature is valid', async () => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-1')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as Mock).mockReturnValue(client)

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
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)

      const req = makeRequest('this is not json', { 'stripe-signature': 'sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Invalid payload')
    })

    it('should return 400 when event id is missing', async () => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)

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
    it('should call confirm_table_payment_v05 RPC for table deposits', async () => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-cs')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)

      const rpcMock = vi.fn().mockResolvedValue({
        data: { state: 'confirmed', booking_id: 'b1', customer_id: 'c1', event_name: 'Quiz Night', seats: 4 },
        error: null,
      })
      const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

      ;(createAdminClient as unknown as Mock).mockReturnValue({
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
        metadata: { payment_kind: 'table_deposit', table_booking_id: 'tb1' },
      }
      const body = buildStripeEvent('checkout.session.completed', sessionObject, 'evt_cs_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      expect(rpcMock).toHaveBeenCalledWith('confirm_table_payment_v05', expect.objectContaining({
        p_table_booking_id: 'tb1',
        p_checkout_session_id: 'cs_test_1',
      }))
    })
  })

  // -----------------------------------------------------------------------
  // Event handling — payment_intent.succeeded
  // -----------------------------------------------------------------------

  describe('payment_intent.succeeded', () => {
    it('should process approved charge payment intent', async () => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-pi')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)

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

      ;(createAdminClient as unknown as Mock).mockReturnValue({
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
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-unk')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as Mock).mockReturnValue(client)

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
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-dup')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'replay' })

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as Mock).mockReturnValue(client)

      const body = buildStripeEvent('checkout.session.completed', {}, 'evt_dup_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.duplicate).toBe(true)
    })

    it('should return 409 on idempotency conflict', async () => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-conf')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'conflict' })

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as Mock).mockReturnValue(client)

      const body = buildStripeEvent('checkout.session.completed', {}, 'evt_conf_1')
      const req = makeRequest(body, { 'stripe-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(409)
    })

    it('should return 409 when event is in-progress', async () => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-ip')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'in_progress' })

      const { client } = stubAdminClient()
      ;(createAdminClient as unknown as Mock).mockReturnValue(client)

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
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-err')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
      ;(releaseIdempotencyClaim as unknown as Mock).mockResolvedValue(undefined)

      const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
      const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })

      ;(createAdminClient as unknown as Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'webhook_logs') return { insert: webhookLogInsert }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
        rpc: rpcMock,
      })

      const sessionObject = {
        id: 'cs_err_1',
        amount_total: 1000,
        currency: 'gbp',
        metadata: { payment_kind: 'table_deposit', table_booking_id: 'tb-err' },
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
    /**
     * `payments` has no customer_id: the customer is on the table booking. The handler selected it
     * from payments, so PostgREST answered 400 (42703), the handler threw, and every
     * charge.refunded was answered 500 with the payment left as it was. The test that stood here
     * handed back a payments row with a customer_id on it, so it passed.
     *
     * These tables refuse a column the real ones lack, and refuse a seed row that has one.
     */
    function refundTables() {
      const payments = schemaCheckedTable('payments', [
        { id: 'pay-1', table_booking_id: 'tb-1', stripe_payment_intent_id: 'pi_refund_1', status: 'succeeded' },
      ])
      const tableBookings = schemaCheckedTable('table_bookings', [{ id: 'tb-1', customer_id: 'cust-1' }])
      const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

      ;(createAdminClient as unknown as Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'webhook_logs') return { insert: webhookLogInsert }
          if (table === 'payments') return payments.query()
          if (table === 'table_bookings') return tableBookings.query()
          throw new Error(`Unexpected table: ${table}`)
        }),
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      return { payments, tableBookings, webhookLogInsert }
    }

    async function deliverRefund(charge: Record<string, unknown>): Promise<Response> {
      const body = buildStripeEvent('charge.refunded', charge, 'evt_ref_1')
      return POST(makeRequest(body, { 'stripe-signature': 'valid' }) as any)
    }

    beforeEach(() => {
      ;(verifyStripeWebhookSignature as unknown as Mock).mockReturnValue(true)
      ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-ref')
      ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
      ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)
    })

    it("marks the payment refunded and records the refund against the booking's customer", async () => {
      const { payments, tableBookings } = refundTables()

      const res = await deliverRefund({ payment_intent: 'pi_refund_1', refunded: true })

      expect([...payments.log, ...tableBookings.log].map((query) => query.error)).toEqual([null, null, null])
      expect(res.status).toBe(200)
      expect((await res.json()).received).toBe(true)
      expect(payments.rows[0].status).toBe('refunded')
      expect(recordAnalyticsEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ customerId: 'cust-1', tableBookingId: 'tb-1', eventType: 'payment_refunded' }),
      )
      expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    })

    it('marks a part refund partially_refunded', async () => {
      const { payments } = refundTables()

      const res = await deliverRefund({ payment_intent: 'pi_refund_1', refunded: false })

      expect(res.status).toBe(200)
      expect(payments.rows[0].status).toBe('partially_refunded')
      expect(recordAnalyticsEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ customerId: 'cust-1', eventType: 'payment_partially_refunded' }),
      )
    })

    // The analytics event is best effort. The payment status is the part that must be saved.
    it('still saves the refund when the booking cannot be read for the analytics event', async () => {
      const { payments } = refundTables()
      const client = (createAdminClient as unknown as Mock)()
      const from = client.from as Mock
      const original = from.getMockImplementation() as (table: string) => unknown
      from.mockImplementation((table: string) =>
        table === 'table_bookings'
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
          : original(table),
      )

      const res = await deliverRefund({ payment_intent: 'pi_refund_1', refunded: true })

      expect(res.status).toBe(200)
      expect(payments.rows[0].status).toBe('refunded')
      expect(recordAnalyticsEvent).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        'Refund webhook could not load table booking for analytics',
        expect.objectContaining({ metadata: expect.objectContaining({ tableBookingId: 'tb-1' }) }),
      )
    })
  })
})
