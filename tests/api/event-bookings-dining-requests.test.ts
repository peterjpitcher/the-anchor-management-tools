vi.mock('@/services/event-bookings', () => ({ EventBookingService: { createBooking: vi.fn(), normalizeBookingMode: () => 'general' } }))
import { EventBookingService } from '@/services/event-bookings'
import { consentHashPayload } from '@/lib/consent/validation'
import { claimIdempotencyKey } from '@/lib/api/idempotency'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Mirror the REAL createErrorResponse envelope: { success: false, error: { code, message } }.
// The website contract asserts a 409 with error.code === 'SALES_CLOSED'.
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
    Response.json(
      {
        success: false,
        error: {
          code,
          message,
        },
      },
      { status }
    )
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

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({ url: 'https://example.com/manage' }),
}))

vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
}))

vi.mock('@/lib/events/sunday-lunch-only-policy', () => ({
  isSundayLunchOnlyEvent: vi.fn().mockReturnValue(false),
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE: 'Sunday lunch only',
}))

const { warn, error, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error,
    info,
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { POST } from '@/app/api/event-bookings/route'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'

function buildRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/event-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
    body: JSON.stringify({
      event_id: EVENT_ID,
      phone: '+447700900123',
      first_name: 'Pat',
      seats: 2,
      ...overrides,
    }),
  })
}

/**
 * Wires an admin-client mock whose events lookup returns the supplied row.
 * A successful create_event_booking_v06 RPC lets the "not blocked" cases reach 201.
 */
function mockAdminClientWithEvent(eventRow: Record<string, unknown>) {
  const eventMaybeSingle = vi.fn().mockResolvedValue({ data: eventRow, error: null })
  const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: CUSTOMER_ID,
      first_name: 'Pat',
      mobile_number: '+447700900123',
      sms_status: 'active',
    },
    error: null,
  })
  const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
  const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

  ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'events') return { select: eventSelect }
      if (table === 'customers') return { select: customerSelect }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn(async (name: string) => {
      if (name === 'create_event_booking_v06') {
        return {
          data: {
            state: 'confirmed',
            booking_id: 'booking-1',
            payment_mode: 'free',
            event_id: EVENT_ID,
            event_name: 'Test Event',
            event_start_datetime: '2999-01-01T19:00:00Z',
            seats_remaining: 10,
          },
          error: null,
        }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    }),
  })
}

const baseEventRow = {
  id: EVENT_ID,
  name: 'Test Event',
  date: '2999-01-01',
  start_datetime: '2999-01-01T19:00:00Z',
  booking_mode: 'general',
  bookings_enabled: true,
  payment_mode: 'free',
  is_free: true,
  price: 0,
  price_per_seat: 0,
}


describe('event dining requests at the authoritative API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as Awaited<ReturnType<typeof claimIdempotencyKey>>)
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: CUSTOMER_ID } as Awaited<ReturnType<typeof ensureCustomerForPhone>>)
    mockAdminClientWithEvent(baseEventRow)
    vi.mocked(EventBookingService.createBooking).mockResolvedValue({ resolvedState: 'confirmed', bookingId: 'booking-fixture', rpcResult: { state: 'confirmed', booking_id: 'booking-fixture', requests_recorded: true } } as Awaited<ReturnType<typeof EventBookingService.createBooking>>)
  })
  it.each([
    [{ dining_request: 'before_event' }, { dining_request: 'during_event' }],
    [{ early_arrival_request: true }, { early_arrival_request: false }],
    [{ dining_request: 'before_event' }, {}],
  ])('rejects a changed request with the same explicit key: %j to %j', async (first, changed) => {
    let savedHash: string | null = null
    vi.mocked(claimIdempotencyKey).mockImplementation(async (_db, _key, hash) => {
      if (savedHash === null) {
        savedHash = hash
        return { state: 'claimed' }
      }
      return savedHash === hash
        ? { state: 'replay', response: { success: true, data: { state: 'confirmed' }, meta: { status_code: 201 } } }
        : { state: 'conflict' }
    })
    expect((await POST(buildRequest(first))).status).toBe(201)
    const response = await POST(buildRequest(changed))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    expect(EventBookingService.createBooking).toHaveBeenCalledTimes(1)
  })

  it('keeps the legacy no-request hash and treats false as no early-arrival request', async () => {
    await POST(buildRequest())
    await POST(buildRequest({ early_arrival_request: false }))
    const hashes = vi.mocked(claimIdempotencyKey).mock.calls.map((call) => call[2])
    expect(hashes[0]).toBe(hashes[1])
    const { computeIdempotencyRequestHash } = await import('@/lib/api/idempotency')
    expect(hashes[0]).toBe(computeIdempotencyRequestHash({
      event_id: EVENT_ID, phone: '+447700900123', first_name: 'Pat', last_name: null,
      email: null, seats: 2, seating_preference: 'seated', expected_event_date: null,
      communication_consent: consentHashPayload(undefined),
    }))
  })

  it('passes validated requests to atomic creation and acknowledges persistence', async () => {
    const response = await POST(buildRequest({ dining_request: 'before_event', early_arrival_request: true }))
    expect(response.status).toBe(201)
    expect((await response.json()).data.requests_recorded).toBe(true)
    expect(EventBookingService.createBooking).toHaveBeenCalledWith(expect.objectContaining({ diningRequest: 'before_event', earlyArrivalRequest: true }))
  })
  it.each([{ dining_request: 'promised_meal' }, { early_arrival_request: '18:00' }])('rejects invalid operational request %j', async (extra) => {
    expect((await POST(buildRequest(extra))).status).toBe(400)
    expect(EventBookingService.createBooking).not.toHaveBeenCalled()
  })
  it('returns an error when atomic persistence fails', async () => {
    vi.mocked(EventBookingService.createBooking).mockResolvedValue({ rpcFailed: true } as Awaited<ReturnType<typeof EventBookingService.createBooking>>)
    const response = await POST(buildRequest({ dining_request: 'not_sure' }))
    expect(response.status).toBe(500)
    expect((await response.json()).success).toBe(false)
  })
  it('replays recorded acknowledgement without creating or appending again', async () => {
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'replay', response: { success: true, data: { state: 'confirmed', booking_id: 'booking-fixture', requests_recorded: true }, meta: { status_code: 201 } } } as Awaited<ReturnType<typeof claimIdempotencyKey>>)
    const response = await POST(buildRequest({ dining_request: 'before_event' }))
    expect((await response.json()).data.requests_recorded).toBe(true)
    expect(EventBookingService.createBooking).not.toHaveBeenCalled()
  })
})
