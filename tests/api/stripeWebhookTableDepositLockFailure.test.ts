/**
 * Defects WF-003 / SEC-003: when confirm_table_payment_v05 succeeds but the
 * follow-up `deposit_amount_locked` UPDATE fails, the webhook MUST fail
 * (return 500) so Stripe retries. Without this guarantee, the booking is
 * left confirmed-but-unlocked and the canonical-amount invariant breaks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  sendTableBookingConfirmedAfterDepositSmsIfAllowed: vi.fn().mockResolvedValue({ success: true }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { verifyStripeWebhookSignature } from '@/lib/payments/stripe'
import { POST } from '@/app/api/stripe/webhook/route'

function makeRequest(body: string): Request {
  return new Request('https://example.com/api/stripe/webhook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 'valid',
    },
  }) as unknown as Request
}

function buildCheckoutSessionEvent(amountTotal: number) {
  return JSON.stringify({
    id: 'evt_lock_fail_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_lock_fail_1',
        amount_total: amountTotal,
        currency: 'gbp',
        metadata: {
          payment_kind: 'table_deposit',
          table_booking_id: 'tb-lock-fail-1',
        },
        payment_intent: 'pi_lock_fail_1',
      },
    },
  })
}

describe('stripe webhook — table_deposit deposit_amount_locked failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-lock')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 when the deposit_amount_locked UPDATE fails after a successful RPC confirmation', async () => {
    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const lockUpdateEq = vi.fn().mockResolvedValue({
      error: { message: 'deposit_amount_locked write blocked by RLS or column missing' },
    })
    const lockUpdate = vi.fn().mockReturnValue({ eq: lockUpdateEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') return { insert: webhookLogInsert }
        if (table === 'table_bookings') return { update: lockUpdate }
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }),
      // confirm_table_payment_v05 succeeds — booking is confirmed.
      rpc: vi.fn().mockResolvedValue({
        data: {
          state: 'confirmed',
          table_booking_id: 'tb-lock-fail-1',
          customer_id: 'cust-1',
          booking_reference: 'REF-LOCK',
          party_size: 12,
        },
        error: null,
      }),
    })

    const body = buildCheckoutSessionEvent(12000) // £120.00 in pence
    const res = await POST(makeRequest(body) as any)

    // Outer catch in POST returns 500 on any thrown error in the handler.
    // Stripe will retry the webhook; on retry the RPC's idempotent
    // pending_payment short-circuit re-runs and the lock write is retried.
    expect(res.status).toBe(500)
    // Crucially: lock write was attempted with the captured amount.
    expect(lockUpdate).toHaveBeenCalledWith({ deposit_amount_locked: 120 })
    expect(lockUpdateEq).toHaveBeenCalledWith('id', 'tb-lock-fail-1')
    // Idempotency claim is released so Stripe's retry isn't blocked.
    expect(releaseIdempotencyClaim).toHaveBeenCalled()
  })

  it('returns 200 when the lock write succeeds (happy path)', async () => {
    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const lockUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const lockUpdate = vi.fn().mockReturnValue({ eq: lockUpdateEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') return { insert: webhookLogInsert }
        if (table === 'table_bookings') return { update: lockUpdate }
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          state: 'confirmed',
          table_booking_id: 'tb-lock-ok-1',
          customer_id: 'cust-1',
          booking_reference: 'REF-OK',
          party_size: 12,
        },
        error: null,
      }),
    })

    const body = buildCheckoutSessionEvent(12000)
    const res = await POST(makeRequest(body) as any)

    expect(res.status).toBe(200)
    expect(lockUpdate).toHaveBeenCalledWith({ deposit_amount_locked: 120 })
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })
})
