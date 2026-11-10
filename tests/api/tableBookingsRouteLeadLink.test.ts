import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/table-bookings: the optional lead_ref (Christmas funnel spec, owner decision 5). When
 * the website books, the unfinished-booking record it saved at the details step is linked to the
 * new booking, so no follow-up email goes. A failed link is logged by linkLeadToBooking and never
 * fails or changes the booking, and lead_ref stays out of the idempotency hash.
 *
 * The harness is the one tests/api/tableBookingsRoutePageSource.test.ts uses: Supabase, the
 * senders, the payment token, the audit log, Turnstile and the rate limiter are all mocked, and
 * linkLeadToBooking is a spy (its own behaviour is tested in tests/lib/christmasLeads.test.ts).
 */

const {
  ensureCustomerForPhone,
  logAuditEvent,
  warn,
  error,
  info,
  sendTableBookingCreatedSmsIfAllowed,
  createTablePaymentToken,
  alignTablePaymentHoldToScheduledSend,
  recordOneCourseInsideCutoff,
  idempotencyRecords,
  claimIdempotencyKey,
  lookupIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
  linkLeadToBooking,
} = vi.hoisted(() => {
  // An in-memory stand-in for the idempotency_keys table, with the same outcomes as the real
  // claim: a new key is claimed, the same key with the same hash replays the stored response,
  // and the same key with a different hash conflicts.
  const records = new Map<string, { requestHash: string; response: unknown }>()

  return {
    ensureCustomerForPhone: vi.fn(),
    logAuditEvent: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    sendTableBookingCreatedSmsIfAllowed: vi.fn(),
    createTablePaymentToken: vi.fn(),
    alignTablePaymentHoldToScheduledSend: vi.fn(),
    linkLeadToBooking: vi.fn(),
    recordOneCourseInsideCutoff: vi.fn(),
    idempotencyRecords: records,
    claimIdempotencyKey: vi.fn(async (_supabase: unknown, key: string, requestHash: string) => {
      const existing = records.get(key)
      if (!existing) {
        records.set(key, { requestHash, response: { state: 'processing' } })
        return { state: 'claimed' as const }
      }
      if (existing.requestHash !== requestHash) {
        return { state: 'conflict' as const }
      }
      if ((existing.response as { state?: string } | null)?.state === 'processing') {
        return { state: 'in_progress' as const }
      }
      return { state: 'replay' as const, response: existing.response }
    }),
    lookupIdempotencyKey: vi.fn(),
    persistIdempotencyResponse: vi.fn(
      async (_supabase: unknown, key: string, requestHash: string, response: unknown) => {
        records.set(key, { requestHash, response })
      }
    ),
    releaseIdempotencyClaim: vi.fn(async (_supabase: unknown, key: string) => {
      records.delete(key)
    }),
  }
})

vi.mock('@/lib/api/auth', () => ({
  isApiKeyAuthenticated: vi.fn().mockResolvedValue(true),
  // The website proxy: an authenticated API key, so no Turnstile and no IP limiter.
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
  createApiResponse: (payload: unknown, status = 200) => Response.json(payload, { status }),
  createErrorResponse: (message: string, code: string, status = 400) =>
    Response.json({ success: false, error: message, code }, { status }),
}))

// The real hash and key reader, with the database-backed claim swapped for the in-memory one.
vi.mock('@/lib/api/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/idempotency')>()
  return {
    ...actual,
    claimIdempotencyKey,
    lookupIdempotencyKey,
    persistIdempotencyResponse,
    releaseIdempotencyClaim,
  }
})

// The real writer by default, so the assertions are on the row handed to Supabase. One test
// makes it throw instead.
vi.mock('@/lib/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics/events')>()
  return { recordAnalyticsEvent: vi.fn(actual.recordAnalyticsEvent) }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone,
}))

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => vi.fn().mockResolvedValue(null)),
}))

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/services/consent', () => ({
  ConsentService: { applyBookingContactConsent: vi.fn() },
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent,
}))

vi.mock('@/lib/table-bookings/christmas-one-course', () => ({
  recordOneCourseInsideCutoff,
  oneCourseForEveryone: (partySize: number) => Array.from({ length: partySize }, () => 1),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend,
  createTablePaymentToken,
  mapTableBookingBlockedReason: vi.fn((reason?: string) => reason ?? 'blocked'),
  // No text or email is ever sent from this file.
  sendTableBookingCreatedSmsIfAllowed,
  chargedDepositAmount: (bookingResult: { deposit_amount?: number | null }, fallback: () => number) => {
    const charged = Number(bookingResult.deposit_amount)
    return Number((Number.isFinite(charged) && charged > 0 ? charged : fallback()).toFixed(2))
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn, error, info },
}))

vi.mock('@/lib/table-bookings/christmas-leads', () => ({
  linkLeadToBooking,
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { POST } from '@/app/api/table-bookings/route'

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'
const PERIOD_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = 'customer-1'

const LABEL_KEYS = [
  'booking_source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'short_code',
] as const

const LABELS = {
  booking_source: 'lunch_dinner_lp',
  utm_source: 'qa_facebook',
  utm_medium: 'paid_social',
  utm_campaign: 'weekday_lunch_a_cod_and_chips',
  utm_content: 'walk_in_var_4',
  short_code: 'jbozdk',
} as const

// 07700 900123 is an Ofcom drama number: it can never belong to a real person.
const GUEST = {
  phone: '+447700900123',
  first_name: 'Patricia',
  last_name: 'Fixture',
  email: 'patricia.fixture@example.com',
} as const

const BASE_BOOKING = {
  ...GUEST,
  date: '2026-10-06',
  time: '12:30',
  party_size: 2,
  purpose: 'food',
} as const

// The metadata this route wrote for `table_booking_created` before the labels existed.
const BASE_METADATA = {
  party_size: 2,
  booking_purpose: 'food',
  sunday_lunch: false,
  status: 'confirmed',
  table_name: 'Table 1',
} as const

const CONFIRMED_RESULT = {
  state: 'confirmed',
  status: 'confirmed',
  table_booking_id: BOOKING_ID,
  booking_reference: 'ABCD1234',
  reason: null,
  hold_expires_at: null,
  start_datetime: '2026-10-06T11:30:00.000Z',
  party_size: 2,
  table_name: 'Table 1',
}

type AnalyticsRow = {
  customer_id: string
  event_booking_id: string | null
  table_booking_id: string | null
  private_booking_id: string | null
  event_type: string
  metadata: Record<string, unknown>
}

type RpcArgs = Record<string, unknown>

function buildSupabase(options: {
  rpcResult?: Record<string, unknown>
  analyticsInsertError?: { message: string; code: string; details: string | null; hint: string | null } | null
} = {}) {
  const analyticsInsert = vi.fn(async (_row: AnalyticsRow) => ({
    error: options.analyticsInsertError ?? null,
  }))
  const rpc = vi.fn(async (name: string, _args: RpcArgs) => {
    if (name === 'create_table_booking_public_v06' || name === 'create_table_booking_christmas_v01') {
      return { data: options.rpcResult ?? CONFIRMED_RESULT, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })

  return {
    from: vi.fn((table: string) => {
      if (table === 'analytics_events') {
        return { insert: analyticsInsert }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc,
    analyticsInsert,
  }
}

type FakeSupabase = ReturnType<typeof buildSupabase>

function useSupabase(supabase: FakeSupabase): FakeSupabase {
  vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
  return supabase
}

function buildRequest(body: unknown, idempotencyKey = 'idem-page-source-1'): NextRequest {
  return new NextRequest('http://localhost/api/table-bookings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-key',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  })
}


const LEAD_REF = '0b7c6f4e-2f5a-4d7e-9a51-6f1d2c3b4a59'

describe('POST /api/table-bookings: lead_ref', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idempotencyRecords.clear()
    ensureCustomerForPhone.mockResolvedValue({ customerId: CUSTOMER_ID })
    sendTableBookingCreatedSmsIfAllowed.mockResolvedValue({ sms: null, notificationChannel: null })
    createTablePaymentToken.mockResolvedValue({ url: 'https://example.com/pay' })
    alignTablePaymentHoldToScheduledSend.mockResolvedValue(undefined)
    recordOneCourseInsideCutoff.mockResolvedValue('not_needed')
    linkLeadToBooking.mockResolvedValue('linked')
  })

  it('links the lead to the booking it became', async () => {
    useSupabase(buildSupabase())

    const response = await POST(buildRequest({ ...BASE_BOOKING, lead_ref: LEAD_REF }))

    expect(response.status).toBe(201)
    expect(linkLeadToBooking).toHaveBeenCalledTimes(1)
    expect(linkLeadToBooking).toHaveBeenCalledWith(expect.anything(), { leadRef: LEAD_REF, tableBookingId: BOOKING_ID })
  })

  it('still books, with the same answer, when the link fails', async () => {
    useSupabase(buildSupabase())
    const plain = await POST(buildRequest(BASE_BOOKING, 'idem-plain'))

    linkLeadToBooking.mockResolvedValue('failed')
    const linked = await POST(buildRequest({ ...BASE_BOOKING, lead_ref: LEAD_REF }, 'idem-linked'))

    expect(linked.status).toBe(201)
    expect(await linked.json()).toEqual(await plain.json())
  })

  it('does not try to link a booking sent without a lead_ref', async () => {
    useSupabase(buildSupabase())

    const response = await POST(buildRequest(BASE_BOOKING))

    expect(response.status).toBe(201)
    expect(linkLeadToBooking).not.toHaveBeenCalled()
  })

  it('does not link when the booking was refused', async () => {
    useSupabase(buildSupabase({ rpcResult: { state: 'blocked', reason: 'no_table', table_booking_id: null } }))

    const response = await POST(buildRequest({ ...BASE_BOOKING, lead_ref: LEAD_REF }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ data: expect.objectContaining({ state: 'blocked' }) }))
    expect(linkLeadToBooking).not.toHaveBeenCalled()
  })

  it('keeps lead_ref out of the idempotency hash, so a retry carrying it replays the booking', async () => {
    useSupabase(buildSupabase())

    await POST(buildRequest(BASE_BOOKING, 'idem-retry'))
    const retry = await POST(buildRequest({ ...BASE_BOOKING, lead_ref: LEAD_REF }, 'idem-retry'))

    expect(retry.status).not.toBe(409)
    const [firstClaim, retryClaim] = claimIdempotencyKey.mock.calls
    expect(retryClaim[2]).toBe(firstClaim[2])
  })

  it('refuses a lead_ref that is not a uuid, as any other bad field', async () => {
    useSupabase(buildSupabase())

    const response = await POST(buildRequest({ ...BASE_BOOKING, lead_ref: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    expect(linkLeadToBooking).not.toHaveBeenCalled()
  })
})
