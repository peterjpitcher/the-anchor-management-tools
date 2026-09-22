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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) })),
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
