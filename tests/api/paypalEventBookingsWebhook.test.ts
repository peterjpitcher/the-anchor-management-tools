import { beforeEach, describe, expect, it, vi } from 'vitest'

// The route goes through the shared gate. What the gate itself accepts is proved against the
// real helper in tests/lib/paypalWebhookVerification.test.ts.
vi.mock('@/lib/paypal-webhook-gate', async () => {
  const { paypalGateModuleMock } = await import('../helpers/paypalGateMock')
  return paypalGateModuleMock()
})

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

vi.mock('@/lib/events/payment-alerts', () => ({ alertEventPaymentNeedsAPerson: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(() => 'hash-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
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
    // This route used to write nothing to webhook_logs, so its silence proved nothing.
    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
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
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
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
    expect(webhookLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'received', params: expect.objectContaining({ source: 'event_bookings' }) }),
    )
    expect(webhookLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'manual_review' }),
    )
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'event_payment.paypal_webhook_manual_review',
      resource_type: 'event_booking',
      resource_id: 'booking-1',
      operation_status: 'failure',
    }))
    // BK-018: the guest was told staff will check; a manager is told, once.
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: 'booking-1',
      kind: 'paid_booking_not_payable',
      reason: 'booking_not_pending_payment',
    }))
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      // One namespace for the whole app now, not one per URL.
      'webhook:paypal:WH-EVENT-1',
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

  // BK-019: a denied capture used to go to the capture handler, which confirmed the booking and
  // marked it paid with no money behind it.
  describe('PAYMENT.CAPTURE.DENIED', () => {
    function denialClient(bookingStatus: string, paymentStatus: string) {
      const rpc = vi.fn()
      const paymentUpdate = vi.fn()
      const auditInsert = vi.fn().mockResolvedValue({ error: null })
      const chain = (result: unknown) => {
        const builder: Record<string, unknown> = {}
        for (const method of ['select', 'eq']) builder[method] = vi.fn(() => builder)
        builder.maybeSingle = vi.fn().mockResolvedValue(result)
        return builder
      }
      const client = {
        rpc,
        from: vi.fn((table: string) => {
          if (table === 'payments') {
            return {
              ...chain({ data: { id: 'payment-1', event_booking_id: 'booking-1', status: paymentStatus, metadata: { source: 'guest_token' } }, error: null }),
              update: vi.fn((payload: unknown) => {
                paymentUpdate(payload)
                return { eq: vi.fn().mockResolvedValue({ error: null }) }
              }),
            }
          }
          if (table === 'bookings') return chain({ data: { id: 'booking-1', status: bookingStatus }, error: null })
          if (table === 'audit_logs') return { insert: auditInsert }
          if (table === 'webhook_logs') return { insert: vi.fn().mockResolvedValue({ error: null }) }
          throw new Error(`Unexpected table: ${table}`)
        }),
      }
      vi.mocked(createAdminClient).mockReturnValue(client as any)
      return { rpc, paymentUpdate, auditInsert }
    }

    async function deliverDenial() {
      const response = await POST(new Request('http://localhost/api/webhooks/paypal/event-bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'WH-EVENT-DENIED',
          event_type: 'PAYMENT.CAPTURE.DENIED',
          resource: {
            id: 'CAPTURE-1',
            status: 'DECLINED',
            custom_id: 'event_booking:booking-1',
            amount: { value: '80.00', currency_code: 'GBP' },
            supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
          },
        }),
      }) as any)
      return { response, payload: await response.json() }
    }

    it('marks the payment failed and never confirms the booking', async () => {
      const db = denialClient('pending_payment', 'pending')

      const { response, payload } = await deliverDenial()

      expect(response.status).toBe(200)
      expect(payload).toMatchObject({ state: 'capture_denied' })
      expect(db.rpc).not.toHaveBeenCalled()
      expect(db.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        paypal_capture_id: 'CAPTURE-1',
        metadata: expect.objectContaining({ capture_status: 'DENIED', source: 'guest_token' }),
      }))
      expect(sendEventPaymentManualReviewSms).not.toHaveBeenCalled()
      expect(db.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
        operation_type: 'event_payment.paypal_capture_denied',
        resource_id: 'booking-1',
      }))
      expect(alertEventPaymentNeedsAPerson).not.toHaveBeenCalled()
    })

    it('flags a booking already confirmed on the refused payment for a person to decide', async () => {
      const db = denialClient('confirmed', 'succeeded')

      const { response, payload } = await deliverDenial()

      expect(response.status).toBe(202)
      expect(payload).toMatchObject({ state: 'manual_review' })
      expect(db.rpc).not.toHaveBeenCalled()
      expect(db.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        metadata: expect.objectContaining({ previously_recorded_as: 'succeeded' }),
      }))
      expect(db.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
        additional_info: expect.objectContaining({ action_needed: expect.stringContaining('Decide whether the booking stands') }),
      }))
      expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        bookingId: 'booking-1',
        kind: 'capture_denied_on_confirmed_booking',
      }))
    })
  })
})
