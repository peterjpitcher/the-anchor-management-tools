import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A health check that only looks at signature failures, and that goes quiet when it cannot
 * reach its own dependencies, is worse than none: it would have stayed silent through the six
 * months this endpoint was dead. So it reports healthy, unhealthy or unknown, counts
 * post-verification failures as well as verification ones, and never calls a suppressed or
 * failed alert email a delivery.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

vi.mock('@/lib/paypal', () => ({ listPayPalWebhookRegistrations: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { listPayPalWebhookRegistrations } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { PAYPAL_WEBHOOK_ENDPOINTS } from '@/lib/paypal-webhook-endpoints'
import { GET } from '@/app/api/cron/paypal-webhook-health/route'

const APP_URL = 'https://management.orangejelly.co.uk'

function everyEndpointRegistered() {
  return {
    state: 'ok' as const,
    webhooks: PAYPAL_WEBHOOK_ENDPOINTS.map((endpoint, index) => ({
      id: `WH-${index}`,
      url: `${APP_URL}${endpoint.path}`,
      eventTypes: [...endpoint.requiredEvents, ...endpoint.optionalEvents],
    })),
  }
}

function supabaseReturning(rows: Array<Record<string, unknown>> | null, error: { message: string } | null = null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    gte: () => chain,
    // The read is paged, so one short page ends it.
    range: () => Promise.resolve({ data: rows, error }),
  }
  return { from: vi.fn(() => chain) } as never
}

function cronRequest(): never {
  const request = new Request(`${APP_URL}/api/cron/paypal-webhook-health`, {
    headers: { authorization: 'Bearer test-cron-secret' },
  })
  return Object.assign(request, { nextUrl: new URL(request.url) }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.CRON_ALERT_EMAIL = 'alerts@example.com'
  vi.mocked(sendEmail).mockResolvedValue({ success: true } as never)
})

describe('GET /api/cron/paypal-webhook-health', () => {
  it('refuses an unauthenticated request', async () => {
    const request = new Request(`${APP_URL}/api/cron/paypal-webhook-health`)
    const response = await GET(Object.assign(request, { nextUrl: new URL(request.url) }) as never)
    expect(response.status).toBe(401)
  })

  it('stays silent on a quiet, fully registered day', async () => {
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(everyEndpointRegistered())
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning([]))

    const body = await (await GET(cronRequest())).json()

    expect(body.health).toBe('healthy')
    expect(body.alert_delivery).toBe('not_needed')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('flags an endpoint with no registered webhook', async () => {
    const registry = everyEndpointRegistered()
    registry.webhooks = registry.webhooks.filter((webhook) => !webhook.url.endsWith('/parking'))
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(registry)
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning([]))

    const body = await (await GET(cronRequest())).json()

    expect(body.health).toBe('unhealthy')
    expect(body.alert_delivery).toBe('sent')
    expect(body.registrations.find((row: any) => row.endpoint === 'parking').registered).toBe(false)
  })

  it('flags a registered endpoint that is missing a required event', async () => {
    const registry = everyEndpointRegistered()
    registry.webhooks = registry.webhooks.map((webhook) =>
      webhook.url.endsWith('/invoices')
        ? { ...webhook, eventTypes: ['PAYMENT.CAPTURE.COMPLETED'] }
        : webhook,
    )
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(registry)
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning([]))

    const body = await (await GET(cronRequest())).json()

    expect(body.health).toBe('unhealthy')
    expect(body.registrations.find((row: any) => row.endpoint === 'invoices').missingRequiredEvents).toEqual([
      'PAYMENT.CAPTURE.DENIED',
    ])
  })

  it('accepts a wildcard subscription as covering every event', async () => {
    const registry = everyEndpointRegistered()
    registry.webhooks = registry.webhooks.map((webhook) => ({ ...webhook, eventTypes: ['*'] }))
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(registry)
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning([]))

    const body = await (await GET(cronRequest())).json()

    expect(body.health).toBe('healthy')
  })

  it('reports an unrecognised registered URL without deleting anything', async () => {
    const registry = everyEndpointRegistered()
    registry.webhooks.push({ id: 'WH-X', url: 'https://example.invalid/hook', eventTypes: ['*'] })
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(registry)
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning([]))

    const body = await (await GET(cronRequest())).json()

    expect(body.unknown_urls).toEqual(['https://example.invalid/hook'])
  })

  it('counts a failure that happened AFTER a valid signature', async () => {
    // A cryptographically valid event whose deposit finalisation then failed logs `error`, which
    // a signature-only check would treat as a clean day.
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(everyEndpointRegistered())
    vi.mocked(createAdminClient).mockReturnValue(
      supabaseReturning([
        { status: 'error', params: { source: 'private_bookings', event_id: 'WH-1' } },
        { status: 'error', params: { source: 'private_bookings', event_id: 'WH-1' } },
        { status: 'idempotency_persist_failed', params: { source: 'invoices', event_id: 'WH-2' } },
      ]),
    )

    const body = await (await GET(cronRequest())).json()

    expect(body.health).toBe('unhealthy')
    // Two attempts, one distinct event: a retried failure is not two broken payments.
    expect(body.failures).toContainEqual({
      source: 'private_bookings',
      status: 'error',
      attempts: 2,
      uniqueEvents: 1,
    })
  })

  it('reports unknown, not healthy, when PayPal cannot be reached', async () => {
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue({
      state: 'unavailable',
      webhooks: [],
      message: 'PayPal webhook registry returned 503',
    })
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning([]))

    const body = await (await GET(cronRequest())).json()

    expect(body.health).toBe('unknown')
    expect(body.problems[0]).toContain('503')
    expect(body.alert_delivery).toBe('sent')
  })

  it('reports unknown when the database cannot be read', async () => {
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(everyEndpointRegistered())
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning(null, { message: 'connection refused' }))

    const body = await (await GET(cronRequest())).json()

    expect(body.health).toBe('unknown')
    expect(body.problems[0]).toContain('connection refused')
  })

  it('never claims delivery when no recipient is configured', async () => {
    delete process.env.CRON_ALERT_EMAIL
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue({
      state: 'unavailable',
      webhooks: [],
      message: 'timeout',
    })
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning([]))

    const body = await (await GET(cronRequest())).json()

    expect(body.alert_delivery).toBe('no_recipient')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('separates a suppressed alert from a failed one', async () => {
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(everyEndpointRegistered())
    vi.mocked(createAdminClient).mockReturnValue(
      supabaseReturning([{ status: 'signature_rejected', params: { source: 'invoices', event_id: 'WH-9' } }]),
    )
    vi.mocked(sendEmail).mockResolvedValue({
      success: false,
      error: 'Email sending is currently suspended',
      code: 'email_suspended',
    } as never)

    const body = await (await GET(cronRequest())).json()

    expect(body.alert_delivery).toBe('suppressed')
  })

  it('reports a failed send rather than swallowing it', async () => {
    vi.mocked(listPayPalWebhookRegistrations).mockResolvedValue(everyEndpointRegistered())
    vi.mocked(createAdminClient).mockReturnValue(
      supabaseReturning([{ status: 'signature_rejected', params: { source: 'invoices', event_id: 'WH-9' } }]),
    )
    vi.mocked(sendEmail).mockRejectedValue(new Error('smtp down'))

    const body = await (await GET(cronRequest())).json()

    expect(body.alert_delivery).toBe('failed')
    expect(body.alert_error).toContain('smtp down')
  })
})
