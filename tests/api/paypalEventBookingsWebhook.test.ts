import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/paypal', () => ({
  verifyPayPalWebhook: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/events/event-payments', () => ({
  sendEventPaymentConfirmationSms: vi.fn(),
  sendEventPaymentManualReviewSms: vi.fn(),
}))

vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentConfirmationEmail: vi.fn(),
  sendEventPaymentManualReviewEmail: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(() => 'hash-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEventPaymentManualReviewSms } from '@/lib/events/event-payments'
import { sendEventPaymentManualReviewEmail } from '@/lib/email/event-ticket-emails'
import {
  claimIdempotencyKey,
  persistIdempotencyResponse,
} from '@/lib/api/idempotency'
import { POST } from '@/app/api/webhooks/paypal/event-bookings/route'

describe('PayPal event-bookings webhook', () => {
  const originalWebhookId = process.env.PAYPAL_WEBHOOK_ID

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PAYPAL_WEBHOOK_ID = 'webhook_test'
    vi.mocked(verifyPayPalWebhook).mockResolvedValue(true)
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as any)
    vi.mocked(persistIdempotencyResponse).mockResolvedValue(undefined)
    vi.mocked(sendEventPaymentManualReviewSms).mockResolvedValue({ success: true, code: null, logFailure: false })
    vi.mocked(sendEventPaymentManualReviewEmail).mockResolvedValue({ success: true })
  })

  afterEach(() => {
    if (originalWebhookId === undefined) {
      delete process.env.PAYPAL_WEBHOOK_ID
    } else {
      process.env.PAYPAL_WEBHOOK_ID = originalWebhookId
    }
  })

  it('routes blocked capture confirmations to manual review instead of silently acking blocked', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: { state: 'blocked', reason: 'booking_not_pending_payment' },
      error: null,
    })

    vi.mocked(createAdminClient).mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'audit_logs') {
          return { insert: auditInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    } as any)

    const eventPayload = {
      id: 'WH-EVENT-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPTURE-1',
        custom_id: 'event_booking:booking-1',
        amount: { value: '12.50', currency_code: 'GBP' },
        supplementary_data: {
          related_ids: { order_id: 'ORDER-1' },
        },
      },
    }

    const response = await POST(new Request('http://localhost/api/webhooks/paypal/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(eventPayload),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload).toEqual({
      received: true,
      state: 'manual_review',
      original_state: 'blocked',
      reason: 'booking_not_pending_payment',
    })
    expect(sendEventPaymentManualReviewSms).toHaveBeenCalledWith(expect.anything(), { bookingId: 'booking-1' })
    expect(sendEventPaymentManualReviewEmail).toHaveBeenCalledWith(expect.anything(), {
      bookingId: 'booking-1',
      amount: 12.5,
      currency: 'GBP',
    })
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'event_payment.paypal_webhook_manual_review',
      resource_type: 'event_booking',
      resource_id: 'booking-1',
      operation_status: 'failure',
    }))
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      'webhook:paypal:event-bookings:WH-EVENT-1',
      'hash-1',
      expect.objectContaining({
        state: 'manual_review',
        original_state: 'blocked',
        reason: 'booking_not_pending_payment',
        booking_id: 'booking-1',
      }),
      24 * 30,
    )
  })
})
