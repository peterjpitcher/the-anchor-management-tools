import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/table-bookings: page-source labels.
 *
 * A website booking may carry six optional labels saying which web page and advert it came from
 * (`booking_source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `short_code`).
 * They are written into the `table_booking_created` analytics event and nowhere else. The booking
 * is the customer's write, so nothing about a label may reject it, change it, or fail it.
 *
 * Nothing here reaches a live service: Supabase, the SMS and email sender, the payment token,
 * the audit log, Turnstile and the rate limiter are all mocked. The request hash and
 * `recordAnalyticsEvent` are the real ones, because the hash and the row actually written are
 * what these tests are about.
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

function analyticsRows(supabase: FakeSupabase, eventType: string): AnalyticsRow[] {
  return supabase.analyticsInsert.mock.calls.map(([row]) => row).filter((row) => row.event_type === eventType)
}

function bookingCreatedMetadata(supabase: FakeSupabase): Record<string, unknown> {
  const rows = analyticsRows(supabase, 'table_booking_created')
  expect(rows).toHaveLength(1)
  return rows[0].metadata
}

/** Everything the route logged, as one string, for "this value was never logged" checks. */
function everythingLogged(): string {
  return JSON.stringify([...warn.mock.calls, ...error.mock.calls, ...info.mock.calls])
}

function expectNoLabelOrPersonalDataLogged(): void {
  const logged = everythingLogged()
  for (const value of [...Object.values(LABELS), ...Object.values(GUEST)]) {
    expect(logged).not.toContain(value)
  }
}

describe('POST /api/table-bookings: page-source labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idempotencyRecords.clear()
    ensureCustomerForPhone.mockResolvedValue({ customerId: CUSTOMER_ID })
    sendTableBookingCreatedSmsIfAllowed.mockResolvedValue({ sms: null, notificationChannel: null })
    createTablePaymentToken.mockResolvedValue({ url: 'https://example.com/pay' })
    alignTablePaymentHoldToScheduledSend.mockResolvedValue(undefined)
    recordOneCourseInsideCutoff.mockResolvedValue('not_needed')
  })

  it('writes all six labels into the table_booking_created event, flat and nested', async () => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS }))

    expect(response.status).toBe(201)
    expect(analyticsRows(supabase, 'table_booking_created')).toEqual([
      {
        customer_id: CUSTOMER_ID,
        event_booking_id: null,
        table_booking_id: BOOKING_ID,
        private_booking_id: null,
        event_type: 'table_booking_created',
        metadata: {
          ...BASE_METADATA,
          attribution: { ...LABELS },
          ...LABELS,
        },
      },
    ])
  })

  it('leaves a booking sent without labels exactly as it was', async () => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest(BASE_BOOKING))

    expect(response.status).toBe(201)
    // Strict equality: no `attribution` key and no null label keys are added.
    expect(bookingCreatedMetadata(supabase)).toEqual(BASE_METADATA)
  })

  it('books exactly the same thing with labels as without: same hash, same RPC call, same response', async () => {
    const supabase = useSupabase(buildSupabase())

    const plain = await POST(buildRequest(BASE_BOOKING, 'idem-plain'))
    const labelled = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS }, 'idem-labelled'))

    expect(plain.status).toBe(201)
    expect(labelled.status).toBe(201)
    expect(await labelled.json()).toEqual(await plain.json())

    // The labels are not part of the idempotency hash.
    const [plainClaim, labelledClaim] = claimIdempotencyKey.mock.calls
    expect(labelledClaim[2]).toBe(plainClaim[2])

    // The booking RPC is called with identical arguments, and the booking's own `source` column
    // stays 'brand_site' whatever `booking_source` says.
    const [plainRpc, labelledRpc] = supabase.rpc.mock.calls
    expect(labelledRpc).toEqual(plainRpc)
    expect(labelledRpc[0]).toBe('create_table_booking_public_v06')
    expect(labelledRpc[1]).toMatchObject({ p_source: 'brand_site' })
  })

  it('truncates an oversized utm_content to 160 characters and still books', async () => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS, utm_content: 'c'.repeat(500) }))

    expect(response.status).toBe(201)
    const metadata = bookingCreatedMetadata(supabase)
    expect(metadata.utm_content).toBe('c'.repeat(160))
    expect((metadata.attribution as Record<string, unknown>).utm_content).toBe('c'.repeat(160))
  })

  it('cuts every label to its own cap and trims surrounding space', async () => {
    const supabase = useSupabase(buildSupabase())
    const long = 'x'.repeat(500)

    const response = await POST(buildRequest({
      ...BASE_BOOKING,
      booking_source: long,
      utm_source: long,
      utm_medium: long,
      utm_campaign: long,
      utm_content: long,
      short_code: `  ${long}  `,
    }))

    expect(response.status).toBe(201)
    const metadata = bookingCreatedMetadata(supabase)
    expect(metadata.attribution).toEqual({
      booking_source: 'x'.repeat(80),
      utm_source: 'x'.repeat(80),
      utm_medium: 'x'.repeat(80),
      utm_campaign: 'x'.repeat(160),
      utm_content: 'x'.repeat(160),
      short_code: 'x'.repeat(32),
    })
  })

  it.each([
    ['null', null],
    ['a number', 42],
    ['a boolean', true],
    ['an object', { nested: 'value' }],
    ['an array', ['weekday_lunch_a_cod_and_chips']],
    ['an empty string', ''],
    ['a blank string', '   '],
  ])('drops a label that is %s and still books', async (_description, badValue) => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS, utm_campaign: badValue }))

    expect(response.status).toBe(201)
    const { utm_campaign: _dropped, ...keptLabels } = LABELS
    const metadata = bookingCreatedMetadata(supabase)
    // Only the labels actually sent are nested; the flat key for the dropped one is null.
    expect(metadata.attribution).toEqual(keptLabels)
    expect(metadata).toEqual({
      ...BASE_METADATA,
      attribution: keptLabels,
      ...keptLabels,
      utm_campaign: null,
    })
  })

  it('books normally when all six labels are malformed at once, and stores none of them', async () => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest({
      ...BASE_BOOKING,
      booking_source: null,
      utm_source: 42,
      utm_medium: { nested: 'value' },
      utm_campaign: ['a', 'b'],
      utm_content: '   ',
      short_code: '',
    }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data).toMatchObject({ state: 'confirmed', table_booking_id: BOOKING_ID })
    expect(bookingCreatedMetadata(supabase)).toEqual(BASE_METADATA)
  })

  it('drops a label Postgres could not store, rather than losing the whole event', async () => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest({
      ...BASE_BOOKING,
      ...LABELS,
      // A NUL, which jsonb refuses.
      utm_campaign: 'weekday\u0000lunch',
      // The cut at 160 lands in the middle of the emoji and would leave half of it behind.
      utm_content: `${'c'.repeat(159)}\u{1F600}`,
    }))

    expect(response.status).toBe(201)
    const metadata = bookingCreatedMetadata(supabase)
    expect(metadata.attribution).toEqual({
      booking_source: LABELS.booking_source,
      utm_source: LABELS.utm_source,
      utm_medium: LABELS.utm_medium,
      short_code: LABELS.short_code,
    })
    expect(metadata.utm_campaign).toBeNull()
    expect(metadata.utm_content).toBeNull()
  })

  it('never lets a click id or any other key into the event or the booking', async () => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest({
      ...BASE_BOOKING,
      ...LABELS,
      fbclid: 'fb-click-id-should-not-be-kept',
      gclid: 'google-click-id-should-not-be-kept',
      utm_term: 'term-should-not-be-kept',
      landing_path: '/path-should-not-be-kept',
      attribution: { fbclid: 'nested-click-id-should-not-be-kept' },
      page_source: { utm_campaign: 'nested-object-should-not-be-kept' },
    }))

    expect(response.status).toBe(201)
    const metadata = bookingCreatedMetadata(supabase)
    expect(Object.keys(metadata).sort()).toEqual(
      [...Object.keys(BASE_METADATA), 'attribution', ...LABEL_KEYS].sort()
    )
    expect(metadata.attribution).toEqual({ ...LABELS })

    const written = JSON.stringify([supabase.analyticsInsert.mock.calls, supabase.rpc.mock.calls])
    expect(written).not.toContain('should-not-be-kept')
    expect(everythingLogged()).not.toContain('should-not-be-kept')
  })

  it('still rejects an invalid booking, however good its labels are', async () => {
    const supabase = useSupabase(buildSupabase())

    const response = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS, party_size: 0 }))

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('VALIDATION_ERROR')
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.analyticsInsert).not.toHaveBeenCalled()
  })

  describe('idempotency: first success wins', () => {
    it('replays the original booking when a retry carries a different utm_campaign', async () => {
      const supabase = useSupabase(buildSupabase())
      const key = 'idem-retry-with-new-labels'

      const first = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS }, key))
      const firstBody = await first.json()

      const retry = await POST(buildRequest(
        { ...BASE_BOOKING, ...LABELS, utm_campaign: 'weekday_dinner_a_pizza' },
        key
      ))
      const retryBody = await retry.json()

      // The original booking comes back: not a 409, and not a second booking.
      expect(first.status).toBe(201)
      expect(retry.status).toBe(201)
      expect(retryBody).toEqual(firstBody)
      expect(retryBody.data.table_booking_id).toBe(BOOKING_ID)
      expect(supabase.rpc).toHaveBeenCalledTimes(1)
      expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledTimes(1)

      // One analytics event, carrying the first request's labels. The retry's are ignored.
      expect(supabase.analyticsInsert).toHaveBeenCalledTimes(1)
      const metadata = bookingCreatedMetadata(supabase)
      expect(metadata.utm_campaign).toBe(LABELS.utm_campaign)
      expect(metadata.attribution).toEqual({ ...LABELS })
      expect(JSON.stringify(supabase.analyticsInsert.mock.calls)).not.toContain('weekday_dinner_a_pizza')
    })

    it('still conflicts when a retry changes a real booking detail', async () => {
      // Guards the test above against passing for the wrong reason: the claim does tell two
      // different requests apart, so the replay there is down to the labels being left out.
      const supabase = useSupabase(buildSupabase())
      const key = 'idem-retry-with-new-party-size'

      const first = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS }, key))
      const retry = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS, party_size: 4 }, key))

      expect(first.status).toBe(201)
      expect(retry.status).toBe(409)
      expect((await retry.json()).code).toBe('IDEMPOTENCY_KEY_CONFLICT')
      expect(supabase.rpc).toHaveBeenCalledTimes(1)
    })
  })

  describe('a failed analytics write never fails the booking', () => {
    it('returns success when recordAnalyticsEvent throws, and logs no label or personal data', async () => {
      const supabase = useSupabase(buildSupabase())
      vi.mocked(recordAnalyticsEvent).mockRejectedValueOnce(new Error('analytics writer unavailable'))

      const response = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS }))

      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body).toMatchObject({
        success: true,
        data: { state: 'confirmed', table_booking_id: BOOKING_ID },
      })
      expect(supabase.analyticsInsert).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith('Failed to record table booking analytics event', {
        metadata: {
          tableBookingId: BOOKING_ID,
          customerId: CUSTOMER_ID,
          eventType: 'table_booking_created',
          error: 'analytics writer unavailable',
        },
      })
      expectNoLabelOrPersonalDataLogged()
    })

    it('returns success when the Supabase insert returns an error, and logs no label or personal data', async () => {
      // The shape supabase-js hands back when it is not asked to throw: a plain object, not an
      // Error, so this goes through the real writer's own catch.
      const supabase = useSupabase(buildSupabase({
        analyticsInsertError: {
          message: 'insert into analytics_events failed',
          code: '57014',
          details: null,
          hint: null,
        },
      }))

      const response = await POST(buildRequest({ ...BASE_BOOKING, ...LABELS }))

      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body).toMatchObject({
        success: true,
        data: { state: 'confirmed', table_booking_id: BOOKING_ID },
      })
      // The insert was attempted with the labels, and its failure was swallowed.
      expect(supabase.analyticsInsert).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith('Failed to record analytics event', {
        metadata: {
          customerId: CUSTOMER_ID,
          eventType: 'table_booking_created',
          error: expect.any(String),
        },
      })
      expectNoLabelOrPersonalDataLogged()
    })
  })

  describe('Christmas path', () => {
    const CHRISTMAS_BOOKING = {
      ...GUEST,
      date: '2026-12-05',
      time: '18:00',
      party_size: 6,
      purpose: 'food',
      booking_period_id: PERIOD_ID,
      booking_period_answer: true,
      christmas_course_counts: [1, 1, 1, 1, 1, 1],
    } as const

    const PENDING_RESULT = {
      state: 'pending_payment',
      status: 'pending_payment',
      table_booking_id: BOOKING_ID,
      booking_reference: 'XMAS1234',
      hold_expires_at: '2026-12-01T12:00:00.000Z',
      deposit_amount: 60,
      table_name: 'Table 1',
    }

    it('keeps the six labels out of the p_request passed to the RPC', async () => {
      const supabase = useSupabase(buildSupabase({ rpcResult: PENDING_RESULT }))

      const response = await POST(buildRequest({ ...CHRISTMAS_BOOKING, ...LABELS }))

      expect(response.status).toBe(201)
      expect(supabase.rpc).toHaveBeenCalledTimes(1)
      const [rpcName, rpcArgs] = supabase.rpc.mock.calls[0]
      expect(rpcName).toBe('create_table_booking_christmas_v01')

      const request = rpcArgs.p_request as Record<string, unknown>
      for (const key of LABEL_KEYS) {
        expect(request).not.toHaveProperty(key)
      }
      // Everything the function reads is still there, and the source is unchanged.
      expect(request).toEqual({
        ...CHRISTMAS_BOOKING,
        customer_id: CUSTOMER_ID,
        time: '18:00:00',
        source: 'brand_site',
      })
      expect(rpcArgs.p_course_counts).toEqual([1, 1, 1, 1, 1, 1])
    })

    it('still records the labels on the booking event, and only there', async () => {
      const supabase = useSupabase(buildSupabase({ rpcResult: PENDING_RESULT }))

      await POST(buildRequest({ ...CHRISTMAS_BOOKING, ...LABELS }))

      const metadata = bookingCreatedMetadata(supabase)
      expect(metadata.attribution).toEqual({ ...LABELS })
      expect(metadata).toMatchObject({ ...LABELS })

      const [depositStarted] = analyticsRows(supabase, 'table_deposit_started')
      expect(depositStarted).toBeDefined()
      expect(depositStarted.metadata).not.toHaveProperty('attribution')
      for (const key of LABEL_KEYS) {
        expect(depositStarted.metadata).not.toHaveProperty(key)
      }
    })
  })
})
