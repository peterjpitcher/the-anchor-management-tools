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
import { POST } from '@/app/api/webhooks/paypal/parking/route'

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
    ;(verifyPayPalWebhook as unknown as vi.Mock).mockResolvedValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
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
      id: 'WH-1',
      event_type: 'PAYMENT.CAPTURE.PENDING',
      resource: {},
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
})

