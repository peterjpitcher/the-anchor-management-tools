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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { POST } from '@/app/api/foh/event-bookings/route'

describe('FOH event booking rollback safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 when table-reservation rollback persistence fails', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

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
        mobile_e164: '+441234567890',
        mobile_number: null,
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const bookingRollbackMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'booking cancel write failed' },
    })
    const bookingRollbackSelect = vi.fn().mockReturnValue({ maybeSingle: bookingRollbackMaybeSingle })
    const bookingRollbackEq = vi.fn().mockReturnValue({ select: bookingRollbackSelect })
    const bookingsUpdate = vi.fn().mockReturnValue({ eq: bookingRollbackEq })

    const bookingHoldRollbackEqStatus = vi.fn().mockResolvedValue({ error: null })
    const bookingHoldRollbackEqType = vi.fn().mockReturnValue({ eq: bookingHoldRollbackEqStatus })
    const bookingHoldRollbackEqBooking = vi.fn().mockReturnValue({ eq: bookingHoldRollbackEqType })
    const bookingHoldsUpdate = vi.fn().mockReturnValue({ eq: bookingHoldRollbackEqBooking })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return { select: eventSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        if (table === 'bookings') {
          return { update: bookingsUpdate }
        }
        if (table === 'booking_holds') {
          return { update: bookingHoldsUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn((name: string) => {
        if (name === 'create_event_booking_v05') {
          return Promise.resolve({
            data: {
              state: 'confirmed',
              booking_id: 'booking-1',
              payment_mode: 'free',
              event_name: 'Test Event',
              event_start_datetime: '2026-01-01T19:00:00Z',
            },
            error: null,
          })
        }

        if (name === 'create_event_table_reservation_v05') {
          return Promise.resolve({
            data: {
              state: 'blocked',
              reason: 'no_table',
            },
            error: null,
          })
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
  })
})
