import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each PayPal webhook route finds the id it verifies signatures against by looking up the
 * webhook registered for its own URL. That URL is built from getAppUrl(), so it must come out
 * exactly as PayPal has it registered: the live app URL plus the route's path, one slash between.
 */

// Set before any import, so env.ts validates the live value rather than the suite default.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

vi.mock('@/lib/paypal', () => ({
  verifyPayPalWebhook: vi.fn(),
  // No webhook registered for the URL, so each route fails closed straight after the lookup.
  resolveWebhookIdForUrl: vi.fn(async () => null),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { resolveWebhookIdForUrl, verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { POST as parkingPost } from '@/app/api/webhooks/paypal/parking/route'
import { POST as eventBookingsPost } from '@/app/api/webhooks/paypal/event-bookings/route'
import { POST as tableBookingsPost } from '@/app/api/webhooks/paypal/table-bookings/route'
import { POST as invoicesPost } from '@/app/api/webhooks/paypal/invoices/route'
import { POST as privateBookingsPost } from '@/app/api/webhooks/paypal/private-bookings/route'

type Post = (request: never) => Promise<Response>

const ROUTES: Array<{ path: string; envId: string; post: Post }> = [
  { path: 'parking', envId: 'PAYPAL_PARKING_WEBHOOK_ID', post: parkingPost as Post },
  { path: 'event-bookings', envId: 'PAYPAL_EVENT_BOOKINGS_WEBHOOK_ID', post: eventBookingsPost as Post },
  { path: 'table-bookings', envId: 'PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID', post: tableBookingsPost as Post },
  { path: 'invoices', envId: 'PAYPAL_INVOICES_WEBHOOK_ID', post: invoicesPost as Post },
]

function webhookRequest(path: string): never {
  const request = new Request(`https://management.orangejelly.co.uk/api/webhooks/paypal/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }),
  })
  return Object.assign(request, { nextUrl: new URL(request.url) }) as never
}

const webhookLogInsert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }))

beforeEach(() => {
  vi.clearAllMocks()
  // A one-off value a case did not consume must not leak into the next case.
  vi.mocked(resolveWebhookIdForUrl).mockReset().mockResolvedValue(null)
  vi.mocked(verifyPayPalWebhook).mockReset()
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({ insert: webhookLogInsert })),
  } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('PayPal webhook signature lookup URL', () => {
  it.each(ROUTES)('$path looks up exactly the registered production URL', async ({ path, envId, post }) => {
    vi.stubEnv(envId, '')

    const response = await post(webhookRequest(path))

    expect(resolveWebhookIdForUrl).toHaveBeenCalledTimes(1)
    expect(resolveWebhookIdForUrl).toHaveBeenCalledWith(
      `https://management.orangejelly.co.uk/api/webhooks/paypal/${path}`
    )
    // Nothing registered for that URL: the route refuses rather than verify against another id.
    expect(verifyPayPalWebhook).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ received: false })
  })
})

describe('PayPal parking webhook id', () => {
  it('verifies against the webhook registered for its own URL, ignoring a configured id', async () => {
    // The production value matched no registered webhook on 22 September 2026.
    vi.stubEnv('PAYPAL_PARKING_WEBHOOK_ID', 'STALE-PARKING-ID')
    vi.mocked(resolveWebhookIdForUrl).mockResolvedValueOnce('REGISTERED-ID')
    vi.mocked(verifyPayPalWebhook).mockResolvedValueOnce(false)

    await (parkingPost as Post)(webhookRequest('parking'))

    expect(resolveWebhookIdForUrl).toHaveBeenCalledWith(
      'https://management.orangejelly.co.uk/api/webhooks/paypal/parking'
    )
    expect(vi.mocked(verifyPayPalWebhook).mock.calls[0][2]).toBe('REGISTERED-ID')
  })
})

describe('PayPal private-bookings webhook id', () => {
  // Both were set in production and neither matched the registered webhook, so every delivery
  // from 28 August to 22 September 2026 failed verification.
  function stubStaleIds(): void {
    vi.stubEnv('PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID', 'STALE-PRIVATE-BOOKINGS-ID')
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'ANOTHER-ENDPOINTS-ID')
  }

  it('verifies against the webhook registered for its own URL, ignoring the configured ids', async () => {
    stubStaleIds()
    vi.mocked(resolveWebhookIdForUrl).mockResolvedValueOnce('REGISTERED-ID')
    vi.mocked(verifyPayPalWebhook).mockResolvedValueOnce(false)

    const response = await (privateBookingsPost as Post)(webhookRequest('private-bookings'))

    expect(resolveWebhookIdForUrl).toHaveBeenCalledWith(
      'https://management.orangejelly.co.uk/api/webhooks/paypal/private-bookings'
    )
    expect(verifyPayPalWebhook).toHaveBeenCalledTimes(1)
    expect(vi.mocked(verifyPayPalWebhook).mock.calls[0][2]).toBe('REGISTERED-ID')
    expect(response.status).toBe(401)
  })

  it('fails closed, and logs why, when no webhook is registered for its URL', async () => {
    stubStaleIds()

    const response = await (privateBookingsPost as Post)(webhookRequest('private-bookings'))

    expect(verifyPayPalWebhook).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      received: false,
      error: 'No PayPal webhook is registered for the private-bookings endpoint',
    })
    expect(webhookLogInsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'configuration_error' }))
  })
})
