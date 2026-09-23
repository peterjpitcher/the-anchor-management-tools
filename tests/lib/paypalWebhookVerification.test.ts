import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  evaluatePayPalTransmissionTime,
  isPayPalTransmissionTimeFresh,
  verifyPayPalWebhook,
  verifyPayPalWebhookDetailed,
  PAYPAL_WEBHOOK_MAX_TRANSMISSION_AGE_MS,
} from '@/lib/paypal'

/**
 * These exercise the REAL verification helper with mocked HTTP, not a mocked verifier. A route
 * suite that stubs `verifyPayPalWebhook` to return true proves nothing about which messages are
 * accepted, which is how a five minute window survived unnoticed for three months while
 * rejecting every PayPal retry.
 */

const NOW = Date.parse('2026-09-23T12:00:00.000Z')

function freshHeaders(transmissionTime: string): Record<string, string> {
  return {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api-m.paypal.com/certs/test',
    'paypal-transmission-id': 'transmission-1',
    'paypal-transmission-sig': 'signature',
    'paypal-transmission-time': transmissionTime,
  }
}

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function verifyResponse(status: unknown, httpStatus = 200): Response {
  return new Response(JSON.stringify({ verification_status: status }), {
    status: httpStatus,
    headers: { 'content-type': 'application/json' },
  })
}

/** Answers the token call, then whatever the case wants from verify-webhook-signature. */
function stubPayPal(verify: () => Promise<Response> | Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
    return await verify()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
  process.env.PAYPAL_CLIENT_ID = 'test-client-id'
  process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret'
  process.env.PAYPAL_ENVIRONMENT = 'sandbox'
})

describe('PayPal transmission time window', () => {
  it('accepts a retry of a message transmitted two days ago', () => {
    const result = evaluatePayPalTransmissionTime(isoAgo(2 * 24 * 60 * 60 * 1000), NOW)
    expect(result.state).toBe('ok')
    expect(result.ageSeconds).toBe(2 * 24 * 60 * 60)
  })

  it('accepts a message at exactly the four day boundary and rejects one past it', () => {
    expect(evaluatePayPalTransmissionTime(isoAgo(PAYPAL_WEBHOOK_MAX_TRANSMISSION_AGE_MS), NOW).state).toBe('ok')
    expect(
      evaluatePayPalTransmissionTime(isoAgo(PAYPAL_WEBHOOK_MAX_TRANSMISSION_AGE_MS + 1000), NOW).state,
    ).toBe('too_old')
  })

  it('rejects a five day old message as too old, not as a bad signature', () => {
    const result = evaluatePayPalTransmissionTime(isoAgo(5 * 24 * 60 * 60 * 1000), NOW)
    expect(result.state).toBe('too_old')
  })

  it('tolerates small clock skew but rejects a far future timestamp', () => {
    // Future skew is a SEPARATE, much tighter bound than the retry window: a four day old
    // retry is wanted, a four day future timestamp is a broken clock or a forgery.
    expect(evaluatePayPalTransmissionTime(isoAgo(-60 * 1000), NOW).state).toBe('ok')
    expect(evaluatePayPalTransmissionTime(isoAgo(-6 * 60 * 1000), NOW).state).toBe('future')
    expect(evaluatePayPalTransmissionTime(isoAgo(-4 * 24 * 60 * 60 * 1000), NOW).state).toBe('future')
  })

  it('separates a missing header from an unparseable one', () => {
    expect(evaluatePayPalTransmissionTime(undefined, NOW).state).toBe('missing')
    expect(evaluatePayPalTransmissionTime('not-a-date', NOW).state).toBe('unparseable')
  })

  it('keeps the boolean helper agreeing with the detailed one', () => {
    expect(isPayPalTransmissionTimeFresh(isoAgo(2 * 24 * 60 * 60 * 1000), NOW)).toBe(true)
    expect(isPayPalTransmissionTimeFresh(isoAgo(5 * 24 * 60 * 60 * 1000), NOW)).toBe(false)
  })
})

describe('verifyPayPalWebhookDetailed', () => {
  it('accepts a valid signature on a 48 hour old retry', async () => {
    const fetchMock = stubPayPal(() => verifyResponse('SUCCESS'))

    const result = await verifyPayPalWebhookDetailed(
      freshHeaders(isoAgo(48 * 60 * 60 * 1000)),
      JSON.stringify({ id: 'WH-1' }),
      'webhook-1',
      NOW,
    )

    expect(result.outcome).toBe('verified')
    expect(result.transmissionAgeSeconds).toBe(48 * 60 * 60)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('reports a stale transmission without calling PayPal', async () => {
    const fetchMock = stubPayPal(() => verifyResponse('SUCCESS'))

    const result = await verifyPayPalWebhookDetailed(
      freshHeaders(isoAgo(5 * 24 * 60 * 60 * 1000)),
      '{}',
      'webhook-1',
      NOW,
    )

    expect(result).toMatchObject({ outcome: 'stale_transmission', reason: 'too_old' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the missing headers and makes no remote request', async () => {
    const fetchMock = stubPayPal(() => verifyResponse('SUCCESS'))
    const headers = freshHeaders(isoAgo(0))
    delete headers['paypal-transmission-sig']

    const result = await verifyPayPalWebhookDetailed(headers, '{}', 'webhook-1', NOW)

    expect(result).toMatchObject({
      outcome: 'missing_signature_headers',
      missingHeaders: ['paypal-transmission-sig'],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON locally rather than as a processing error', async () => {
    const fetchMock = stubPayPal(() => verifyResponse('SUCCESS'))

    const result = await verifyPayPalWebhookDetailed(freshHeaders(isoAgo(0)), 'not json', 'webhook-1', NOW)

    expect(result.outcome).toBe('invalid_payload')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('distinguishes an explicit FAILURE from an outage', async () => {
    stubPayPal(() => verifyResponse('FAILURE'))
    const rejected = await verifyPayPalWebhookDetailed(freshHeaders(isoAgo(0)), '{}', 'webhook-1', NOW)
    expect(rejected).toMatchObject({ outcome: 'signature_rejected', verificationStatus: 'FAILURE' })
  })

  it.each([401, 429, 500])('treats an HTTP %i from PayPal as unavailable, never as a rejection', async (status) => {
    stubPayPal(() => new Response('{}', { status }))

    const result = await verifyPayPalWebhookDetailed(freshHeaders(isoAgo(0)), '{}', 'webhook-1', NOW)

    expect(result.outcome).toBe('verification_unavailable')
  })

  it('treats a thrown network error as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      throw new Error('socket hang up')
    }))

    const result = await verifyPayPalWebhookDetailed(freshHeaders(isoAgo(0)), '{}', 'webhook-1', NOW)

    expect(result.outcome).toBe('verification_unavailable')
  })

  it('treats a malformed 200 response as unavailable, not as success', async () => {
    stubPayPal(() => new Response('<html>maintenance</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))

    const result = await verifyPayPalWebhookDetailed(freshHeaders(isoAgo(0)), '{}', 'webhook-1', NOW)

    expect(result.outcome).toBe('verification_unavailable')
  })

  it('never authorises processing on an unexpected verification_status', async () => {
    stubPayPal(() => verifyResponse('MAYBE'))

    const result = await verifyPayPalWebhookDetailed(freshHeaders(isoAgo(0)), '{}', 'webhook-1', NOW)

    expect(result.outcome).toBe('verification_unavailable')
  })
})

describe('verifyPayPalWebhook boolean wrapper', () => {
  // The legacy /api/webhooks/paypal route still checks `!isValid`. If this ever returned the
  // diagnostic object instead, every failure object would be truthy and the check would
  // silently pass. Keeping the boolean shape is the whole point of this test.
  it('returns a boolean, true only on an explicit SUCCESS', async () => {
    stubPayPal(() => verifyResponse('SUCCESS'))
    const accepted = await verifyPayPalWebhook(freshHeaders(new Date().toISOString()), '{}', 'webhook-1')
    expect(accepted).toBe(true)

    stubPayPal(() => verifyResponse('FAILURE'))
    const rejected = await verifyPayPalWebhook(freshHeaders(new Date().toISOString()), '{}', 'webhook-1')
    expect(rejected).toBe(false)
    expect(typeof rejected).toBe('boolean')
  })

  it('returns false rather than throwing when PayPal is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) return tokenResponse()
      throw new Error('ECONNRESET')
    }))

    await expect(
      verifyPayPalWebhook(freshHeaders(new Date().toISOString()), '{}', 'webhook-1'),
    ).resolves.toBe(false)
  })
})
