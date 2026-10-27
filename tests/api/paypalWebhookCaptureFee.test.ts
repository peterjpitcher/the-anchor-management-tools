import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * BK-117: PayPal's fee for each capture was never stored. Every capture the app makes reaches the
 * one PayPal webhook, so the dispatcher records the fee there, keyed by the capture id. A failed
 * fee write never fails the delivery.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

vi.mock('@/lib/paypal', () => ({
  resolvePayPalWebhookId: vi.fn(),
  verifyPayPalWebhookDetailed: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))
vi.mock('@/lib/paypal-domains/invoices', () => ({
  handleInvoiceCapture: vi.fn(async () => undefined),
  handleInvoiceDenied: vi.fn(async () => undefined),
}))

import { resolvePayPalWebhookId, verifyPayPalWebhookDetailed } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { handleInvoiceCapture } from '@/lib/paypal-domains/invoices'
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/webhooks/paypal/route'

const webhookLogInsert = vi.fn(async () => ({ error: null }))
const feeUpsert = vi.fn(async (_row: unknown, _options: unknown) => ({ error: null as { message: string } | null }))

function supabase() {
  return {
    from: vi.fn((table: string): any => {
      if (table === 'webhook_logs') return { insert: webhookLogInsert }
      if (table === 'paypal_capture_fees') return { upsert: feeUpsert }
      throw new Error(`Unexpected table: ${table}`)
    }),
  } as never
}

function request(event: Record<string, unknown>): never {
  const built = new Request('https://management.orangejelly.co.uk/api/webhooks/paypal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
  return Object.assign(built, { nextUrl: new URL(built.url) }) as never
}

const CAPTURE_WITH_FEE = {
  id: 'WH-FEE-1',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {
    id: 'CAPTURE-FEE-1',
    custom_id: 'inv-pay-invoice-1',
    amount: { value: '950.00', currency_code: 'GBP' },
    seller_receivable_breakdown: {
      gross_amount: { value: '950.00', currency_code: 'GBP' },
      paypal_fee: { value: '32.60', currency_code: 'GBP' },
      net_amount: { value: '917.40', currency_code: 'GBP' },
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  feeUpsert.mockImplementation(async () => ({ error: null }))
  vi.mocked(resolvePayPalWebhookId).mockResolvedValue({
    webhookId: 'REGISTERED-ID',
    source: 'resolved',
    lookupState: 'matched',
    lookupMessage: null,
    url: 'https://management.orangejelly.co.uk/api/webhooks/paypal',
  } as never)
  vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValue({
    outcome: 'verified',
    verificationStatus: 'SUCCESS',
    transmissionAgeSeconds: 12,
  })
  ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
  ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-1')
  ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)
  ;(releaseIdempotencyClaim as unknown as Mock).mockResolvedValue(undefined)
  vi.mocked(createAdminClient).mockReturnValue(supabase())
})

describe('PayPal capture fees (BK-117)', () => {
  it('records the fee of a completed capture once, keyed by the capture id', async () => {
    const response = await POST(request(CAPTURE_WITH_FEE))

    expect(response.status).toBe(200)
    expect(handleInvoiceCapture).toHaveBeenCalledTimes(1)
    expect(feeUpsert).toHaveBeenCalledWith(
      {
        capture_id: 'CAPTURE-FEE-1',
        fee_amount: 32.6,
        gross_amount: 950,
        net_amount: 917.4,
        currency: 'GBP',
        source: 'webhook:invoices',
      },
      { onConflict: 'capture_id', ignoreDuplicates: true },
    )
  })

  it('still acknowledges the payment when the fee cannot be written, and logs it', async () => {
    feeUpsert.mockImplementation(async () => ({ error: { message: 'boom' } }))

    const response = await POST(request(CAPTURE_WITH_FEE))

    expect(response.status).toBe(200)
    expect(handleInvoiceCapture).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Failed to record a PayPal capture fee', expect.anything())
  })

  it('writes nothing when PayPal reports no fee', async () => {
    const withoutFee = { ...CAPTURE_WITH_FEE, id: 'WH-FEE-2', resource: { ...CAPTURE_WITH_FEE.resource, seller_receivable_breakdown: undefined } }

    const response = await POST(request(withoutFee))

    expect(response.status).toBe(200)
    expect(feeUpsert).not.toHaveBeenCalled()
  })
})
