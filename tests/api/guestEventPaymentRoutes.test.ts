import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The guest payment-link routes (BK-029, customer bookings review of 24 October 2026) answered a
 * refusal with the bare reason ("hold_expired"), which the page showed as it stood, and crashed
 * with a 500 when the capture threw after PayPal may have taken the money.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ from: vi.fn() })) }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/events/payment-alerts', () => ({ alertEventPaymentNeedsAPerson: vi.fn(async () => undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/events/event-payments', () => ({
  createEventPayPalOrderByRawToken: vi.fn(),
  captureEventPayPalOrderByRawToken: vi.fn(),
  sendEventPaymentConfirmationSms: vi.fn(async () => ({ success: true })),
  sendEventPaymentManualReviewSms: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendEventPaymentManualReviewEmail: vi.fn(async () => undefined),
}))

import { POST as createOrder } from '@/app/g/[token]/event-payment/paypal/create-order/route'
import { POST as captureOrder } from '@/app/g/[token]/event-payment/paypal/capture-order/route'
import { captureEventPayPalOrderByRawToken, createEventPayPalOrderByRawToken } from '@/lib/events/event-payments'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { EVENT_PAYMENT_CAPTURE_FALLBACK, EVENT_PAYMENT_START_FALLBACK } from '@/lib/events/event-payment-reasons'

const context = { params: Promise.resolve({ token: 'raw-token' }) }
const createRequest = () => new NextRequest('http://localhost/g/raw-token/event-payment/paypal/create-order', { method: 'POST' })
const captureRequest = () => new NextRequest('http://localhost/g/raw-token/event-payment/paypal/capture-order', {
  method: 'POST', body: JSON.stringify({ orderId: 'ORDER-1' }), headers: { 'content-type': 'application/json' },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: true } as never)
})

describe('starting a payment from the guest link', () => {
  it('answers a refusal with a sentence for the guest, keeping the reason as the code', async () => {
    vi.mocked(createEventPayPalOrderByRawToken).mockResolvedValueOnce({ state: 'blocked', reason: 'hold_expired' })

    const response = await createOrder(createRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body).toMatchObject({ success: false, error: 'hold_expired', code: 'hold_expired' })
    expect(body.message).toContain('01753 682707')
    expect(body.message).not.toContain('hold_expired')
  })

  it('answers the throttle with a sentence, not "rate_limited"', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValueOnce({ allowed: false } as never)

    const response = await createOrder(createRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body.message).toBe('There have been too many attempts to pay for this booking online. Please call 01753 682707 and we will help.')
    expect(createEventPayPalOrderByRawToken).not.toHaveBeenCalled()
  })

  it('answers a failure to reach PayPal with the start sentence, saying nothing was charged', async () => {
    vi.mocked(createEventPayPalOrderByRawToken).mockRejectedValueOnce(new Error('PayPal 503'))

    const response = await createOrder(createRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.message).toBe(EVENT_PAYMENT_START_FALLBACK)
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('confirming a payment from the guest link', () => {
  it('answers a refusal at capture with the cautious sentence', async () => {
    vi.mocked(captureEventPayPalOrderByRawToken).mockResolvedValueOnce({ state: 'blocked', reason: 'amount_or_reference_mismatch' })

    const response = await captureOrder(captureRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ success: false, code: 'amount_or_reference_mismatch' })
    expect(body.message).toContain('before paying again')
  })

  it('answers a throw after approval with the cautious sentence and an error log, not a crash', async () => {
    vi.mocked(captureEventPayPalOrderByRawToken).mockRejectedValueOnce(new Error('connection reset'))

    const response = await captureOrder(captureRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.message).toBe(EVENT_PAYMENT_CAPTURE_FALLBACK)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('capture failed'), expect.anything())
  })

  it('answers the throttle at capture with the cautious sentence', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValueOnce({ allowed: false } as never)

    const response = await captureOrder(captureRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body.message).toBe(EVENT_PAYMENT_CAPTURE_FALLBACK)
    expect(captureEventPayPalOrderByRawToken).not.toHaveBeenCalled()
  })
})
