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
  alignTableCardCaptureHoldToScheduledSend: vi.fn(),
  createTableCardCaptureToken: vi.fn(),
  mapTableBookingBlockedReason: vi.fn(() => 'no_table'),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn(),
  sendSundayPreorderLinkSmsIfAllowed: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  saveSundayPreorderByBookingId: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { sendSundayPreorderLinkSmsIfAllowed, sendManagerTableBookingCreatedEmailIfAllowed, sendTableBookingCreatedSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { saveSundayPreorderByBookingId } from '@/lib/table-bookings/sunday-preorder'
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/foh/bookings/route'

describe('FOH bookings Sunday preorder fail-safe guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not return a retry-driving 500 when capture_now throws after booking creation', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })

    ;(sendTableBookingCreatedSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({
      sms: null,
    })

    ;(sendManagerTableBookingCreatedEmailIfAllowed as unknown as vi.Mock).mockResolvedValue({
      sent: true,
    })

    ;(saveSundayPreorderByBookingId as unknown as vi.Mock).mockRejectedValueOnce(new Error('db down'))

    ;(sendSundayPreorderLinkSmsIfAllowed as unknown as vi.Mock).mockResolvedValueOnce({
      sent: true,
      scheduledFor: undefined,
      url: 'http://localhost/preorder',
      sms: null,
    })

    const supabase = {
      rpc: vi.fn((fn: string) => {
        if (fn === 'create_table_booking_v05') {
          return Promise.resolve({
            data: {
              state: 'confirmed',
              table_booking_id: 'tb-1',
              booking_reference: 'TB-1',
              start_datetime: '2026-02-16T12:00:00.000Z',
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
        date: '2026-02-16',
        time: '12:00',
        party_size: 2,
        purpose: 'food',
        sunday_lunch: true,
        sunday_preorder_mode: 'capture_now',
        sunday_preorder_items: [
          { menu_dish_id: '123e4567-e89b-12d3-a456-426614174000', quantity: 1 },
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
          sunday_preorder_state: 'link_sent',
          sunday_preorder_reason: 'capture_failed:capture_exception',
        }),
      })
    )

    expect(saveSundayPreorderByBookingId).toHaveBeenCalledTimes(1)
    expect(sendSundayPreorderLinkSmsIfAllowed).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to capture Sunday pre-order during FOH booking create',
      expect.any(Object)
    )
  })

  it('auto-promotes Sunday lunch slot bookings so 13:30 Sunday food bookings do not fail as outside hours', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-2',
      resolutionError: undefined,
    })

    ;(sendTableBookingCreatedSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({
      sms: null,
    })

    ;(sendManagerTableBookingCreatedEmailIfAllowed as unknown as vi.Mock).mockResolvedValue({
      sent: true,
    })

    ;(sendSundayPreorderLinkSmsIfAllowed as unknown as vi.Mock).mockResolvedValueOnce({
      sent: true,
      scheduledFor: undefined,
      url: 'http://localhost/preorder',
      sms: null,
    })

    const supabase = {
      rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
        if (fn === 'table_booking_matches_service_window_v05') {
          return Promise.resolve({
            data: args.p_sunday_lunch === true,
            error: null,
          })
        }

        if (fn === 'create_table_booking_v05') {
          expect(args).toEqual(
            expect.objectContaining({
              p_sunday_lunch: true,
            })
          )

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
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          state: 'confirmed',
          table_booking_id: 'tb-2',
          sunday_preorder_state: 'link_sent',
        }),
      })
    )

    const serviceWindowChecks = (supabase.rpc as unknown as vi.Mock).mock.calls.filter(
      ([fn]) => fn === 'table_booking_matches_service_window_v05'
    )
    expect(serviceWindowChecks).toHaveLength(2)
    expect(sendSundayPreorderLinkSmsIfAllowed).toHaveBeenCalledTimes(1)
  })
})
