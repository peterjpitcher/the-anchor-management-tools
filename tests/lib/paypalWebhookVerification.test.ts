import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isPayPalTransmissionTimeFresh, verifyPayPalWebhook } from '@/lib/paypal'

describe('PayPal webhook verification guards', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('rejects stale transmission times before remote verification', async () => {
    const headers = {
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api-m.paypal.com/certs/test',
      'paypal-transmission-id': 'transmission-1',
      'paypal-transmission-sig': 'signature',
      'paypal-transmission-time': '2026-06-24T10:00:00.000Z',
    }

    const result = await verifyPayPalWebhook(headers, '{}', 'webhook-1')

    expect(result).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects missing signature headers before remote verification', async () => {
    const result = await verifyPayPalWebhook({
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api-m.paypal.com/certs/test',
      'paypal-transmission-id': 'transmission-1',
      'paypal-transmission-time': new Date().toISOString(),
    }, '{}', 'webhook-1')

    expect(result).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('treats only recent transmission times as fresh', () => {
    const now = Date.parse('2026-06-24T12:00:00.000Z')

    expect(isPayPalTransmissionTimeFresh('2026-06-24T11:56:00.000Z', now)).toBe(true)
    expect(isPayPalTransmissionTimeFresh('2026-06-24T11:54:59.000Z', now)).toBe(false)
  })
})
