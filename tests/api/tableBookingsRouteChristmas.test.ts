import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

// Christmas through the public booking route (spec tasks/christmas-food-link/spec.md section 3.6,
// owner decisions D1, D2, D13 and D15 of 6 November 2026): the new website payload books through
// the ordinary path with an email, the old one keeps working, and every refusal a guest can act
// on comes back as a coded 400 with the phone number.

vi.mock('@/lib/phone/uk-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/phone/uk-mobile')>()),
  isUkMobile: () => true,
}))

vi.mock('@/lib/api/auth', () => ({
  isApiKeyAuthenticated: vi.fn().mockResolvedValue(true),
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message: error } }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  getIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
  markIdempotencyClaimCommitted: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/utils', () => ({ formatPhoneForStorage: vi.fn((value: string) => value) }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/bookings/contact-email', () => ({ recordBookingContactEmail: vi.fn() }))

vi.mock('@/lib/table-bookings/bookings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/bookings')>()),
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({
    notificationChannel: 'email',
    notificationSent: true,
    sms: null,
  }),
}))

vi.mock('@/lib/table-bookings/period-lookup', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/period-lookup')>()),
  loadBookingPeriodContext: vi.fn(),
}))

vi.mock('@/lib/table-bookings/party-limit', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/party-limit')>()),
  readTableBookingPartyLimit: vi.fn().mockResolvedValue(20),
  // The online Christmas ceiling (owner decision of 10 November 2026).
  readChristmasOnlinePartyLimit: vi.fn().mockResolvedValue(26),
}))

vi.mock('@/lib/table-bookings/christmas-one-course', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/christmas-one-course')>()),
  recordOneCourseInsideCutoff: vi.fn().mockResolvedValue('not_needed'),
}))

const { warn, error, info } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { claimIdempotencyKey } from '@/lib/api/idempotency'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { loadBookingPeriodContext } from '@/lib/table-bookings/period-lookup'
import { POST } from '@/app/api/table-bookings/route'

const CHRISTMAS_PERIOD = {
  id: 'period-xmas',
  periodKind: 'christmas',
  minNoticeHours: 192,
  minPartySize: 4,
}

const CONFIRMED = {
  state: 'confirmed',
  status: 'confirmed',
  table_booking_id: 'booking-xmas',
  booking_reference: 'TB-XMAS1',
  reason: null,
  hold_expires_at: null,
  start_datetime: '2026-12-12T19:00:00.000Z',
  party_size: 6,
  table_name: 'Table 4',
  booking_type: 'christmas',
}

let rpc: Mock

function mockRpc(result: { data?: unknown; error?: unknown }) {
  rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }))
  ;(createAdminClient as unknown as Mock).mockReturnValue({ rpc })
}

function newPayload(overrides: Record<string, unknown> = {}) {
  return {
    phone: '+447700900123',
    first_name: 'Pat',
    email: 'organiser@example.com',
    date: '2026-12-12',
    time: '19:00',
    party_size: 6,
    purpose: 'food',
    booking_period_id: '6f1c2b4e-8d3a-4c7e-9b21-3a5d7e9f1c20',
    booking_period_answer: true,
    ...overrides,
  }
}

async function post(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost/api/table-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
    body: JSON.stringify(body),
  })
  const response = await POST(request as never)
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(ensureCustomerForPhone as unknown as Mock).mockResolvedValue({ customerId: 'customer-1', resolutionError: undefined })
  ;(loadBookingPeriodContext as unknown as Mock).mockResolvedValue({ period: CHRISTMAS_PERIOD })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('public table bookings route: the Christmas payloads', () => {
  it('books the new payload through the ordinary path and says a pre-order is needed', async () => {
    mockRpc({ data: { ...CONFIRMED, booking_period_requires_preorder: true } })

    const result = await post(newPayload())

    expect(result.status).toBe(201)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('create_table_booking_public_v06')
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_booking_purpose: 'food',
      p_booking_period_id: '6f1c2b4e-8d3a-4c7e-9b21-3a5d7e9f1c20',
      p_booking_period_answer: true,
    })
    expect(result.body).toMatchObject({ success: true, data: { state: 'confirmed', requires_preorder: true } })
  })

  it('keeps the old course-count payload working, and still reports a pre-order', async () => {
    // create_table_booking_christmas_v01 answers false for a party all on 1 course.
    mockRpc({ data: { ...CONFIRMED, booking_period_requires_preorder: false } })

    const result = await post(newPayload({ email: undefined, christmas_course_counts: [1, 1, 1, 1, 1, 1] }))

    expect(result.status).toBe(201)
    expect(rpc.mock.calls[0][0]).toBe('create_table_booking_christmas_v01')
    expect(result.body).toMatchObject({ success: true, data: { requires_preorder: true } })
  })

  // Owner decision of 10 November 2026: a sit-down Christmas dinner books online for 4 to 26 guests.
  it('takes a Christmas dinner of 26 online, on both payloads', async () => {
    mockRpc({ data: { ...CONFIRMED, party_size: 26, booking_period_requires_preorder: true } })

    const result = await post(newPayload({ party_size: 26 }))

    expect(result.status).toBe(201)
    expect(rpc.mock.calls[0][0]).toBe('create_table_booking_public_v06')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_party_size: 26, p_booking_period_answer: true })

    mockRpc({ data: { ...CONFIRMED, party_size: 26, booking_period_requires_preorder: false } })
    const old = await post(newPayload({ party_size: 26, email: undefined, christmas_course_counts: Array(26).fill(1) }))

    expect(old.status).toBe(201)
    expect(rpc.mock.calls[0][0]).toBe('create_table_booking_christmas_v01')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_course_counts: Array(26).fill(1) })
  })

  it('refuses a Christmas dinner of 27 online with the phone number, on both payloads', async () => {
    // create_table_booking_public_v06 refuses above its Christmas ceiling with too_large_party.
    mockRpc({ data: { state: 'blocked', reason: 'too_large_party', table_booking_id: null } })

    const result = await post(newPayload({ party_size: 27 }))

    expect(result.status).toBe(400)
    expect(result.body).toEqual({
      success: false,
      error: {
        code: 'CHRISTMAS_PARTY_TOO_LARGE',
        message:
          "We take Christmas bookings online for up to 26 guests. For a bigger group, call us on 01753 682707 and we'll book it for you.",
      },
    })

    // The course-count payload reaches create_table_booking_christmas_v01, which says the range.
    mockRpc({ error: { code: '22023', message: 'Christmas bookings are for 4 to 26 guests.', details: null, hint: null } })
    const old = await post(newPayload({ party_size: 27, email: undefined, christmas_course_counts: Array(27).fill(1) }))

    expect(old.status).toBe(400)
    expect(old.body.error.code).toBe('CHRISTMAS_PARTY_TOO_LARGE')
    expect(old.body.error.message).toContain('up to 26 guests')
    expect(old.body.error.message).toContain('01753 682707')
  })

  it('asks for an email on the new payload before touching the database', async () => {
    mockRpc({ data: CONFIRMED })

    const result = await post(newPayload({ email: undefined }))

    expect(result.status).toBe(400)
    expect(result.body.error.code).toBe('CHRISTMAS_EMAIL_REQUIRED')
    expect(result.body.error.message).toContain('01753 682707')
    expect(rpc).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
  })

  it('does not ask an ordinary food booking for an email', async () => {
    ;(loadBookingPeriodContext as unknown as Mock).mockResolvedValue({ period: null })
    mockRpc({ data: { ...CONFIRMED, booking_type: 'regular' } })

    const result = await post(newPayload({ email: undefined, booking_period_answer: undefined, booking_period_id: undefined }))

    expect(result.status).toBe(201)
    expect(loadBookingPeriodContext).not.toHaveBeenCalled()
    expect(result.body.data.requires_preorder).toBe(false)
  })
})

describe('public table bookings route: Christmas refusals', () => {
  it.each([
    ['Christmas bookings are for 4 guests or more.', 2, 'CHRISTMAS_PARTY_TOO_SMALL', 'are for 4 guests or more'],
    // Raised by core until 20261110185254; still matched for a request in flight as it lands.
    [
      'Christmas bookings for more than 20 guests are arranged as private hire. Please call us.',
      30,
      'CHRISTMAS_PARTY_TOO_LARGE',
      'up to 26 guests',
    ],
    ['Christmas bookings need at least 192 hours notice.', 6, 'CHRISTMAS_NOTICE', 'up to 8 days ahead'],
    ['Christmas bookings are not open for that date.', 6, 'CHRISTMAS_NOT_AVAILABLE', "can't take a Christmas booking"],
  ])('maps the exception "%s" to a coded 400', async (message, partySize, code, wording) => {
    mockRpc({ error: { code: 'P0001', message, details: null, hint: null } })

    const result = await post(newPayload({ party_size: partySize, purpose: 'christmas', booking_period_answer: undefined }))

    expect(result.status).toBe(400)
    expect(result.body).toEqual({ success: false, error: { code, message: expect.stringContaining(wording) } })
    expect(result.body.error.message).toContain('01753 682707')
  })

  it.each([
    ['period_party_too_small', 3, 'CHRISTMAS_PARTY_TOO_SMALL'],
    ['period_party_too_large', 22, 'CHRISTMAS_PARTY_TOO_LARGE'],
    ['too_large_party', 22, 'CHRISTMAS_PARTY_TOO_LARGE'],
    ['outside_hours', 6, 'CHRISTMAS_NOT_AVAILABLE'],
    ['period_not_available', 6, 'CHRISTMAS_NOT_AVAILABLE'],
  ])('maps the blocked reason %s to a coded 400', async (reason, partySize, code) => {
    mockRpc({ data: { state: 'blocked', reason, table_booking_id: null } })

    const result = await post(newPayload({ party_size: partySize }))

    expect(result.status).toBe(400)
    expect(result.body.error.code).toBe(code)
    expect(result.body.error.message).toContain('01753 682707')
  })

  it('maps cut_off inside the notice to CHRISTMAS_NOTICE with the days from the period', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
    mockRpc({ data: { state: 'blocked', reason: 'cut_off', table_booking_id: null } })

    const result = await post(newPayload({ date: '2026-11-12' }))

    expect(result.status).toBe(400)
    expect(result.body.error).toEqual({
      code: 'CHRISTMAS_NOTICE',
      message:
        "We take Christmas bookings online up to 8 days ahead, so you've time to choose your food. For a sooner date, call us on 01753 682707 and we'll see what we can do.",
    })
  })

  it('leaves a full slot as the ordinary blocked answer the website already words', async () => {
    mockRpc({ data: { state: 'blocked', reason: 'slot_full', table_booking_id: null } })

    const result = await post(newPayload())

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ success: true, data: { state: 'blocked', requires_preorder: null } })
  })
})
