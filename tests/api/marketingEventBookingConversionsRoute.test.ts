import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: fromMock,
  }),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn((handler: (request: Request, apiKey: unknown) => Promise<Response>, permissions: string[], request: Request) => {
    return handler(request, { id: 'api-key-1', permissions })
  }),
  createApiResponse: (data: unknown, status = 200) =>
    Response.json({ success: true, data }, { status }),
  createErrorResponse: (message: string, code: string, status = 400, details?: unknown) =>
    Response.json({ success: false, error: { message, code, details } }, { status }),
}))

import { GET } from '@/app/api/marketing/event-booking-conversions/route'

describe('GET /api/marketing/event-booking-conversions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns confirmed table bookings as marketing conversion truth', async () => {
    const gteMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'table-booking-1',
          event_id: 'event-1',
          event_booking_id: 'booking-1',
          party_size: 4,
          status: 'confirmed',
          source: 'brand_site',
          created_at: '2026-05-04T12:00:00.000Z',
        },
      ],
      error: null,
    })
    const orderMock = vi.fn().mockReturnValue({ gte: gteMock })
    const secondInMock = vi.fn().mockReturnValue({ order: orderMock })
    const firstInMock = vi.fn().mockReturnValue({ in: secondInMock })
    const selectMock = vi.fn().mockReturnValue({ in: firstInMock })
    fromMock.mockReturnValue({ select: selectMock })

    const response = await GET(new Request(
      'https://management.example.com/api/marketing/event-booking-conversions?event_ids=event-1&since=2026-05-01T00:00:00.000Z'
    ) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('table_bookings')
    expect(firstInMock).toHaveBeenCalledWith('event_id', ['event-1'])
    expect(secondInMock).toHaveBeenCalledWith('status', ['confirmed', 'seated', 'completed'])
    expect(gteMock).toHaveBeenCalledWith('created_at', '2026-05-01T00:00:00.000Z')
    expect(payload.data.conversions).toEqual([
      {
        booking_id: 'booking-1',
        table_booking_id: 'table-booking-1',
        event_id: 'event-1',
        booking_type: 'event',
        tickets: 4,
        source: 'brand_site',
        occurred_at: '2026-05-04T12:00:00.000Z',
      },
    ])
  })
})
