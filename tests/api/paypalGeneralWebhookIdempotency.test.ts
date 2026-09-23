import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * `/api/webhooks/paypal` is now THE PayPal webhook, not a general logging sink.
 *
 * It used to verify against PAYPAL_WEBHOOK_ID and do nothing but write an audit row, on the
 * assumption that the per-domain URLs each received their own events. They never did: PayPal
 * fans every event on the app out to every registered URL, so this endpoint now receives
 * everything and routes on the payload, and the per-domain URLs share the same dispatcher.
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
import { handleInvoiceCapture, handleInvoiceDenied } from '@/lib/paypal-domains/invoices'
import { POST } from '@/app/api/webhooks/paypal/route'

const webhookLogInsert = vi.fn(async () => ({ error: null }))

function supabase() {
  return {
    from: vi.fn((table: string): any => {
      if (table === 'webhook_logs') return { insert: webhookLogInsert }
      // Nothing else should be touched: an invoice event routes on its custom_id prefix alone.
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

const INVOICE_CAPTURE = {
  id: 'WH-GENERAL-2',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {
    id: 'CAPTURE-2',
    custom_id: 'inv-pay-invoice-1',
    amount: { value: '10.00', currency_code: 'GBP' },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
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
  ;(computeIdempotencyRequestHash as unknown as Mock).mockReturnValue('hash-1')
  ;(persistIdempotencyResponse as unknown as Mock).mockResolvedValue(undefined)
  ;(releaseIdempotencyClaim as unknown as Mock).mockResolvedValue(undefined)
  vi.mocked(createAdminClient).mockReturnValue(supabase())
})

describe('the canonical PayPal webhook', () => {
  it('resolves its id from its own URL, not from a per-domain one', async () => {
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })

    await POST(request(INVOICE_CAPTURE))

    expect(vi.mocked(resolvePayPalWebhookId).mock.calls[0][0]).toBe(
      'https://management.orangejelly.co.uk/api/webhooks/paypal',
    )
  })

  it('routes an invoice capture to the invoice handler', async () => {
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })

    const response = await POST(request(INVOICE_CAPTURE))

    expect(response.status).toBe(200)
    expect(handleInvoiceCapture).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'WH-GENERAL-2' }),
      'WH-GENERAL-2',
      'invoice-1',
    )
    expect(webhookLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        // Logged against the domain it turned out to belong to, not the URL it arrived on.
        params: expect.objectContaining({ source: 'invoices' }),
      }),
    )
  })

  it('routes an invoice denial to the denial handler', async () => {
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })

    await POST(request({
      id: 'WH-GENERAL-1',
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: { id: 'CAPTURE-1', custom_id: 'inv-pay-invoice-1' },
    }))

    expect(handleInvoiceDenied).toHaveBeenCalled()
  })

  it('claims under one namespace for the whole app', async () => {
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })

    await POST(request(INVOICE_CAPTURE))

    expect(claimIdempotencyKey).toHaveBeenCalledWith(
      expect.anything(),
      // NOT 'webhook:paypal:general:...'. The same event delivered to another registered URL
      // has to be recognised here as a duplicate.
      'webhook:paypal:WH-GENERAL-2',
      'hash-1',
      24 * 30,
    )
  })

  it('does no work when PayPal replays an already processed event', async () => {
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'replay' })

    const response = await POST(request(INVOICE_CAPTURE))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, duplicate: true })
    expect(handleInvoiceCapture).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
  })

  it('persists the idempotency response after processing a new event', async () => {
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })

    await POST(request(INVOICE_CAPTURE))

    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      'webhook:paypal:WH-GENERAL-2',
      'hash-1',
      expect.objectContaining({ state: 'processed', domain: 'invoices' }),
      24 * 30,
    )
  })

  it('acknowledges an event it cannot place, rather than retrying it forever', async () => {
    ;(claimIdempotencyKey as unknown as Mock).mockResolvedValue({ state: 'claimed' })
    // This endpoint receives every event on the PayPal account, including ones that are
    // nothing to do with this app. A 500 here would have PayPal retry for three days.
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string): any => {
        if (table === 'webhook_logs') return { insert: webhookLogInsert }
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          contains: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        }
        return chain
      }),
    } as never)

    const response = await POST(request({
      id: 'WH-FOREIGN',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAPTURE-X', custom_id: 'someone-elses-system' },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, unrouted: true })
    expect(handleInvoiceCapture).not.toHaveBeenCalled()
    expect(webhookLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unrouted' }),
    )
  })
})
