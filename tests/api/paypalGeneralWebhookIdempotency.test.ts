import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/paypal', () => ({
  verifyPayPalWebhook: vi.fn(),
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

import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { POST } from '@/app/api/webhooks/paypal/route'

describe('PayPal general webhook idempotency', () => {
  const originalWebhookId = process.env.PAYPAL_WEBHOOK_ID

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PAYPAL_WEBHOOK_ID = 'webhook_test'
    ;(verifyPayPalWebhook as unknown as vi.Mock).mockResolvedValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalWebhookId === undefined) {
      delete process.env.PAYPAL_WEBHOOK_ID
    } else {
      process.env.PAYPAL_WEBHOOK_ID = originalWebhookId
    }
  })

  it('does not write audit rows when PayPal replays an already processed event', async () => {
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'replay' })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const auditLogInsert = vi.fn().mockResolvedValue({ error: null })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        if (table === 'audit_logs') {
          return { insert: auditLogInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'WH-GENERAL-1',
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: {
        id: 'CAPTURE-1',
        custom_id: 'invoice-1',
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ received: true, duplicate: true })
    expect(claimIdempotencyKey).toHaveBeenCalledWith(
      expect.anything(),
      'webhook:paypal:general:WH-GENERAL-1',
      'hash-1',
      24 * 30
    )
    expect(auditLogInsert).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
  })

  it('persists the idempotency response after processing a new event', async () => {
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const auditLogInsert = vi.fn().mockResolvedValue({ error: null })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        if (table === 'audit_logs') {
          return { insert: auditLogInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'WH-GENERAL-2',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPTURE-2',
        amount: { value: '12.50' },
        custom_id: 'invoice-2',
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal', {
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
    expect(auditLogInsert).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'paypal_capture_completed',
      resource_id: 'WH-GENERAL-2',
    }))
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      'webhook:paypal:general:WH-GENERAL-2',
      'hash-1',
      expect.objectContaining({
        state: 'processed',
        event_id: 'WH-GENERAL-2',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
      }),
      24 * 30
    )
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })
})
