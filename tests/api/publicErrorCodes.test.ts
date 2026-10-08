import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Every refusal from a public booking, enquiry or payment route carries a
 * stable code. Site review of 7 October 2026, findings MG-003, MG-005 and
 * PY-007, and the website's hand-over note of 7 October ("a stable code on
 * every error from the public routes, and sentences rather than bare reason
 * codes from the event payment routes").
 *
 * The website turns an answer into a sentence for the guest by its code. Where
 * a route sent only a sentence, the website had to guess from the wording, and
 * rewording a sentence here could silently change what a guest was shown.
 *
 * `error` is unchanged on every route, so the website as it stands today reads
 * what it read before. `code` is added beside it.
 */

const createEventPayPalOrderByBookingId = vi.hoisted(() => vi.fn())
const captureEventPayPalOrderByBookingId = vi.hoisted(() => vi.fn())
const createBooking = vi.hoisted(() => vi.fn())
const claimIdempotencyKey = vi.hoisted(() => vi.fn())
const getIdempotencyKey = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))

vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn(
      async (handler: (request: Request, apiKey: { id: string }) => Promise<Response>, _permissions: string[], request: Request) =>
        handler(request, { id: 'api-key-1' })
    ),
    getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
    isApiKeyAuthenticated: vi.fn().mockResolvedValue(true),
  }
})

vi.mock('@/lib/events/event-payments', () => ({
  createEventPayPalOrderByBookingId,
  captureEventPayPalOrderByBookingId,
  sendEventPaymentConfirmationSms: vi.fn(),
  sendEventPaymentConfirmationEmail: vi.fn(),
  sendEventPaymentManualReviewSms: vi.fn(),
  sendEventPaymentManualReviewEmail: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: { createBooking },
}))
vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey,
  computeIdempotencyRequestHash: (payload: unknown) => JSON.stringify(payload),
  claimIdempotencyKey,
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/communications/web-enquiry', () => ({
  recordPrivateBookingWebEnquiryCommunication: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingCreatedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))
vi.mock('@/services/consent', () => ({
  ConsentService: { applyBookingContactConsent: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
  getClientIp: () => '203.0.113.1',
}))

import { POST as createEventOrder } from '@/app/api/external/event-bookings/[id]/paypal/create-order/route'
import { POST as captureEventOrder } from '@/app/api/external/event-bookings/[id]/paypal/capture-order/route'
import { POST as enquiryPost } from '@/app/api/private-booking-enquiry/route'
import { createRateLimiter } from '@/lib/rate-limit'
import {
  EVENT_PAYMENT_CAPTURE_FALLBACK,
  EVENT_PAYMENT_START_FALLBACK,
  KNOWN_EVENT_PAYMENT_REASONS,
  eventPaymentReasonSentence,
  eventPaymentRefusal,
} from '@/lib/events/event-payment-reasons'
import {
  payPalDepositCaptureBlockCode,
  payPalDepositCaptureBlockMessage,
} from '@/lib/table-bookings/paypal-deposit'

const BARE_CODE = /^[a-z0-9_]+$/i
const STABLE_CODE = /^[A-Z][A-Z0-9_]+$/
const LONG_DASH = String.fromCharCode(8212)
const PARAMS = { params: Promise.resolve({ id: 'booking-1' }) }

function json(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getIdempotencyKey.mockReturnValue('idem-1')
  claimIdempotencyKey.mockResolvedValue({ state: 'claimed' })
  createBooking.mockResolvedValue({ id: 'pb-1', customer_id: 'cust-1', booking_reference: 'PB-1' })
})

describe('event payment refusals carry a code and a sentence', () => {
  it('names every reason the payment code can answer with', () => {
    // Read from the source, so a reason added there without a sentence fails here.
    const source = readFileSync(join(process.cwd(), 'src/lib/events/event-payments.ts'), 'utf8')
    const reasons = new Set(
      [...source.matchAll(/reason:\s*(?:[^'\n]*\?\s*[^'\n]*:\s*)?'([a-z_]+)'/g)].map((match) => match[1])
    )

    expect(reasons.size).toBeGreaterThanOrEqual(10)
    for (const reason of reasons) {
      expect(KNOWN_EVENT_PAYMENT_REASONS, `no sentence for "${reason}"`).toContain(reason)
    }
  })

  it.each(KNOWN_EVENT_PAYMENT_REASONS)('"%s" has a sentence with the phone number, not a code', (reason) => {
    for (const step of ['start', 'capture'] as const) {
      const sentence = eventPaymentReasonSentence(reason, step)
      expect(sentence).toContain('01753 682707')
      expect(sentence).not.toMatch(BARE_CODE)
      expect(sentence).not.toContain(reason)
      expect(sentence).not.toContain(LONG_DASH)
    }
  })

  it.each([
    'payment_order_not_found',
    'order_mismatch',
    'amount_or_reference_mismatch',
    'capture_amount_mismatch',
    'capture_reference_mismatch',
    'confirmation_blocked',
    'capture_already_captured_pending_confirmation',
  ])('"%s" tells the guest to ring before paying again, because money may have moved', (reason) => {
    expect(eventPaymentReasonSentence(reason, 'capture')).toMatch(/before paying again/)
  })

  it('is cautious about an unknown reason at capture, and plain about one at the start', () => {
    expect(eventPaymentReasonSentence('something_new', 'capture')).toBe(EVENT_PAYMENT_CAPTURE_FALLBACK)
    expect(EVENT_PAYMENT_CAPTURE_FALLBACK).toMatch(/before paying again/)
    expect(eventPaymentReasonSentence(undefined, 'start')).toBe(EVENT_PAYMENT_START_FALLBACK)
    expect(EVENT_PAYMENT_START_FALLBACK).toContain('Nothing has been charged')
  })

  it('keeps `error` as the bare reason so the website as it stands reads what it did', () => {
    expect(eventPaymentRefusal('hold_expired', 'start')).toMatchObject({
      success: false,
      error: 'hold_expired',
      code: 'hold_expired',
    })
    expect(eventPaymentRefusal(undefined, 'capture')).toMatchObject({ error: 'payment_blocked', code: 'payment_blocked' })
  })

  it('create-order answers a refusal with the reason, the code and the sentence', async () => {
    createEventPayPalOrderByBookingId.mockResolvedValue({ state: 'blocked', reason: 'hold_expired' })
    const response = await createEventOrder(json('https://example.com/api/external/event-bookings/booking-1/paypal/create-order', {}), PARAMS)
    const payload = await response.json()

    expect(response.status).toBe(410)
    expect(payload).toEqual({
      success: false,
      error: 'hold_expired',
      code: 'hold_expired',
      message: eventPaymentReasonSentence('hold_expired', 'start'),
    })
  })

  it('capture-order answers a refusal the same way and confirms nothing', async () => {
    captureEventPayPalOrderByBookingId.mockResolvedValue({ state: 'blocked', reason: 'capture_amount_mismatch' })
    const response = await captureEventOrder(
      json('https://example.com/api/external/event-bookings/booking-1/paypal/capture-order', { orderId: 'ORDER-1' }),
      PARAMS
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.success).toBe(false)
    expect(payload.code).toBe('capture_amount_mismatch')
    expect(payload.message).toMatch(/before paying again/)
    expect(payload.state).toBeUndefined()
  })

  it('capture-order answers a missing order id with VALIDATION_ERROR', async () => {
    const response = await captureEventOrder(
      json('https://example.com/api/external/event-bookings/booking-1/paypal/capture-order', {}),
      PARAMS
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
    expect(captureEventPayPalOrderByBookingId).not.toHaveBeenCalled()
  })
})

describe('table deposit refusals carry a code beside the sentence', () => {
  it.each([
    ['already_completed', 'DEPOSIT_ALREADY_PAID'],
    ['booking_closed', 'BOOKING_NOT_PAYABLE'],
    ['hold_expired', 'PAYMENT_HOLD_EXPIRED'],
    ['hold_missing', 'PAYMENT_HOLD_MISSING'],
    ['booking_not_pending_payment', 'BOOKING_NOT_PENDING_PAYMENT'],
  ] as const)('%s is %s', (reason, code) => {
    expect(payPalDepositCaptureBlockCode(reason)).toBe(code)
    expect(payPalDepositCaptureBlockMessage(reason)).not.toMatch(BARE_CODE)
  })

  it.each([
    'src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts',
    'src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts',
    'src/app/api/external/create-booking/route.ts',
    'src/app/api/private-booking-enquiry/route.ts',
  ])('%s has no refusal without a code', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    // Every object literal that carries an `error:` and is handed to NextResponse.json.
    const refusals = [...source.matchAll(/NextResponse\.json\(\s*\{([^{}]*\berror:[^{}]*)\}/g)]
      .map((match) => match[1])
      // The enquiry route's own bot check refusal. No website request reaches it
      // (the website always sends its key), and the branch that makes the key
      // compulsory removes the block altogether, so it is left as it is here.
      .filter((refusal) => !refusal.includes('turnstile.error'))

    expect(refusals.length).toBeGreaterThan(3)
    for (const refusal of refusals) {
      expect(refusal, `refusal without a code in ${route}: ${refusal.trim().slice(0, 80)}`).toMatch(/\bcode:/)
    }
  })
})

describe('private hire enquiry refusals carry a code', () => {
  const VALID = { phone: '+447700900000', name: 'Alice Booker', date: '2026-11-10', time: '19:00', group_size: 30 }
  const URL = 'https://example.com/api/private-booking-enquiry'
  const KEY = { 'x-api-key': 'test-key', 'x-forwarded-for': '198.51.100.7' }

  async function answer(request: NextRequest): Promise<{ status: number; payload: any }> {
    const response = await enquiryPost(request)
    return { status: response.status, payload: await response.json() }
  }

  it('a body that is not JSON is VALIDATION_ERROR', async () => {
    const { status, payload } = await answer(json(URL, 'not json', KEY))

    expect(status).toBe(400)
    expect(payload).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
    expect(typeof payload.error).toBe('string')
  })

  it('no idempotency key is IDEMPOTENCY_KEY_REQUIRED', async () => {
    getIdempotencyKey.mockReturnValue(null)
    const { status, payload } = await answer(json(URL, VALID, KEY))

    expect(status).toBe(400)
    expect(payload.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('a field the guest must correct is VALIDATION_ERROR and keeps its sentence', async () => {
    const { status, payload } = await answer(json(URL, { ...VALID, group_size: 500 }, KEY))

    expect(status).toBe(400)
    expect(payload.code).toBe('VALIDATION_ERROR')
    expect(payload.error).toContain('01753 682707')
  })

  it('a reused key with a different enquiry is IDEMPOTENCY_KEY_CONFLICT', async () => {
    claimIdempotencyKey.mockResolvedValue({ state: 'conflict' })
    const { status, payload } = await answer(json(URL, VALID, KEY))

    expect(status).toBe(409)
    expect(payload.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
  })

  it('an enquiry still being saved is IDEMPOTENCY_KEY_IN_PROGRESS', async () => {
    claimIdempotencyKey.mockResolvedValue({ state: 'in_progress' })
    const { status, payload } = await answer(json(URL, VALID, KEY))

    expect(status).toBe(409)
    expect(payload.code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS')
  })

  it('a save that fails is a 500 with INTERNAL_ERROR, never a success', async () => {
    createBooking.mockRejectedValue(new Error('database is down'))
    const { status, payload } = await answer(json(URL, VALID, KEY))

    expect(status).toBe(500)
    expect(payload).toMatchObject({ success: false, code: 'INTERNAL_ERROR' })
    expect(payload.booking_id).toBeUndefined()
  })

  it.each(['VALIDATION_ERROR', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_CONFLICT', 'IDEMPOTENCY_KEY_IN_PROGRESS', 'INTERNAL_ERROR'])(
    '%s is the shape of code the website already knows',
    (code) => {
      expect(code).toMatch(STABLE_CODE)
    }
  )
})

describe('the shared per-address limiter', () => {
  it('answers 429 with RATE_LIMIT_EXCEEDED beside its sentence', async () => {
    const limiter = createRateLimiter({
      name: `codes-test-${Math.random()}`,
      windowMs: 60_000,
      max: 1,
      message: 'Too many requests. Please try again shortly.',
    })
    const request = () => new NextRequest('https://example.com/api/anything', { headers: { 'x-forwarded-for': '198.51.100.9' } })

    expect(await limiter(request())).toBeNull()
    const refused = await limiter(request())

    expect(refused?.status).toBe(429)
    expect(await refused?.json()).toEqual({
      error: 'Too many requests. Please try again shortly.',
      code: 'RATE_LIMIT_EXCEEDED',
    })
    expect(refused?.headers.get('Retry-After')).toBeTruthy()
  })
})
