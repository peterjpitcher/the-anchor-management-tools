import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
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

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
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

import { requireFohPermission } from '@/lib/foh/api-auth'
import { sendSMS } from '@/lib/twilio'
import { sendManagerTableBookingCreatedEmailIfAllowed } from '@/lib/table-bookings/bookings'
import { POST } from '@/app/api/foh/event-bookings/route'

describe('FOH event booking route SMS safety meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces logging_failed meta without returning a retry-triggering 500', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

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
        mobile_e164: '+447700900123',
        mobile_number: null,
        sms_status: 'active',
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const supabase = {
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
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new NextRequest('http://localhost/api/foh/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        customer_id: customerId,
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
      'FOH event booking SMS sent but outbound message logging failed',
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
        mobile_e164: '+447700900123',
        mobile_number: null,
        sms_status: 'active',
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const supabase = {
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
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new NextRequest('http://localhost/api/foh/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        customer_id: customerId,
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
      'Failed to send FOH event booking SMS',
      expect.anything()
    )
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('surfaces unexpected_exception sms meta when FOH booking SMS side-effect task rejects', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

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

    const customerMaybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: customerId,
          first_name: 'Pat',
          mobile_e164: '+447700900123',
          mobile_number: null,
          sms_status: 'active',
        },
        error: null,
      })
      .mockRejectedValueOnce(new Error('customer lookup blew up'))
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const supabase = {
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
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new NextRequest('http://localhost/api/foh/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        customer_id: customerId,
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
      'FOH event booking SMS task rejected unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-1',
          error: 'customer lookup blew up',
        }),
      })
    )
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('logs rejected manager email tasks instead of silently swallowing them', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(sendManagerTableBookingCreatedEmailIfAllowed as unknown as vi.Mock).mockRejectedValueOnce(new Error('smtp down'))

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

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
        mobile_e164: null,
        mobile_number: null,
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const tableBookingSeatedMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'table-booking-1' },
      error: null,
    })
    const tableBookingSeatedSelect = vi.fn().mockReturnValue({ maybeSingle: tableBookingSeatedMaybeSingle })
    const tableBookingSeatedIs = vi.fn().mockReturnValue({ select: tableBookingSeatedSelect })
    const tableBookingSeatedEq = vi.fn().mockReturnValue({ is: tableBookingSeatedIs })
    const tableBookingUpdate = vi.fn().mockReturnValue({ eq: tableBookingSeatedEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        if (table === 'table_bookings') {
          return { update: tableBookingUpdate }
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
        if (name === 'create_event_table_reservation_v05') {
          return {
            data: {
              state: 'confirmed',
              table_booking_id: 'table-booking-1',
              table_name: 'Table 1',
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new NextRequest('http://localhost/api/foh/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        customer_id: customerId,
        seats: 2,
        walk_in: true,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: expect.objectContaining({
        state: 'confirmed',
        table_booking_id: 'table-booking-1',
      }),
    })
    expect(warn).toHaveBeenCalledWith(
      'FOH event booking side-effect task rejected unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          label: 'email:manager_table_booking_created',
          tableBookingId: 'table-booking-1',
        }),
      })
    )
  })

  it('fails closed when table-reservation rollback hold release updates zero rows but active holds still remain', async () => {
    const eventId = '11111111-1111-4111-8111-111111111113'
    const customerId = '22222222-2222-4222-8222-222222222223'
    const bookingId = 'booking-rollback-foh-1'

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

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
        mobile_e164: '+447700900126',
        mobile_number: null,
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const bookingCancelMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: bookingId },
      error: null,
    })
    const bookingCancelSelect = vi.fn().mockReturnValue({ maybeSingle: bookingCancelMaybeSingle })
    const bookingCancelEq = vi.fn().mockReturnValue({ select: bookingCancelSelect })
    const bookingCancelUpdate = vi.fn().mockReturnValue({ eq: bookingCancelEq })

    const holdReleaseSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const holdReleaseEq3 = vi.fn().mockReturnValue({ select: holdReleaseSelect })
    const holdReleaseEq2 = vi.fn().mockReturnValue({ eq: holdReleaseEq3 })
    const holdReleaseEq1 = vi.fn().mockReturnValue({ eq: holdReleaseEq2 })
    const holdReleaseUpdate = vi.fn().mockReturnValue({ eq: holdReleaseEq1 })

    const remainingHoldEq3 = vi.fn().mockResolvedValue({
      data: [{ id: 'hold-remaining-1' }],
      error: null,
    })
    const remainingHoldEq2 = vi.fn().mockReturnValue({ eq: remainingHoldEq3 })
    const remainingHoldEq1 = vi.fn().mockReturnValue({ eq: remainingHoldEq2 })
    const remainingHoldSelect = vi.fn().mockReturnValue({ eq: remainingHoldEq1 })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        if (table === 'bookings') {
          return { update: bookingCancelUpdate }
        }
        if (table === 'booking_holds') {
          return {
            update: holdReleaseUpdate,
            select: remainingHoldSelect,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              booking_id: bookingId,
              payment_mode: 'free',
              event_id: eventId,
              event_name: 'Test Event',
              event_start_datetime: '2026-01-01T19:00:00Z',
              seats_remaining: 10,
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
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new NextRequest('http://localhost/api/foh/event-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        customer_id: customerId,
        seats: 2,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to finalize booking after table reservation conflict' })
    expect(remainingHoldSelect).toHaveBeenCalledWith('id')
    expect(sendSMS).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'Failed to rollback event booking after table reservation failure',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId,
          tableReservationState: 'blocked',
        }),
      })
    )
  })
})
