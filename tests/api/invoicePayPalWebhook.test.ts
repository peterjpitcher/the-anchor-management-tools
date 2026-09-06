import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(), claim: vi.fn(), persist: vi.fn(), release: vi.fn(), verify: vi.fn(), insert: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ insert: mocks.insert }) }) }))
vi.mock('@/lib/paypal', () => ({ verifyPayPalWebhook: mocks.verify, resolveWebhookIdForUrl: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/invoices/paypal-capture', () => ({
  applyInvoicePayPalCapture: mocks.apply,
  positivePennies: (value: string) => /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0 ? Math.round(Number(value) * 100) : null,
}))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: mocks.claim, computeIdempotencyRequestHash: () => 'HASH',
  persistIdempotencyResponse: mocks.persist, releaseIdempotencyClaim: mocks.release,
}))
import { POST } from '@/app/api/webhooks/paypal/invoices/route'

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest('https://management.orangejelly.co.uk/api/webhooks/paypal/invoices', {
    method: 'POST', body: JSON.stringify({
      id: 'EVENT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {
        id: 'CAPTURE-1', status: 'COMPLETED', custom_id: 'inv-pay-8a590bb4-487b-4522-929b-b5c6c3f81071',
        amount: { value: '744.80', currency_code: 'GBP' }, create_time: '2026-09-04T13:38:30Z',
        supplementary_data: { related_ids: { order_id: 'ORDER-1' } }, ...overrides,
      },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PAYPAL_INVOICES_WEBHOOK_ID = 'WEBHOOK-1'
  mocks.verify.mockResolvedValue(true)
  mocks.claim.mockResolvedValue({ state: 'claimed' })
  mocks.apply.mockResolvedValue({ success: true })
  mocks.persist.mockResolvedValue(undefined)
  mocks.release.mockResolvedValue(undefined)
  mocks.insert.mockResolvedValue({ error: null })
})

describe('invoice PayPal webhook', () => {
  it('leaves a failed recording retryable instead of acknowledging lost money', async () => {
    mocks.apply.mockResolvedValue({ error: 'Payment write failed' })
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
  it('records the exact capture, order and provider timestamp', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      amount: 744.8, captureId: 'CAPTURE-1', orderId: 'ORDER-1', capturedAt: '2026-09-04T13:38:30Z',
    }))
    expect(mocks.persist).toHaveBeenCalledTimes(1)
    expect(mocks.release).not.toHaveBeenCalled()
  })
  it('acknowledges only completed duplicates', async () => {
    mocks.claim.mockResolvedValue({ state: 'replay', response: { received: true } })
    expect((await POST(request())).status).toBe(200)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it.each(['in_progress', 'conflict'])('keeps %s deliveries retryable', async state => {
    mocks.claim.mockResolvedValue({ state })
    expect((await POST(request())).status).toBe(503)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it.each([
    { status: 'PENDING' }, { amount: { value: '744.80' } }, { amount: { value: '744.801', currency_code: 'GBP' } },
  ])('rejects an unconfirmed or malformed capture', async resource => {
    expect((await POST(request(resource))).status).toBe(500)
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
  it('rejects an invalid signature before claiming or recording', async () => {
    mocks.verify.mockResolvedValue(false)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
  })
})
