import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every PayPal webhook route must say what actually failed.
 *
 * Until this change all four pre-verification causes, plus a PayPal outage, wrote the same
 * `signature_failed` row with the message "Invalid PayPal signature". That single ambiguous
 * status cost a day of wrong diagnosis and hid a dead endpoint for six months, so this pins
 * the status, the HTTP code and the recorded diagnostics on all five endpoints at once.
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

import { resolvePayPalWebhookId, verifyPayPalWebhookDetailed } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { POST as parkingPost } from '@/app/api/webhooks/paypal/parking/route'
import { POST as eventBookingsPost } from '@/app/api/webhooks/paypal/event-bookings/route'
import { POST as tableBookingsPost } from '@/app/api/webhooks/paypal/table-bookings/route'
import { POST as invoicesPost } from '@/app/api/webhooks/paypal/invoices/route'
import { POST as privateBookingsPost } from '@/app/api/webhooks/paypal/private-bookings/route'

type Post = (request: never) => Promise<Response>

const ROUTES: Array<{ name: string; source: string; post: Post }> = [
  { name: 'parking', source: 'parking', post: parkingPost as Post },
  { name: 'event-bookings', source: 'event_bookings', post: eventBookingsPost as Post },
  { name: 'table-bookings', source: 'table_bookings', post: tableBookingsPost as Post },
  { name: 'invoices', source: 'invoices', post: invoicesPost as Post },
  { name: 'private-bookings', source: 'private_bookings', post: privateBookingsPost as Post },
]

const RESOLVED = {
  webhookId: 'REGISTERED-ID',
  source: 'resolved',
  lookupState: 'matched',
  lookupMessage: null,
  url: 'https://management.orangejelly.co.uk',
} as never

function webhookRequest(name: string, body?: string): never {
  const request = new Request(`https://management.orangejelly.co.uk/api/webhooks/paypal/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ?? JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }),
  })
  return Object.assign(request, { nextUrl: new URL(request.url) }) as never
}

const webhookLogInsert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }))

function loggedRows(): Array<Record<string, any>> {
  return webhookLogInsert.mock.calls.map((call) => call[0] as Record<string, any>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolvePayPalWebhookId).mockReset().mockResolvedValue(RESOLVED)
  vi.mocked(verifyPayPalWebhookDetailed).mockReset()
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({ insert: webhookLogInsert })),
  } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(ROUTES)('$name webhook failure diagnostics', ({ name, source, post }) => {
  it('records missing headers as their own cause, with a 400', async () => {
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'missing_signature_headers',
      missingHeaders: ['paypal-transmission-sig'],
      transmissionAgeSeconds: null,
    })

    const response = await post(webhookRequest(name))

    expect(response.status).toBe(400)
    expect(loggedRows()[0]).toMatchObject({
      status: 'missing_signature_headers',
      params: expect.objectContaining({ source }),
      error_details: expect.objectContaining({
        webhook_id: 'REGISTERED-ID',
        webhook_id_source: 'resolved',
        missing_headers: ['paypal-transmission-sig'],
      }),
    })
  })

  it('records a message outside the retry window as stale, not as a bad signature, with a 400', async () => {
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'stale_transmission',
      reason: 'too_old',
      transmissionAgeSeconds: 5 * 24 * 60 * 60,
    })

    const response = await post(webhookRequest(name))

    expect(response.status).toBe(400)
    expect(loggedRows()[0]).toMatchObject({
      status: 'stale_transmission',
      error_details: expect.objectContaining({ transmission_age_seconds: 432000 }),
    })
  })

  it('records an explicit PayPal FAILURE as a rejected signature, with a 401', async () => {
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'signature_rejected',
      verificationStatus: 'FAILURE',
      transmissionAgeSeconds: 30,
    })

    const response = await post(webhookRequest(name))

    expect(response.status).toBe(401)
    expect(loggedRows()[0]).toMatchObject({
      status: 'signature_rejected',
      error_details: expect.objectContaining({ verification_status: 'FAILURE' }),
    })
  })

  it('records a PayPal outage as unavailable and returns 500 so it is retried', async () => {
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'verification_unavailable',
      message: 'PayPal verify-webhook-signature returned 503',
      transmissionAgeSeconds: 30,
    })

    const response = await post(webhookRequest(name))

    // Our own outage must never be answered, or recorded, as a rejected signature.
    expect(response.status).toBe(500)
    expect(loggedRows()[0]).toMatchObject({ status: 'verification_unavailable' })
  })

  it('records malformed JSON as an invalid payload, with a 400', async () => {
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'invalid_payload',
      message: 'Unexpected token',
      transmissionAgeSeconds: 30,
    })

    const response = await post(webhookRequest(name, 'not json'))

    expect(response.status).toBe(400)
    expect(loggedRows()[0]).toMatchObject({ status: 'invalid_payload' })
  })

  it('never puts the signature itself on a log row', async () => {
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'signature_rejected',
      verificationStatus: 'FAILURE',
      transmissionAgeSeconds: 30,
    })

    await post(webhookRequest(name))

    const headers = loggedRows()[0].headers as Record<string, string>
    expect(headers['paypal-transmission-sig']).toBeUndefined()
    expect(headers['paypal-transmission-sig-present']).toBe('false')
  })

  it('makes no business write when verification does not succeed', async () => {
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'verification_unavailable',
      message: 'timeout',
      transmissionAgeSeconds: 30,
    })

    const from = vi.fn(() => ({ insert: webhookLogInsert }))
    vi.mocked(createAdminClient).mockReturnValue({ from } as never)

    await post(webhookRequest(name))

    // The only table touched is the log itself.
    const tables = from.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(tables.every((table) => table === 'webhook_logs')).toBe(true)
  })
})
