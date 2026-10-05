import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

// The service is mocked whole: nothing here creates a booking, writes to Supabase or sends an
// SMS. The route's only job with attribution is to clean it and hand it to createBooking.
vi.mock('@/services/event-bookings', () => ({
  EventBookingService: { createBooking: vi.fn(), normalizeBookingMode: () => 'general' },
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (
      handler: (request: Request) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message } }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/idempotency')>()),
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  getIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/services/consent', () => ({
  ConsentService: { applyBookingContactConsent: vi.fn() },
}))

vi.mock('@/lib/events/sunday-lunch-only-policy', () => ({
  isSundayLunchOnlyEvent: vi.fn().mockReturnValue(false),
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE: 'Sunday lunch only',
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { claimIdempotencyKey, computeIdempotencyRequestHash } from '@/lib/api/idempotency'
import { consentHashPayload } from '@/lib/consent/validation'
import { ConsentService } from '@/services/consent'
import { EventBookingService } from '@/services/event-bookings'
import { POST } from '@/app/api/event-bookings/route'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'

const BASE_BOOKING = {
  event_id: EVENT_ID,
  phone: '+447700900123',
  first_name: 'Pat',
  seats: 2,
}

// Every attribution label the route accepts, with a good value.
const GOOD_TAGS = {
  source_url: 'https://www.example.com/events/quiz-night?utm_source=facebook',
  landing_path: '/events/quiz-night',
  utm_source: 'facebook',
  utm_medium: 'paid_social',
  utm_campaign: 'quiz_night_october',
  utm_content: 'carousel_a',
  utm_term: 'pub quiz',
  short_code: 'quiz26',
  event_slug: 'quiz-night',
  event_name: 'Quiz Night',
  event_category_name: 'Quiz',
  event_category_slug: 'quiz',
  event_date: '2999-01-01T19:00:00Z',
  event_price: 5,
  event_value: 10,
  food_intent: 'before_event',
}

type TagKey = keyof typeof GOOD_TAGS

// The caps the route has always applied to the text labels. A value over the cap used to be a
// 400; it is now cut to this length.
const TEXT_LABEL_CAPS = {
  landing_path: 512,
  utm_source: 200,
  utm_medium: 200,
  utm_campaign: 300,
  utm_content: 300,
  utm_term: 300,
  short_code: 64,
  event_slug: 200,
  event_name: 300,
  event_category_name: 200,
  event_category_slug: 200,
  event_date: 80,
  food_intent: 80,
} as const

const SOURCE_URL_CAP = 2048
const TEXT_LABEL_KEYS = Object.keys(TEXT_LABEL_CAPS) as (keyof typeof TEXT_LABEL_CAPS)[]
const NUMBER_LABEL_KEYS = ['event_price', 'event_value'] as const

const BAD_TEXT_VALUES: [string, unknown][] = [
  ['null', null],
  ['a number', 42],
  ['a boolean', true],
  ['an object', { nested: 'value' }],
  ['an array', ['quiz_night_october']],
  ['an empty string', ''],
  ['a blank string', '   '],
]

const BAD_NUMBER_VALUES: [string, unknown][] = [
  ['null', null],
  ['a numeric string', '12.50'],
  ['a negative number', -1],
  ['a boolean', true],
  ['an object', { amount: 5 }],
  ['an array', [5]],
]

// Built at runtime so the source file holds no control or half characters.
const NUL = String.fromCharCode(0)
const LONE_SURROGATE = String.fromCharCode(0xd83d)
const EMOJI = String.fromCodePoint(0x1f600)

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/event-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
    body: JSON.stringify(body),
  })
}

function withoutTag(key: TagKey): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...GOOD_TAGS }
  delete kept[key]
  return kept
}

/** The attribution the route handed to the booking service on its only call. */
function attributionPassedToService(): unknown {
  expect(EventBookingService.createBooking).toHaveBeenCalledTimes(1)
  return vi.mocked(EventBookingService.createBooking).mock.calls[0][0].attribution
}

function mockAdminClient() {
  const eventMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: EVENT_ID,
      name: 'Quiz Night',
      date: '2999-01-01',
      start_datetime: '2999-01-01T19:00:00Z',
      booking_mode: 'general',
      bookings_enabled: true,
      payment_mode: 'free',
      is_free: true,
      price: 0,
      price_per_seat: 0,
    },
    error: null,
  })
  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: CUSTOMER_ID, first_name: 'Pat', mobile_number: '+447700900123', sms_status: 'active' },
    error: null,
  })

  ;(createAdminClient as unknown as Mock).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'events') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle }) }) }
      }
      if (table === 'customers') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle }) }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn(async (name: string) => {
      throw new Error(`Unexpected RPC: ${name}`)
    }),
  })
}

describe('POST /api/event-bookings: attribution labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as Awaited<ReturnType<typeof claimIdempotencyKey>>)
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: CUSTOMER_ID } as Awaited<ReturnType<typeof ensureCustomerForPhone>>)
    mockAdminClient()
    vi.mocked(EventBookingService.createBooking).mockResolvedValue({
      resolvedState: 'confirmed',
      bookingId: 'booking-fixture',
      rpcResult: { state: 'confirmed', booking_id: 'booking-fixture' },
    } as Awaited<ReturnType<typeof EventBookingService.createBooking>>)
  })

  describe('a booking with good labels behaves exactly as before', () => {
    it('passes every label to the booking service unchanged', async () => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual(GOOD_TAGS)
    })

    it('trims surrounding space, as it always did', async () => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, utm_campaign: '  quiz_night_october  ' }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual(GOOD_TAGS)
    })

    it('passes no attribution at all when no label is sent', async () => {
      const response = await POST(buildRequest(BASE_BOOKING))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toBeNull()
    })

    it('keeps a zero price and a whole emoji', async () => {
      const response = await POST(buildRequest({
        ...BASE_BOOKING,
        event_price: 0,
        event_value: 0,
        utm_content: `quiz ${EMOJI}`,
      }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual({ event_price: 0, event_value: 0, utm_content: `quiz ${EMOJI}` })
    })

    it('answers the same and hashes the same with labels as without', async () => {
      const plain = await POST(buildRequest(BASE_BOOKING))
      const tagged = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS }))

      expect(tagged.status).toBe(plain.status)
      expect(await tagged.json()).toEqual(await plain.json())

      const hashes = vi.mocked(claimIdempotencyKey).mock.calls.map((call) => call[2])
      expect(hashes).toHaveLength(2)
      expect(hashes[1]).toBe(hashes[0])
      // The hash is still built from the booking details alone.
      expect(hashes[0]).toBe(computeIdempotencyRequestHash({
        event_id: EVENT_ID,
        phone: '+447700900123',
        first_name: 'Pat',
        last_name: null,
        email: null,
        seats: 2,
        seating_preference: 'seated',
        expected_event_date: null,
        communication_consent: consentHashPayload(undefined),
      }))
    })
  })

  describe('a malformed label is dropped and the booking still succeeds', () => {
    const textCases = [...TEXT_LABEL_KEYS, 'source_url' as const].flatMap((key) =>
      BAD_TEXT_VALUES.map(([description, badValue]): [TagKey, string, unknown] => [key, description, badValue])
    )

    it.each(textCases)('%s sent as %s', async (key, _description, badValue) => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, [key]: badValue }))

      expect(response.status).toBe(201)
      expect((await response.json()).data).toMatchObject({ state: 'confirmed', booking_id: 'booking-fixture' })
      // Only the bad label goes; every other label is kept as sent.
      expect(attributionPassedToService()).toEqual(withoutTag(key))
    })

    const numberCases = NUMBER_LABEL_KEYS.flatMap((key) =>
      BAD_NUMBER_VALUES.map(([description, badValue]): [TagKey, string, unknown] => [key, description, badValue])
    )

    it.each(numberCases)('%s sent as %s', async (key, _description, badValue) => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, [key]: badValue }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual(withoutTag(key))
    })

    it('drops a source_url that is not a web address', async () => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, source_url: 'not a web address' }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual(withoutTag('source_url'))
    })

    it('books normally when every label is malformed at once, and passes none of them on', async () => {
      const response = await POST(buildRequest({
        ...BASE_BOOKING,
        source_url: 'not a web address',
        landing_path: null,
        utm_source: 42,
        utm_medium: { nested: 'value' },
        utm_campaign: ['a', 'b'],
        utm_content: '   ',
        utm_term: '',
        short_code: null,
        event_slug: 7,
        event_name: {},
        event_category_name: [],
        event_category_slug: '',
        event_date: null,
        event_price: 'free',
        event_value: -10,
        food_intent: 0,
      }))

      expect(response.status).toBe(201)
      expect((await response.json()).data).toMatchObject({ state: 'confirmed', booking_id: 'booking-fixture' })
      expect(attributionPassedToService()).toBeNull()
    })

    it('drops a label Postgres could not store, rather than losing the whole analytics event', async () => {
      const response = await POST(buildRequest({
        ...BASE_BOOKING,
        ...GOOD_TAGS,
        // A NUL, which jsonb refuses.
        utm_campaign: `quiz${NUL}night`,
        // Half an emoji, which jsonb also refuses.
        utm_term: `pub quiz ${LONE_SURROGATE}`,
        // The cut at 300 lands in the middle of the emoji and would leave half of it behind.
        utm_content: `${'c'.repeat(299)}${EMOJI}`,
      }))

      expect(response.status).toBe(201)
      const { utm_campaign: _nul, utm_term: _lone, utm_content: _cut, ...kept } = GOOD_TAGS
      expect(attributionPassedToService()).toEqual(kept)
    })
  })

  describe('a click id is never kept against the booking', () => {
    const CLICK_IDS = {
      fbclid: 'IwAR0exampleMetaClickId',
      gclid: 'EAIaIQexampleGoogleClickId',
      fbp: 'fb.1.1700000000000.1234567890',
      fbc: 'fb.1.1700000000000.IwAR0exampleMetaClickId',
    }

    function everythingTheRouteKept(): string {
      return JSON.stringify([
        vi.mocked(EventBookingService.createBooking).mock.calls,
        vi.mocked(ConsentService.applyBookingContactConsent).mock.calls,
      ])
    }

    it('drops a click id sent as its own field, and still books', async () => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, ...CLICK_IDS }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual(GOOD_TAGS)
      for (const clickId of Object.values(CLICK_IDS)) {
        expect(everythingTheRouteKept()).not.toContain(clickId)
      }
    })

    it('takes a click id out of source_url and keeps the page and its campaign tags', async () => {
      const response = await POST(buildRequest({
        ...BASE_BOOKING,
        ...GOOD_TAGS,
        source_url: `https://www.example.com/events/quiz-night?utm_source=facebook&fbclid=${CLICK_IDS.fbclid}&utm_campaign=quiz&gclid=${CLICK_IDS.gclid}`,
      }))

      expect(response.status).toBe(201)
      const cleanUrl = 'https://www.example.com/events/quiz-night?utm_source=facebook&utm_campaign=quiz'
      expect(attributionPassedToService()).toEqual({ ...GOOD_TAGS, source_url: cleanUrl })
      expect(vi.mocked(ConsentService.applyBookingContactConsent).mock.calls[0][2]).toMatchObject({ sourceUrl: cleanUrl })
      expect(everythingTheRouteKept()).not.toContain(CLICK_IDS.fbclid)
      expect(everythingTheRouteKept()).not.toContain(CLICK_IDS.gclid)
    })

    it('takes a click id out of the referer when that is the only page address', async () => {
      const request = new NextRequest('http://localhost/api/event-bookings', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem-1',
          referer: `https://www.example.com/events/quiz-night?fbclid=${CLICK_IDS.fbclid}`,
        },
        body: JSON.stringify(BASE_BOOKING),
      })

      const response = await POST(request)

      expect(response.status).toBe(201)
      expect(vi.mocked(ConsentService.applyBookingContactConsent).mock.calls[0][2]).toMatchObject({
        sourceUrl: 'https://www.example.com/events/quiz-night',
      })
      expect(everythingTheRouteKept()).not.toContain(CLICK_IDS.fbclid)
    })

    it('leaves a source_url with no click id exactly as sent', async () => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS }))

      expect(response.status).toBe(201)
      expect(vi.mocked(ConsentService.applyBookingContactConsent).mock.calls[0][2]).toMatchObject({
        sourceUrl: GOOD_TAGS.source_url,
      })
    })
  })

  describe('an over-long label is cut to its cap and the booking still succeeds', () => {
    it.each(TEXT_LABEL_KEYS)('%s', async (key) => {
      const cap = TEXT_LABEL_CAPS[key]
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, [key]: `  ${'x'.repeat(cap + 100)}  ` }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual({ ...GOOD_TAGS, [key]: 'x'.repeat(cap) })
    })

    it('source_url', async () => {
      const longUrl = `https://www.example.com/events/quiz-night?utm_content=${'c'.repeat(3000)}`
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, source_url: longUrl }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual({ ...GOOD_TAGS, source_url: longUrl.slice(0, SOURCE_URL_CAP) })
    })

    it('cuts every label at once', async () => {
      const longLabels = Object.fromEntries(TEXT_LABEL_KEYS.map((key) => [key, 'x'.repeat(1000)]))
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...longLabels }))

      expect(response.status).toBe(201)
      expect(attributionPassedToService()).toEqual(
        Object.fromEntries(TEXT_LABEL_KEYS.map((key) => [key, 'x'.repeat(TEXT_LABEL_CAPS[key])]))
      )
    })
  })

  describe('an invalid booking is still rejected, however good its labels are', () => {
    it.each([
      ['an event id that is not a UUID', { event_id: 'not-a-uuid' }],
      ['no phone number', { phone: undefined }],
      ['a phone number that is too short', { phone: '123' }],
      ['no seats', { seats: 0 }],
      ['too many seats', { seats: 21 }],
      ['a malformed email', { email: 'not-an-email' }],
      ['an unknown seating preference', { seating_preference: 'floor' }],
      ['a malformed expected date', { expected_event_date: '01/01/2999' }],
      ['an unknown dining request', { dining_request: 'promised_meal' }],
      ['a first name that is too long', { first_name: 'P'.repeat(101) }],
    ])('%s', async (_description, badDetail) => {
      const response = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, ...badDetail }))

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
      expect(claimIdempotencyKey).not.toHaveBeenCalled()
      expect(EventBookingService.createBooking).not.toHaveBeenCalled()
    })
  })

  describe('idempotency: the labels are not part of the booking', () => {
    function rememberFirstHash() {
      let savedHash: string | null = null
      vi.mocked(claimIdempotencyKey).mockImplementation(async (_db, _key, hash) => {
        if (savedHash === null) {
          savedHash = hash
          return { state: 'claimed' }
        }
        return savedHash === hash
          ? { state: 'replay', response: { success: true, data: { state: 'confirmed', booking_id: 'booking-fixture' }, meta: { status_code: 201 } } }
          : { state: 'conflict' }
      })
    }

    it('replays the original booking when a retry carries different or malformed labels', async () => {
      rememberFirstHash()

      expect((await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS }))).status).toBe(201)
      const retry = await POST(buildRequest({ ...BASE_BOOKING, utm_campaign: 'another_campaign', utm_term: null, short_code: 99 }))

      expect(retry.status).toBe(201)
      expect((await retry.json()).data).toMatchObject({ state: 'confirmed', booking_id: 'booking-fixture' })
      expect(EventBookingService.createBooking).toHaveBeenCalledTimes(1)
    })

    it('still conflicts when a retry changes a real booking detail', async () => {
      rememberFirstHash()

      expect((await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS }))).status).toBe(201)
      const retry = await POST(buildRequest({ ...BASE_BOOKING, ...GOOD_TAGS, seats: 4 }))

      expect(retry.status).toBe(409)
      expect((await retry.json()).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
      expect(EventBookingService.createBooking).toHaveBeenCalledTimes(1)
    })
  })
})
