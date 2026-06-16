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
  verifyStripeWebhookSignature: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingConfirmedAfterDepositSmsIfAllowed: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { verifyStripeWebhookSignature } from '@/lib/payments/stripe'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { sendTableBookingConfirmedAfterDepositSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { POST } from '@/app/api/stripe/webhook/route'

function buildRequest(payload: unknown) {
  const request = new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 'sig_test',
    },
    body: JSON.stringify(payload),
  })
  return Object.assign(request, { nextUrl: new URL(request.url) })
}

describe('stripe webhook shared payment guards', () => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(recordAnalyticsEvent as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendTableBookingConfirmedAfterDepositSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({ success: true })
  })

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret
    }
  })

  it('confirms table-deposit checkout sessions and locks the captured amount', async () => {
    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const lockEq = vi.fn().mockResolvedValue({ error: null })
    const tableUpdate = vi.fn().mockReturnValue({ eq: lockEq })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'confirmed',
        table_booking_id: 'table-booking-1',
        customer_id: 'customer-1',
        booking_reference: 'TB-1',
        party_size: 4,
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') return { insert: webhookLogInsert }
        if (table === 'table_bookings') return { update: tableUpdate }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await POST(buildRequest({
      id: 'evt_table_deposit_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_table_1',
          client_reference_id: 'table-booking-1',
          payment_intent: 'pi_table_1',
          amount_total: 4000,
          currency: 'gbp',
          metadata: {
            payment_kind: 'table_deposit',
            table_booking_id: 'table-booking-1',
          },
        },
      },
    }) as any)

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('confirm_table_payment_v05', expect.objectContaining({
      p_table_booking_id: 'table-booking-1',
      p_checkout_session_id: 'cs_table_1',
      p_payment_intent_id: 'pi_table_1',
      p_amount: 40,
      p_currency: 'GBP',
    }))
    expect(tableUpdate).toHaveBeenCalledWith({ deposit_amount_locked: 40 })
    expect(sendTableBookingConfirmedAfterDepositSmsIfAllowed).toHaveBeenCalledWith(expect.anything(), 'table-booking-1')
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
  })

  it('ignores non-table checkout sessions without mutation', async () => {
    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn()

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') return { insert: webhookLogInsert }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await POST(buildRequest({
      id: 'evt_non_table_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_legacy_checkout_1',
          payment_intent: 'pi_legacy_checkout_1',
          metadata: {
            payment_kind: 'legacy_checkout',
          },
        },
      },
    }) as any)

    expect(response.status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'Ignoring non-table Stripe checkout session in shared webhook',
      expect.objectContaining({
        metadata: expect.objectContaining({
          checkoutSessionId: 'cs_legacy_checkout_1',
          paymentKind: 'legacy_checkout',
        }),
      })
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })
})
