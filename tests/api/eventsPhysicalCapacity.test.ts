import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (req: Request, key: unknown) => Promise<Response>, _permissions: string[], req?: Request) => handler(req ?? new Request('http://localhost/api/events'), {})),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json({ success: true, data }, { status })),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) => Response.json({ success: false, error: { code, message } }, { status })),
  createCorsPreflightResponse: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/events/route'
import { FakeDb } from '../lib/insights/helpers/fake-db'

function setup(mode: string, failure?: 'missing' | 'error', seatedRemaining = 7) {
  const db = new FakeDb({ events: [{
    id: 'physical-event', name: 'Quiz', slug: 'quiz', date: '2099-09-25', time: '19:00',
    booking_mode: mode, capacity: 999, seated_capacity: 999, standing_capacity: 200,
    event_status: 'scheduled', bookings_enabled: true, price: 0, is_free: true,
    event_faqs: [], category: null,
  }], event_ticket_types: [] })
  db.rpcHandlers.get_event_capacity_snapshot_v05 = () => failure === 'missing' ? [] : [{
    event_id: 'physical-event', capacity: 49, communal_seated_capacity: 39, standing_capacity: 10,
    seats_remaining: seatedRemaining, seated_remaining: seatedRemaining, standing_remaining: 10,
    total_remaining: seatedRemaining + 10, is_full: false,
  }]
  if (failure === 'error') db.fail('get_event_capacity_snapshot_v05')
  db.rpcHandlers.events_closed_by_whole_pub_hire = () => []
  vi.mocked(createAdminClient).mockReturnValue(db.asDb())
  return db
}

describe('events list physical capacity', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['table', 'communal'])('returns the physical snapshot for %s events', async mode => {
    const db = setup(mode)
    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/events'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.events[0]).toMatchObject({
      maximumAttendeeCapacity: 49, seated_capacity: 39, standing_capacity: 10,
      seated_remaining: 7, standing_remaining: 10, total_remaining: 17, waitlist_enabled: true,
    })
    expect(JSON.stringify(body)).not.toContain('999')
    expect(db.calls.filter(call => call.kind === 'rpc')).toEqual([
      { table: 'get_event_capacity_snapshot_v05', kind: 'rpc', args: { p_event_ids: ['physical-event'] } },
      { table: 'events_closed_by_whole_pub_hire', kind: 'rpc', args: { p_event_ids: ['physical-event'] } },
    ])
    expect(body.data.events[0].bookings_enabled).toBe(true)
  })

  // Owner decision D24: a whole-pub private hire stops ticket sales, so the website stops offering them.
  it('reports bookings closed for an event a whole-pub hire has taken', async () => {
    const db = setup('table')
    db.rpcHandlers.events_closed_by_whole_pub_hire = () => [{ event_id: 'physical-event', private_booking_id: 'hire-1' }]
    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/events'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.events[0].bookings_enabled).toBe(false)
    expect(JSON.stringify(body)).not.toContain('hire-1')
  })

  it('still serves the list when the hire check fails, as the booking function refuses anyway', async () => {
    const db = setup('table')
    db.fail('events_closed_by_whole_pub_hire')
    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/events'))
    expect(response.status).toBe(200)
    expect((await response.json()).data.events[0].bookings_enabled).toBe(true)
  })

  it('keeps standing availability distinct when the seated pool is exhausted', async () => {
    setup('communal', undefined, 0)
    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/events'))
    expect(response.status).toBe(200)
    expect((await response.json()).data.events[0]).toMatchObject({ seated_remaining: 0, standing_remaining: 10, total_remaining: 10, is_full: false })
  })

  it.each(['missing', 'error'] as const)('returns 503 instead of stored capacity when the snapshot is %s', async failure => {
    setup('communal', failure)
    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/events'))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AVAILABILITY_UNAVAILABLE')
  })
})
