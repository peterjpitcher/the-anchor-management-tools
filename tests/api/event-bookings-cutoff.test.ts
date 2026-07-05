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

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
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

function buildRequest() {
  return new NextRequest('http://localhost/api/event-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
    body: JSON.stringify({
      event_id: EVENT_ID,
      phone: '+447700900123',
      first_name: 'Pat',
      seats: 2,
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

describe('event booking online sales cutoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: CUSTOMER_ID,
      resolutionError: undefined,
    })
  })

  it('rejects the booking with 409 SALES_CLOSED when the cutoff is in the past', async () => {
    mockAdminClientWithEvent({
      ...baseEventRow,
      booking_cutoff_at: new Date(Date.now() - 3600_000).toISOString(),
    })

    const response = await POST(buildRequest() as any)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('SALES_CLOSED')
  })

  it('does not block the booking when booking_cutoff_at is null', async () => {
    mockAdminClientWithEvent({ ...baseEventRow, booking_cutoff_at: null })

    const response = await POST(buildRequest() as any)
    const body = await response.json()

    expect(response.status).not.toBe(409)
    expect(body?.error?.code).not.toBe('SALES_CLOSED')
  })

  it('does not block the booking when the cutoff is in the future', async () => {
    mockAdminClientWithEvent({
      ...baseEventRow,
      booking_cutoff_at: new Date(Date.now() + 3600_000).toISOString(),
    })

    const response = await POST(buildRequest() as any)
    const body = await response.json()

    expect(response.status).not.toBe(409)
    expect(body?.error?.code).not.toBe('SALES_CLOSED')
  })
})
