import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (
      handler: (request: Request) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json(
      {
        success: false,
        error,
        code,
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
import { persistIdempotencyResponse, releaseIdempotencyClaim } from '@/lib/api/idempotency'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { sendSMS } from '@/lib/twilio'
import { POST } from '@/app/api/event-bookings/route'

describe('event booking route SMS safety meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces logging_failed meta without returning a retry-triggering 500', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
    })

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: eventId,
        booking_mode: 'general',
        name: 'Test Event',
        date: '2026-01-01',
        start_datetime: '2026-01-01T19:00:00Z',
      },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
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
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              booking_id: 'booking-1',
              payment_mode: 'free',
              event_id: eventId,
              event_name: 'Test Event',
              event_start_datetime: '2026-01-01T19:00:00Z',
              seats_remaining: 10,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new NextRequest('http://localhost/api/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        seats: 2,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })
    expect(error).toHaveBeenCalledWith(
      'Event booking SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('treats success:false logging_failed as sent/unknown in sms meta', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: false,
      error: 'message log insert failed',
      code: 'logging_failed',
      logFailure: true,
    })

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: eventId,
        booking_mode: 'general',
        name: 'Test Event',
        date: '2026-01-01',
        start_datetime: '2026-01-01T19:00:00Z',
      },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
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
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              booking_id: 'booking-1',
              payment_mode: 'free',
              event_id: eventId,
              event_name: 'Test Event',
              event_start_datetime: '2026-01-01T19:00:00Z',
              seats_remaining: 10,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new NextRequest('http://localhost/api/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        seats: 2,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })
    expect(warn).not.toHaveBeenCalledWith(
      'Failed to send event booking SMS',
      expect.anything()
    )
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('surfaces unexpected_exception sms meta when booking SMS side-effect task rejects', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: eventId,
        booking_mode: 'general',
        name: 'Test Event',
        date: '2026-01-01',
        start_datetime: '2026-01-01T19:00:00Z',
      },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const customerMaybeSingle = vi.fn().mockRejectedValue(new Error('customer lookup blew up'))
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              booking_id: 'booking-1',
              payment_mode: 'free',
              event_id: eventId,
              event_name: 'Test Event',
              event_start_datetime: '2026-01-01T19:00:00Z',
              seats_remaining: 10,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new NextRequest('http://localhost/api/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        seats: 2,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      meta: {
        sms: {
          success: false,
          code: 'unexpected_exception',
          logFailure: false,
        },
      },
    })
    expect(warn).toHaveBeenCalledWith(
      'Event booking SMS task rejected unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-1',
          error: 'customer lookup blew up',
        }),
      })
    )
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('does not release the idempotency claim when response persistence fails after booking creation', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
    })

    ;(persistIdempotencyResponse as unknown as vi.Mock).mockRejectedValueOnce(new Error('idempotency write down'))

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: eventId,
        booking_mode: 'general',
        name: 'Test Event',
        date: '2026-01-01',
        start_datetime: '2026-01-01T19:00:00Z',
      },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
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
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              booking_id: 'booking-1',
              payment_mode: 'free',
              event_id: eventId,
              event_name: 'Test Event',
              event_start_datetime: '2026-01-01T19:00:00Z',
              seats_remaining: 10,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new NextRequest('http://localhost/api/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        seats: 2,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: expect.objectContaining({
        state: 'confirmed',
        booking_id: 'booking-1',
      }),
    })
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('fails closed when table-reservation rollback hold release updates zero rows but active holds still remain', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'
    const bookingId = 'booking-rollback-1'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: eventId,
        booking_mode: 'table',
        name: 'Test Event',
        date: '2026-01-01',
        start_datetime: '2026-01-01T19:00:00Z',
      },
      error: null,
    })
    const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
    const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

    const bookingCancelMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: bookingId },
      error: null,
    })
    const bookingCancelSelect = vi.fn().mockReturnValue({ maybeSingle: bookingCancelMaybeSingle })
    const bookingCancelEq = vi.fn().mockReturnValue({ select: bookingCancelSelect })
    const bookingUpdate = vi.fn().mockReturnValue({ eq: bookingCancelEq })

    const holdReleaseSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const holdReleaseEqStatus = vi.fn().mockReturnValue({ select: holdReleaseSelect })
    const holdReleaseEqHoldType = vi.fn().mockReturnValue({ eq: holdReleaseEqStatus })
    const holdReleaseEqBooking = vi.fn().mockReturnValue({ eq: holdReleaseEqHoldType })
    const holdUpdate = vi.fn().mockReturnValue({ eq: holdReleaseEqBooking })

    const holdVerifyEqStatus = vi.fn().mockResolvedValue({
      data: [{ id: 'hold-still-active' }],
      error: null,
    })
    const holdVerifyEqHoldType = vi.fn().mockReturnValue({ eq: holdVerifyEqStatus })
    const holdVerifyEqBooking = vi.fn().mockReturnValue({ eq: holdVerifyEqHoldType })
    const holdSelect = vi.fn().mockReturnValue({ eq: holdVerifyEqBooking })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'bookings') {
          return { update: bookingUpdate }
        }
        if (table === 'booking_holds') {
          return {
            update: holdUpdate,
            select: holdSelect,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_booking_v05') {
          return {
            data: {
              state: 'pending_payment',
              booking_id: bookingId,
              payment_mode: 'prepaid',
              hold_expires_at: '2026-01-01T20:00:00Z',
              event_id: eventId,
              event_name: 'Test Event',
              event_start_datetime: '2026-01-01T19:00:00Z',
              seats_remaining: 8,
            },
            error: null,
          }
        }
        if (name === 'create_event_table_reservation_v05') {
          return {
            data: {
              state: 'blocked',
              reason: 'no_table',
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new NextRequest('http://localhost/api/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        seats: 2,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({
      success: false,
      error: 'Failed to finalize booking after table reservation conflict',
      code: 'DATABASE_ERROR',
    })
    expect(sendSMS).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'Failed to rollback event booking after table reservation failure',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId,
          eventId,
          customerId,
        }),
      })
    )
  })
})
