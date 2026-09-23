import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The webhook id resolver decides which id a signature is checked against. Getting the
 * precedence wrong is not a cosmetic bug: a stale env var beating a correctly resolved id is
 * exactly what rejected every private-bookings delivery for six months.
 *
 * Each case re-imports the module so the ten minute lookup cache starts empty.
 */

const APP_URL = 'https://management.orangejelly.co.uk'
const ENDPOINT = `${APP_URL}/api/webhooks/paypal/private-bookings`

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })
}

function registryResponse(webhooks: Array<{ id: string; url: string }>): Response {
  return new Response(JSON.stringify({ webhooks }), { status: 200 })
}

async function loadPayPal() {
  vi.resetModules()
  return await import('@/lib/paypal')
}

beforeEach(() => {
  vi.unstubAllGlobals()
  process.env.PAYPAL_CLIENT_ID = 'test-client-id'
  process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret'
  process.env.PAYPAL_ENVIRONMENT = 'sandbox'
})

describe('resolvePayPalWebhookId', () => {
  it('uses the registered id and ignores a configured one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      return registryResponse([{ id: 'REGISTERED-ID', url: ENDPOINT }])
    }))

    const { resolvePayPalWebhookId } = await loadPayPal()
    const result = await resolvePayPalWebhookId(ENDPOINT, 'STALE-ENV-ID')

    expect(result).toMatchObject({
      webhookId: 'REGISTERED-ID',
      source: 'resolved',
      lookupState: 'matched',
    })
  })

  it('fails closed when PayPal says nothing is registered, even with a configured id', async () => {
    // A clean "not registered" is a trustworthy answer. Patching over it with a stale override
    // is precisely the failure this whole change exists to stop, so the route refuses, PayPal
    // retries for three days, and the health check alerts.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      return registryResponse([{ id: 'SOMEONE-ELSES-ID', url: `${APP_URL}/api/webhooks/paypal/invoices` }])
    }))

    const { resolvePayPalWebhookId } = await loadPayPal()
    const result = await resolvePayPalWebhookId(ENDPOINT, 'STALE-ENV-ID')

    expect(result).toMatchObject({ webhookId: null, source: 'none', lookupState: 'no_match' })
  })

  it('uses the endpoint own env var only when the registry is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      return new Response('upstream error', { status: 503 })
    }))

    const { resolvePayPalWebhookId } = await loadPayPal()
    const result = await resolvePayPalWebhookId(ENDPOINT, 'EMERGENCY-OVERRIDE')

    expect(result).toMatchObject({
      webhookId: 'EMERGENCY-OVERRIDE',
      source: 'env',
      lookupState: 'unavailable',
    })
    expect(result.lookupMessage).toContain('503')
  })

  it('reports no id at all when the registry is unreachable and nothing is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      return new Response('upstream error', { status: 503 })
    }))

    const { resolvePayPalWebhookId } = await loadPayPal()
    const result = await resolvePayPalWebhookId(ENDPOINT, '')

    expect(result).toMatchObject({ webhookId: null, source: 'none', lookupState: 'unavailable' })
  })

  it('says when an id came from a stale cache rather than a fresh lookup', async () => {
    let registryCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      registryCalls += 1
      if (registryCalls === 1) return registryResponse([{ id: 'REGISTERED-ID', url: ENDPOINT }])
      return new Response('upstream error', { status: 500 })
    }))

    const { resolvePayPalWebhookId } = await loadPayPal()
    await resolvePayPalWebhookId(ENDPOINT, null)

    // Past the ten minute cache window, so the next call asks PayPal again and fails.
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000))
    const result = await resolvePayPalWebhookId(ENDPOINT, 'EMERGENCY-OVERRIDE')
    vi.useRealTimers()

    // The cached id is still the right answer, and it beats the override, but the caller is
    // told the registry was not actually reached.
    expect(result).toMatchObject({
      webhookId: 'REGISTERED-ID',
      source: 'stale_cache',
      lookupState: 'unavailable',
    })
  })

  it('matches the registered URL regardless of case and trailing slash', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      return registryResponse([{ id: 'REGISTERED-ID', url: `${ENDPOINT}/` }])
    }))

    const { resolvePayPalWebhookId } = await loadPayPal()
    const result = await resolvePayPalWebhookId(ENDPOINT.toUpperCase(), null)

    expect(result.webhookId).toBe('REGISTERED-ID')
  })
})

describe('resolveWebhookIdForUrl compatibility', () => {
  it('still returns just the id or null', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      return registryResponse([{ id: 'REGISTERED-ID', url: ENDPOINT }])
    }))

    const { resolveWebhookIdForUrl } = await loadPayPal()
    await expect(resolveWebhookIdForUrl(ENDPOINT)).resolves.toBe('REGISTERED-ID')
  })
})
