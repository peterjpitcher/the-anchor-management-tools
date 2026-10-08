import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/private-booking-enquiry needs a valid API key holding
 * create:bookings. Site review of 7 October 2026, finding MG-006.
 *
 * The route used to accept either a valid key or a passed bot check, so the key
 * was never required and its permission was never tested. The guard that stood
 * in for a test read the route's source text and looked for a function name.
 * This suite calls the handler through the real withApiAuth, with only the
 * database behind it replaced, so it proves what a caller is actually told.
 *
 * The retired POST /api/public/private-booking is covered at the bottom: it
 * answers 410 whoever asks, key or no key, and creates nothing.
 */

type KeyRow = {
  id: string
  name: string
  permissions: string[]
  rate_limit: number
  is_active: boolean
  expires_at: string | null
}

const db = vi.hoisted(() => ({
  keyRows: [] as unknown[],
  keyError: null as { message: string } | null,
  usageCount: 0,
  usageError: null as { message: string } | null,
  requestHeaders: new Headers(),
}))

vi.mock('next/headers', () => ({
  headers: async () => db.requestHeaders,
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'api_keys') {
        const lookup: Record<string, unknown> = {}
        lookup.select = () => lookup
        lookup.eq = () => lookup
        lookup.then = (resolve: (value: unknown) => unknown) =>
          resolve({ data: db.keyError ? null : db.keyRows, error: db.keyError })
        const touch: Record<string, unknown> = {}
        touch.eq = () => touch
        touch.select = () => touch
        touch.maybeSingle = async () => ({ data: { id: 'key-1' }, error: null })
        return { select: () => lookup, update: () => touch }
      }
      if (table === 'api_usage') {
        const count: Record<string, unknown> = {}
        count.eq = () => count
        count.gte = () => count
        count.then = (resolve: (value: unknown) => unknown) =>
          resolve({ count: db.usageError ? null : db.usageCount, error: db.usageError })
        return { select: () => count, insert: async () => ({ error: null }) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

const createBooking = vi.fn()

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: {
    createBooking: (...args: unknown[]) => createBooking(...args),
  },
}))

vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey: () => 'test-idempotency-key',
  computeIdempotencyRequestHash: (payload: unknown) => JSON.stringify(payload),
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: () => async () => null,
}))

// A passing bot check, deliberately. If the keyless branch ever comes back, a
// request with no key would sail through this and the 401 cases below fail.
const verifyTurnstileToken = vi.fn().mockResolvedValue({ success: true })
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: (...args: unknown[]) => verifyTurnstileToken(...args),
  getClientIp: () => '203.0.113.1',
}))

vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatPhoneForStorage: (phone: string) => phone,
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/communications/web-enquiry', () => ({
  recordPrivateBookingWebEnquiryCommunication: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingCreatedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/consent', () => ({
  ConsentService: { applyBookingContactConsent: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { POST as enquiryPost } from '@/app/api/private-booking-enquiry/route'
import { POST as retiredPost } from '@/app/api/public/private-booking/route'

const VALID_BODY = {
  phone: '+447700900000',
  name: 'Alice Booker',
  date: '2026-11-10',
  time: '19:00',
  group_size: 30,
  notes: 'Milestone birthday',
}

function key(permissions: string[]): KeyRow {
  return {
    id: 'key-1',
    name: 'website',
    permissions,
    rate_limit: 1000,
    is_active: true,
    expires_at: null,
  }
}

function enquiry(headers: Record<string, string> = {}): Request {
  const all = new Headers({
    'content-type': 'application/json',
    'idempotency-key': 'test-idempotency-key',
    // A token is always sent, to show it buys nothing without a key.
    'x-turnstile-token': 'a-token-that-would-pass',
    ...headers,
  })
  db.requestHeaders = all
  return new Request('http://localhost/api/private-booking-enquiry', {
    method: 'POST',
    headers: all,
    body: JSON.stringify(VALID_BODY),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.keyRows = []
  db.keyError = null
  db.usageCount = 0
  db.usageError = null
  createBooking.mockResolvedValue({ id: 'pb-1', customer_id: 'cust-1', booking_reference: 'PB-1' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /api/private-booking-enquiry authentication', () => {
  it('answers 401 with no key, even with a bot check token that would pass', async () => {
    const response = await enquiryPost(enquiry() as never)
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } })
    expect(createBooking).not.toHaveBeenCalled()
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
  })

  it('answers 401 for a key nobody issued', async () => {
    db.keyRows = []
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_made_up' }) as never)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('answers 401 for a key that has expired', async () => {
    db.keyRows = [{ ...key(['create:bookings']), expires_at: '2020-01-01T00:00:00Z' }]
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_expired' }) as never)

    expect(response.status).toBe(401)
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('answers 503, not 401 and not a failed bot check, when the key cannot be looked up', async () => {
    db.keyError = { message: 'connection refused' }
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.error.code).toBe('AUTH_UNAVAILABLE')
    expect(createBooking).not.toHaveBeenCalled()
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
  })

  it.each([
    ['read:events'],
    ['read:events', 'read:menu', 'read:customers'],
    ['payments:capture'],
  ])('answers 403 for a valid key holding only %s', async (...permissions) => {
    db.keyRows = [key(permissions)]
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('answers 503 when the hourly allowance cannot be checked, and creates nothing', async () => {
    db.keyRows = [key(['create:bookings'])]
    db.usageError = { message: 'timeout' }
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)

    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('RATE_LIMIT_UNAVAILABLE')
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('answers 429 when the key has used its hourly allowance', async () => {
    db.keyRows = [key(['create:bookings'])]
    db.usageCount = 1000
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)

    expect(response.status).toBe(429)
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('creates the enquiry for a valid key holding create:bookings', async () => {
    db.keyRows = [key(['read:events', 'create:bookings'])]
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({ success: true, state: 'enquiry_created', booking_id: 'pb-1' })
    expect(createBooking).toHaveBeenCalledTimes(1)
    expect(createBooking.mock.calls[0][0]).toMatchObject({ is_web_enquiry: true, source: 'website' })
  })

  it('accepts the key as a bearer token, as the website may send it either way', async () => {
    db.keyRows = [key(['create:bookings'])]
    const response = await enquiryPost(enquiry({ authorization: 'Bearer anch_real' }) as never)

    expect(response.status).toBe(201)
  })

  it('creates the enquiry for a wildcard key', async () => {
    db.keyRows = [key(['*'])]
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)

    expect(response.status).toBe(201)
  })

  it('tells the caller when saving the enquiry fails, and does not report success', async () => {
    db.keyRows = [key(['create:bookings'])]
    createBooking.mockRejectedValue(new Error('database is down'))
    const response = await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.success).toBe(false)
  })

  it('never runs the bot check: the website verifies its own widget and sends its key', async () => {
    db.keyRows = [key(['create:bookings'])]
    await enquiryPost(enquiry({ 'x-api-key': 'anch_real' }) as never)

    expect(verifyTurnstileToken).not.toHaveBeenCalled()
  })
})

describe('retired POST /api/public/private-booking', () => {
  function retired(headers: Record<string, string> = {}): Request {
    const all = new Headers({ 'content-type': 'application/json', ...headers })
    db.requestHeaders = all
    return new Request('http://localhost/api/public/private-booking', {
      method: 'POST',
      headers: all,
      body: JSON.stringify({ customer_first_name: 'Pat', contact_phone: '+447700900123' }),
    })
  }

  it.each([
    ['no key', {}],
    ['a valid key', { 'x-api-key': 'anch_real' }],
    ['a bot check token', { 'x-turnstile-token': 'a-token-that-would-pass' }],
  ])('answers 410 Gone with %s and creates nothing', async (_label, headers) => {
    db.keyRows = [key(['*'])]
    const response = await retiredPost(retired(headers) as never)
    const payload = await response.json()

    expect(response.status).toBe(410)
    expect(payload).toMatchObject({ success: false, error: { code: 'ENDPOINT_RETIRED' } })
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('gives a sentence with the phone number and points at the route that replaced it', async () => {
    const response = await retiredPost(retired() as never)
    const payload = await response.json()

    expect(payload.error.message).toContain('01753 682707')
    expect(response.headers.get('Link')).toContain('/api/private-booking-enquiry')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('does not read the body it is sent', async () => {
    const request = retired()
    await retiredPost(request as never)

    expect(request.bodyUsed).toBe(false)
  })
})
