import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Every failure branch of the public event booking route (BK-128, BK-039, BK-127, BK-189 and BK-108,
 * customer bookings review of 24 October 2026). Each test makes one dependency fail and checks
 * three things the website relies on: the status and code it reads, whether the idempotency claim
 * is released (nothing saved) or kept (something saved), and that the failure is logged as an error.
 */

vi.mock('@/lib/phone/uk-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/phone/uk-mobile')>()),
  isUkMobile: () => true,
}))

vi.mock('@/services/event-bookings', () => ({
  EventBookingService: { createBooking: vi.fn(), normalizeBookingMode: () => 'general' },
}))

vi.mock('@/lib/events/ticket-type-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/events/ticket-type-queries')>()),
  getDefaultTicketTypeId: vi.fn(),
}))

const limitBookingAttempt = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/booking-rate-limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/booking-rate-limits')>()),
  limitBookingAttempt,
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) =>
    Response.json({ success: false, error: { code, message } }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/idempotency')>()),
  claimIdempotencyKey: vi.fn(),
  getIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
  markIdempotencyClaimCommitted: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/utils', () => ({ formatPhoneForStorage: vi.fn((value: string) => value) }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/services/consent', () => ({ ConsentService: { applyBookingContactConsent: vi.fn() } }))
vi.mock('@/lib/money-alerts', () => ({ alertMoneyNeedsAPerson: vi.fn().mockResolvedValue({ sent: true, duplicate: false }) }))
vi.mock('@/lib/events/sunday-lunch-only-policy', () => ({
  isSundayLunchOnlyEvent: vi.fn().mockReturnValue(false),
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE: 'Sunday lunch only',
}))

const { warn, error, info } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import {
  claimIdempotencyKey,
  markIdempotencyClaimCommitted,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { ConsentService } from '@/services/consent'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { EventBookingService } from '@/services/event-bookings'
import { getDefaultTicketTypeId } from '@/lib/events/ticket-type-queries'
import { POST } from '@/app/api/event-bookings/route'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const TICKET_TYPE_ID = '33333333-3333-4333-8333-333333333333'

const BOOKING = { event_id: EVENT_ID, phone: '+447700900123', first_name: 'Pat', seats: 2 }

type EventRowOverrides = Record<string, unknown>

function mockAdminClient(options: {
  eventError?: boolean
  event?: EventRowOverrides
  pendingHolds?: number
} = {}) {
  const eventMaybeSingle = vi.fn().mockResolvedValue(
    options.eventError
      ? { data: null, error: { message: 'connection reset' } }
      : {
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
            ...options.event,
          },
          error: null,
        }
  )

  const holdsQuery = {
    select: vi.fn(() => holdsQuery),
    eq: vi.fn(() => holdsQuery),
    gt: vi.fn().mockResolvedValue({ count: options.pendingHolds ?? 0, error: null }),
  }

  ;(createAdminClient as unknown as Mock).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'events') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle }) }) }
      }
      if (table === 'bookings') return holdsQuery
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn(async (name: string) => {
      throw new Error(`Unexpected RPC: ${name}`)
    }),
  })
}

function request(body: Record<string, unknown> = BOOKING) {
  return new NextRequest('http://localhost/api/event-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
    body: JSON.stringify(body),
  })
}

async function codeOf(response: Response): Promise<string | undefined> {
  const body = await response.json()
  return body?.error?.code
}

function serviceResult(overrides: Record<string, unknown>) {
  return {
    resolvedState: 'confirmed',
    resolvedReason: null,
    bookingId: 'booking-1',
    seatsRemaining: 10,
    nextStepUrl: null,
    manageUrl: null,
    smsMeta: null,
    notificationChannel: 'sms',
    eventSeatingType: null,
    rpcResult: { state: 'confirmed', booking_id: 'booking-1' },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof EventBookingService.createBooking>>
}

describe('POST /api/event-bookings failure paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limitBookingAttempt.mockResolvedValue(null)
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' })
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: CUSTOMER_ID } as Awaited<ReturnType<typeof ensureCustomerForPhone>>)
    mockAdminClient()
    vi.mocked(EventBookingService.createBooking).mockResolvedValue(serviceResult({}))
  })

  it('answers 500 DATABASE_ERROR, releases the claim and logs an error when the event cannot be loaded', async () => {
    mockAdminClient({ eventError: true })

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(await codeOf(response)).toBe('DATABASE_ERROR')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Event booking could not load the event', expect.anything())
    expect(EventBookingService.createBooking).not.toHaveBeenCalled()
  })

  it('answers 500 DATABASE_ERROR and logs an error when the ticket prices cannot be loaded', async () => {
    vi.mocked(getDefaultTicketTypeId).mockRejectedValue(new Error('ticket types unavailable'))

    const response = await POST(request({
      ...BOOKING,
      ticket_selections: [{ ticket_type_id: TICKET_TYPE_ID, quantity: 2 }],
    }))

    expect(response.status).toBe(500)
    expect(await codeOf(response)).toBe('DATABASE_ERROR')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Event booking could not load the ticket prices', expect.anything())
  })

  it('answers 500 DATABASE_ERROR and logs an error when the guest questions cannot be read', async () => {
    mockAdminClient({ event: { booking_questions: 'not a list' } })

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(await codeOf(response)).toBe('DATABASE_ERROR')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Event booking could not read the event guest questions', expect.anything())
  })

  it('answers 500 CUSTOMER_RESOLUTION_FAILED, releases the claim and logs an error when the customer cannot be made', async () => {
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: null } as unknown as Awaited<ReturnType<typeof ensureCustomerForPhone>>)

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(await codeOf(response)).toBe('CUSTOMER_RESOLUTION_FAILED')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Event booking could not find or create the customer', expect.anything())
  })

  it('still answers 201, keeps the claim and tells the manager when the consent write throws after the booking is saved', async () => {
    vi.mocked(ConsentService.applyBookingContactConsent).mockRejectedValue(new Error('consent table locked'))

    const response = await POST(request())

    expect(response.status).toBe(201)
    expect((await response.json()).data).toMatchObject({ state: 'confirmed', booking_id: 'booking-1' })
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Booking saved but the guest contact choices did not record', expect.anything())
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      domain: 'event_bookings',
      bookingId: 'booking-1',
      kind: 'consent_not_recorded',
    }))
  })

  it('notes a saved booking on the claim straight away, so a retry after a crash replays it', async () => {
    await POST(request())

    expect(markIdempotencyClaimCommitted).toHaveBeenCalledWith(
      expect.anything(),
      'idem-1',
      expect.any(String),
      expect.objectContaining({ data: expect.objectContaining({ state: 'confirmed', booking_id: 'booking-1' }) })
    )
  })

  it('answers 500 PAYMENT_LINK_FAILED and releases the claim when the payment link fails and the booking was cancelled', async () => {
    vi.mocked(EventBookingService.createBooking).mockResolvedValue(serviceResult({
      resolvedState: 'pending_payment',
      paymentLinkFailed: true,
      rollbackFailed: false,
      rpcResult: { state: 'pending_payment', booking_id: 'booking-1' },
    }))

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(await codeOf(response)).toBe('PAYMENT_LINK_FAILED')
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
    expect(markIdempotencyClaimCommitted).not.toHaveBeenCalled()
  })

  it('answers PAYMENT_LINK_FAILED_BOOKING_HELD and keeps the claim when the booking could not be cancelled either', async () => {
    vi.mocked(EventBookingService.createBooking).mockResolvedValue(serviceResult({
      resolvedState: 'pending_payment',
      paymentLinkFailed: true,
      rollbackFailed: true,
      rpcResult: { state: 'pending_payment', booking_id: 'booking-1' },
    }))

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(await codeOf(response)).toBe('PAYMENT_LINK_FAILED_BOOKING_HELD')
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Event booking holds seats with no payment link', expect.anything())
  })

  it.each(['no_table', 'outside_hours', 'booking_closed'])(
    'does not store a %s refusal, so a retry can book once space frees up (BK-189)',
    async (reason) => {
      vi.mocked(EventBookingService.createBooking).mockResolvedValue(serviceResult({
        resolvedState: 'blocked',
        resolvedReason: reason,
        bookingId: null,
        rpcResult: { state: 'blocked', reason, booking_id: 'cancelled-after-table-failure' },
      }))

      const response = await POST(request())

      expect(response.status).toBe(200)
      expect(persistIdempotencyResponse).not.toHaveBeenCalled()
      expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
    }
  )

  it('does not store a full-with-waitlist answer (BK-189)', async () => {
    vi.mocked(EventBookingService.createBooking).mockResolvedValue(serviceResult({
      resolvedState: 'full_with_waitlist_option',
      resolvedReason: 'full',
      bookingId: null,
      rpcResult: { state: 'full_with_waitlist_option', booking_id: null },
    }))

    await POST(request())

    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
  })

  it('stores "you already have a booking" for 15 minutes only (BK-189)', async () => {
    vi.mocked(EventBookingService.createBooking).mockResolvedValue(serviceResult({
      resolvedState: 'blocked',
      resolvedReason: 'customer_conflict',
      bookingId: 'existing-booking',
      rpcResult: { state: 'blocked', reason: 'customer_conflict', booking_id: 'existing-booking' },
    }))

    await POST(request())

    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(), 'idem-1', expect.any(String), expect.anything(), 0.25
    )
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('refuses with 429 RATE_LIMIT_EXCEEDED before any work when the guest is over the hourly limit (BK-108)', async () => {
    limitBookingAttempt.mockResolvedValue(
      Response.json({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many' } }, { status: 429 })
    )

    const response = await POST(request())

    expect(response.status).toBe(429)
    expect(await codeOf(response)).toBe('RATE_LIMIT_EXCEEDED')
    expect(limitBookingAttempt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prefix: 'event-booking-guest',
      subject: '+447700900123',
      max: 20,
    }))
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
  })

  it('refuses a paid booking with 429 when the guest already holds three unpaid holds (BK-108)', async () => {
    mockAdminClient({ event: { payment_mode: 'prepaid', is_free: false, price: 10, collect_guest_details: false }, pendingHolds: 3 })

    const response = await POST(request())

    expect(response.status).toBe(429)
    expect(await codeOf(response)).toBe('RATE_LIMIT_EXCEEDED')
    expect(EventBookingService.createBooking).not.toHaveBeenCalled()
    expect(releaseIdempotencyClaim).toHaveBeenCalledOnce()
  })

  it('lets a paid booking through when the hold count fails, and logs it', async () => {
    const holdsQuery = {
      select: vi.fn(() => holdsQuery),
      eq: vi.fn(() => holdsQuery),
      gt: vi.fn().mockResolvedValue({ count: null, error: { message: 'timeout' } }),
    }
    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: EVENT_ID, name: 'Quiz', date: '2999-01-01', start_datetime: '2999-01-01T19:00:00Z', booking_mode: 'general', bookings_enabled: true, payment_mode: 'prepaid', is_free: false, price: 10, collect_guest_details: false },
      error: null,
    })
    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'bookings'
          ? holdsQuery
          : { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle }) }) }
      ),
      rpc: vi.fn(),
    })

    const response = await POST(request())

    expect(response.status).toBe(201)
    expect(error).toHaveBeenCalledWith('Could not count unpaid event holds for a guest; allowing the booking', expect.anything())
  })
})
