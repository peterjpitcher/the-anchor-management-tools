import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each PayPal webhook route finds the id it verifies signatures against by looking up the
 * webhook registered for its own URL. That URL is built from getAppUrl(), so it must come out
 * exactly as PayPal has it registered: the live app URL plus the route's path, one slash
 * between.
 *
 * The gate itself is real here, so this also pins the precedence rule: a resolved id always
 * wins over a configured one, and a clean "nothing registered" fails closed instead of falling
 * back to a stale override.
 */

// Set before any import, so env.ts validates the live value rather than the suite default.
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

const ROUTES: Array<{ path: string; envId: string; endpointName: string; post: Post }> = [
  { path: 'parking', envId: 'PAYPAL_PARKING_WEBHOOK_ID', endpointName: 'parking', post: parkingPost as Post },
  { path: 'event-bookings', envId: 'PAYPAL_EVENT_BOOKINGS_WEBHOOK_ID', endpointName: 'event-bookings', post: eventBookingsPost as Post },
  { path: 'table-bookings', envId: 'PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID', endpointName: 'table-bookings', post: tableBookingsPost as Post },
  { path: 'invoices', envId: 'PAYPAL_INVOICES_WEBHOOK_ID', endpointName: 'invoices', post: invoicesPost as Post },
  { path: 'private-bookings', envId: 'PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID', endpointName: 'private-bookings', post: privateBookingsPost as Post },
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

function resolution(overrides: Partial<{
  webhookId: string | null
  source: string
  lookupState: string
  lookupMessage: string | null
}>) {
  return {
    webhookId: null,
    source: 'none',
    lookupState: 'no_match',
    lookupMessage: null,
    url: 'https://management.orangejelly.co.uk',
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolvePayPalWebhookId).mockReset().mockResolvedValue(resolution({}))
  vi.mocked(verifyPayPalWebhookDetailed).mockReset()
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

    expect(resolvePayPalWebhookId).toHaveBeenCalledTimes(1)
    expect(vi.mocked(resolvePayPalWebhookId).mock.calls[0][0]).toBe(
      `https://management.orangejelly.co.uk/api/webhooks/paypal/${path}`,
    )
    // Nothing registered for that URL: the route refuses rather than verify against another id.
    expect(verifyPayPalWebhookDetailed).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ received: false })
  })

  it.each(ROUTES)('$path hands its own env var to the resolver, never PAYPAL_WEBHOOK_ID', async ({ path, envId, post }) => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'ANOTHER-ENDPOINTS-ID')
    vi.stubEnv(envId, 'THIS-ENDPOINTS-OVERRIDE')

    await post(webhookRequest(path))

    expect(vi.mocked(resolvePayPalWebhookId).mock.calls[0][1]).toBe('THIS-ENDPOINTS-OVERRIDE')
  })

  it.each(ROUTES)('$path verifies against the resolved id, not a stale configured one', async ({ path, envId, post }) => {
    vi.stubEnv(envId, 'STALE-ID')
    vi.mocked(resolvePayPalWebhookId).mockResolvedValueOnce(
      resolution({ webhookId: 'REGISTERED-ID', source: 'resolved', lookupState: 'matched' }),
    )
    vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValueOnce({
      outcome: 'signature_rejected',
      verificationStatus: 'FAILURE',
      transmissionAgeSeconds: 10,
    })

    const response = await post(webhookRequest(path))

    expect(vi.mocked(verifyPayPalWebhookDetailed).mock.calls[0][2]).toBe('REGISTERED-ID')
    expect(response.status).toBe(401)
  })

  it.each(ROUTES)('$path logs configuration_error when nothing is registered', async ({ path, endpointName, post }) => {
    const response = await post(webhookRequest(path))

    expect(await response.json()).toMatchObject({
      received: false,
      error: `No PayPal webhook is registered for the ${endpointName} endpoint`,
    })
    expect(webhookLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'configuration_error' }),
    )
  })
})
