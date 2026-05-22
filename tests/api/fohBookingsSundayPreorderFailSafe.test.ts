import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
  mapTableBookingBlockedReason: vi.fn(() => 'no_table'),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import {
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
} from '@/lib/table-bookings/bookings'
import { POST } from '@/app/api/foh/bookings/route'

describe('FOH bookings retired Sunday preorder guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })
    ;(sendTableBookingCreatedSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({ sms: null })
    ;(sendManagerTableBookingCreatedEmailIfAllowed as unknown as vi.Mock).mockResolvedValue({
      sent: true,
    })
  })

  it('ignores stale FOH pre-order payload fields and creates a regular booking', async () => {
    const supabase = {
      rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
        if (fn === 'create_table_booking_v05') {
          expect(args).toEqual(
            expect.objectContaining({
              p_sunday_lunch: false,
            })
          )

          return Promise.resolve({
            data: {
              state: 'confirmed',
              table_booking_id: 'tb-1',
              booking_reference: 'TB-1',
              start_datetime: '2026-06-28T12:30:00.000Z',
              party_size: 2,
              table_name: 'A',
            },
            error: null,
          })
        }

        throw new Error(`Unexpected rpc: ${fn}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new Request('http://localhost/api/foh/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        phone: '+447700900111',
        first_name: 'Pat',
        last_name: 'Guest',
        date: '2026-06-28',
        time: '13:30',
        party_size: 2,
        purpose: 'food',
        sunday_lunch: true,
        sunday_preorder_mode: 'capture_now',
        sunday_preorder_items: [
          { menu_dish_id: 'not-a-uuid', quantity: 1 },
        ],
      }),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          state: 'confirmed',
          table_booking_id: 'tb-1',
          sunday_preorder_state: 'not_applicable',
          sunday_preorder_reason: null,
        }),
      })
    )
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledTimes(1)
  })

  it('does not auto-promote Sunday food bookings into the legacy sunday_lunch type', async () => {
    const supabase = {
      rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
        if (fn === 'create_table_booking_v05') {
          expect(args.p_sunday_lunch).toBe(false)

          return Promise.resolve({
            data: {
              state: 'confirmed',
              table_booking_id: 'tb-2',
              booking_reference: 'TB-2',
              start_datetime: '2026-06-28T12:30:00.000Z',
              party_size: 2,
              table_name: 'B',
            },
            error: null,
          })
        }

        throw new Error(`Unexpected rpc: ${fn}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-2',
      supabase,
    })

    const request = new Request('http://localhost/api/foh/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        phone: '+447700900222',
        first_name: 'Pat',
        last_name: 'Guest',
        date: '2026-06-28',
        time: '13:30',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.data).toEqual(
      expect.objectContaining({
        table_booking_id: 'tb-2',
        sunday_preorder_state: 'not_applicable',
        sunday_preorder_reason: null,
      })
    )

    const serviceWindowChecks = (supabase.rpc as unknown as vi.Mock).mock.calls.filter(
      ([fn]) => fn === 'table_booking_matches_service_window_v05'
    )
    expect(serviceWindowChecks).toHaveLength(0)
  })
})
