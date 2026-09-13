import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Constants } from '@/types/database.generated'

const fromMock = vi.fn()
const result: { data: unknown[] | null; error: { code: string } | null } = { data: [], error: null }
const gteMock = vi.fn(() => Promise.resolve(result))
const orderMock = vi.fn(() => ({ ...result, gte: gteMock }))
const statusMock = vi.fn((column: string, statuses: string[]) => {
  for (const status of statuses) {
    if (!(Constants.public.Enums.table_booking_status as readonly string[]).includes(status)) {
      throw new Error(`Invalid live booking status: ${status}`)
    }
  }
  return { order: orderMock }
})
const idsMock = vi.fn(() => ({ in: statusMock }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: fromMock }) }))
vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn((handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) => handler(request)),
  }
})

import { withApiAuth } from '@/lib/api/auth'
import { GET, OPTIONS } from '@/app/api/marketing/event-booking-conversions/route'

const eventId = '5cdadf74-97c1-4ec0-b495-d369a7304494'
const booking = {
  id: 'table-booking-1', event_id: eventId, event_booking_id: 'booking-1',
  party_size: 4, status: 'confirmed', source: 'brand_site', created_at: '2026-05-04T12:00:00.000Z',
}
function request(query = `event_ids=${eventId}&since=2026-05-01T00:00:00.000Z`) {
  return new NextRequest(`https://management.example.com/api/marketing/event-booking-conversions?${query}`)
}

describe('GET /api/marketing/event-booking-conversions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    result.data = [booking]
    result.error = null
    fromMock.mockReturnValue({ select: vi.fn(() => ({ in: idsMock })) })
  })

  it('returns booking evidence with valid database statuses including completed review journeys', async () => {
    const response = await GET(request())
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(idsMock).toHaveBeenCalledWith('event_id', [eventId])
    expect(statusMock).toHaveBeenCalledWith('status', ['confirmed', 'completed', 'visited_waiting_for_review', 'review_clicked'])
    expect(gteMock).toHaveBeenCalledWith('created_at', '2026-05-01T00:00:00.000Z')
    expect(payload.data.conversions).toEqual([{
      booking_id: 'booking-1', table_booking_id: booking.id, event_id: eventId,
      booking_type: 'event', tickets: 4, source: 'brand_site', occurred_at: booking.created_at,
    }])
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('ETag')).toBe(false)
    expect(withApiAuth).toHaveBeenCalledWith(expect.any(Function), ['read:events'], expect.any(Request), { cacheMode: 'private' })
  })

  it('returns an empty success when there are no qualifying bookings, including without since', async () => {
    result.data = []
    const response = await GET(request(`event_ids=${eventId}`))
    expect(await response.json()).toEqual({ success: true, data: { conversions: [], count: 0 } })
  })

  it('deduplicates valid event IDs', async () => {
    await GET(request(`event_ids=${eventId},${eventId}`))
    expect(idsMock).toHaveBeenCalledWith('event_id', [eventId])
  })

  it.each(['', 'event_ids=', 'event_ids=not-a-uuid', `event_ids=${eventId},`, `event_ids=${Array(101).fill(eventId).join(',')}`, `event_ids=${eventId}&since=bad-date`])(
    'rejects malformed inputs before querying: %s', async (query) => {
      const response = await GET(request(query))
      expect(response.status).toBe(400)
      expect(fromMock).not.toHaveBeenCalled()
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    },
  )

  it('reports database failure instead of successful zero conversions', async () => {
    result.data = null
    result.error = { code: '22P02' }
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe('DATABASE_ERROR')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('advertises only supported methods in preflight', async () => {
    const response = await OPTIONS(request())
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS')
  })
})
