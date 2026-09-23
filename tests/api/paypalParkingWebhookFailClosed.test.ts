import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// The route goes through the shared gate. What the gate itself accepts is proved against the
// real helper in tests/lib/paypalWebhookVerification.test.ts.
vi.mock('@/lib/paypal-webhook-gate', async () => {
  const { paypalGateModuleMock } = await import('../helpers/paypalGateMock')
  return paypalGateModuleMock()
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { POST } from '@/app/api/webhooks/paypal/parking/route'


/**
 * The dispatcher routes on the payload before any handler runs, and a bare custom_id makes it
 * ask table_bookings first. These tests are about parking, so that probe answers "no".
 */
function noTableBooking(): any {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  }
  return chain
}

describe('PayPal parking webhook fail-closed guards', () => {
  const originalWebhookId = process.env.PAYPAL_WEBHOOK_ID

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PAYPAL_WEBHOOK_ID = 'webhook_test'
  })

  afterEach(() => {
    if (originalWebhookId === undefined) {
      delete process.env.PAYPAL_WEBHOOK_ID
    } else {
      process.env.PAYPAL_WEBHOOK_ID = originalWebhookId
    }
  })

  it('returns 200 and keeps idempotency claim when idempotency persistence fails after processing', async () => {
    ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as Mock).mockResolvedValue(undefined)
    ;(persistIdempotencyResponse as unknown as Mock).mockRejectedValue(new Error('db down'))

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const auditLogInsert = vi.fn().mockResolvedValue({ error: null })
    const paymentQuery: any = {
      update: vi.fn(() => paymentQuery),
      eq: vi.fn(() => paymentQuery),
      select: vi.fn(() => paymentQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'payment-1' }, error: null }),
    }
    const bookingQuery: any = {
      update: vi.fn(() => bookingQuery),
      eq: vi.fn(() => bookingQuery),
      select: vi.fn(() => bookingQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'booking-1' }, error: null }),
    }
    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        if (table === 'audit_logs') {
          return { insert: auditLogInsert }
        }
        if (table === 'table_bookings') {
          return noTableBooking()
        }
        if (table === 'parking_booking_payments') {
          return paymentQuery
        }
        if (table === 'parking_bookings') {
          return bookingQuery
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'WH-1',
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: {
        id: 'CAPTURE-1',
        custom_id: 'booking-1',
        status_details: { reason: 'INSTRUMENT_DECLINED' },
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal/parking', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true, idempotency_persist_failed: true })
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('marks the parent parking booking failed when a capture is denied', async () => {
    ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-denied')
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const auditLogInsert = vi.fn().mockResolvedValue({ error: null })

    const paymentQuery: any = {
      update: vi.fn(() => paymentQuery),
      eq: vi.fn(() => paymentQuery),
      select: vi.fn(() => paymentQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'payment-1' }, error: null }),
    }

    const bookingQuery: any = {
      update: vi.fn(() => bookingQuery),
      eq: vi.fn(() => bookingQuery),
      select: vi.fn(() => bookingQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'booking-1' }, error: null }),
    }

    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        if (table === 'audit_logs') {
          return { insert: auditLogInsert }
        }
        if (table === 'parking_booking_payments') {
          return paymentQuery
        }
        if (table === 'table_bookings') {
          return noTableBooking()
        }
        if (table === 'parking_bookings') {
          return bookingQuery
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'WH-DENIED-1',
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: {
        id: 'CAPTURE-1',
        custom_id: 'booking-1',
        status_details: { reason: 'INSTRUMENT_DECLINED' },
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal/parking', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true })
    expect(paymentQuery.update).toHaveBeenCalledWith({
      status: 'failed',
      metadata: {
        webhook_event_id: 'WH-DENIED-1',
        failure_reason: 'INSTRUMENT_DECLINED',
      },
    })
    expect(bookingQuery.update).toHaveBeenCalledWith({ payment_status: 'failed' })
    expect(bookingQuery.eq).toHaveBeenCalledWith('payment_status', 'pending')
    expect(auditLogInsert).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'payment_webhook_denied',
      resource_id: 'booking-1',
      operation_status: 'failure',
    }))
  })

  it('rejects completed captures when the amount does not match the pending parking payment', async () => {
    ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-completed')
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const bookingQuery: any = {
      select: vi.fn(() => bookingQuery),
      eq: vi.fn(() => bookingQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'booking-1', payment_status: 'pending', status: 'pending_payment', reference: 'PARK-1' },
        error: null,
      }),
    }
    const paymentQuery: any = {
      select: vi.fn(() => paymentQuery),
      update: vi.fn(() => paymentQuery),
      eq: vi.fn(() => paymentQuery),
      order: vi.fn(() => paymentQuery),
      limit: vi.fn(() => paymentQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'payment-1', status: 'pending', transaction_id: null, amount: 25, currency: 'GBP' },
        error: null,
      }),
    }

    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        if (table === 'table_bookings') {
          return noTableBooking()
        }
        if (table === 'parking_bookings') {
          return bookingQuery
        }
        if (table === 'parking_booking_payments') {
          return paymentQuery
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'WH-COMPLETED-MISMATCH',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPTURE-1',
        custom_id: 'booking-1',
        amount: { value: '30.00', currency_code: 'GBP' },
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal/parking', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(paymentQuery.update).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
    // One namespace for the whole app, not one per URL, so the same event arriving on another
    // registered URL is recognised as a duplicate rather than processed again.
    expect(releaseIdempotencyClaim).toHaveBeenCalledWith(expect.anything(), 'webhook:paypal:WH-COMPLETED-MISMATCH', 'hash-completed')
  })
})
