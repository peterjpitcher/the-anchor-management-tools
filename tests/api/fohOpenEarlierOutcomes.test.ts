import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-130 (owner decision D13): table bookings from earlier days that nobody marked stay
 * 'confirmed' for good. FOH and BOH now list the last seven days of them with one-tap Arrived and
 * No-show. Nothing is marked automatically.
 */

const state = vi.hoisted(() => ({ db: null as unknown, ok: true }))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(async () =>
    state.ok
      ? { ok: true, supabase: state.db, userId: 'staff-1' }
      : { ok: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) }
  ),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/business-hours/trading-day', () => ({ resolveTradingDayNow: vi.fn(async () => ({ date: '2026-10-26' })) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET } from '@/app/api/foh/bookings/open-earlier/route'
import { POST } from '@/app/api/foh/bookings/[id]/outcome/route'

const OPEN = '11111111-1111-4111-8111-111111111111'
const TODAY = '22222222-2222-4222-8222-222222222222'
const LINKED = '33333333-3333-4333-8333-333333333333'

function booking(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    booking_reference: `TB-${id.slice(0, 4)}`,
    customer_id: 'customer-1',
    booking_date: '2026-10-24',
    booking_time: '18:00:00',
    party_size: 4,
    status: 'confirmed',
    start_datetime: '2026-10-24T17:00:00.000Z',
    end_datetime: '2026-10-24T19:00:00.000Z',
    seated_at: null,
    left_at: null,
    no_show_at: null,
    event_booking_id: null,
    ...overrides,
  }
}

function seed(): FakeSupabase {
  const db = createFakeSupabase({
    customers: [{ id: 'customer-1', first_name: 'Sam', last_name: 'Guest' }],
    table_bookings: [
      booking(OPEN),
      booking(TODAY, { booking_date: '2026-10-26' }),
      booking(LINKED, { event_booking_id: 'event-booking-1' }),
      booking('44444444-4444-4444-8444-444444444444', { booking_date: '2026-10-18' }),
      booking('55555555-5555-4555-8555-555555555555', { seated_at: '2026-10-24T17:05:00.000Z' }),
      booking('66666666-6666-4666-8666-666666666666', { status: 'no_show', no_show_at: '2026-10-24T18:00:00.000Z' }),
      booking('77777777-7777-4777-8777-777777777777', { status: 'cancelled' }),
      booking('88888888-8888-4888-8888-888888888888', { booking_date: '2026-10-19' }),
    ],
  })
  state.db = db
  return db
}

function post(id: string, outcome: string) {
  return POST(
    new Request(`http://localhost/api/foh/bookings/${id}/outcome`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    }) as never,
    { params: Promise.resolve({ id }) }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.ok = true
})

describe('still open from earlier (BK-130)', () => {
  it('lists the last seven days of confirmed bookings nobody marked, leaving out today and event tables', async () => {
    seed()
    const response = await GET()
    const payload = await response.json()
    expect(response.status).toBe(200)
    const ids = payload.data.bookings.map((row: { id: string }) => row.id).sort()
    expect(ids).toEqual([OPEN, '88888888-8888-4888-8888-888888888888'])
    expect(payload.data.bookings.find((row: { id: string }) => row.id === OPEN)).toEqual({
      id: OPEN, bookingReference: 'TB-1111', bookingDate: '2026-10-24', bookingTime: '18:00:00', partySize: 4, guestName: 'Sam Guest',
    })
  })

  it('marks an earlier booking as arrived at its own start and end, leaving the status alone', async () => {
    const db = seed()
    const response = await post(OPEN, 'arrived')
    expect(response.status).toBe(200)
    const row = db.tables.table_bookings.find((candidate) => candidate.id === OPEN)
    expect(row).toMatchObject({
      status: 'confirmed',
      seated_at: '2026-10-24T17:00:00.000Z',
      left_at: '2026-10-24T19:00:00.000Z',
      no_show_at: null,
    })
  })

  it('marks an earlier booking as a no-show with who did it', async () => {
    const db = seed()
    const response = await post(OPEN, 'no_show')
    expect(response.status).toBe(200)
    expect(db.tables.table_bookings.find((candidate) => candidate.id === OPEN)).toMatchObject({
      status: 'no_show', no_show_at: expect.any(String), no_show_marked_by: 'staff-1',
    })
  })

  it('leaves today to the floor, events to the event page, and marked bookings alone', async () => {
    seed()
    const today = await post(TODAY, 'no_show')
    expect(today.status).toBe(409)
    expect((await today.json()).error).toBe('Mark today\'s bookings from the floor.')

    const linked = await post(LINKED, 'arrived')
    expect(linked.status).toBe(409)
    expect((await linked.json()).error).toBe('Record who came to an event on the event page.')

    const seated = await post('55555555-5555-4555-8555-555555555555', 'no_show')
    expect(seated.status).toBe(409)
    expect((await seated.json()).error).toBe('This booking already has an outcome.')
  })

  it('refuses an unknown outcome and a login without FOH edit', async () => {
    seed()
    expect((await post(OPEN, 'completed')).status).toBe(400)
    state.ok = false
    expect((await post(OPEN, 'arrived')).status).toBe(403)
  })

  it('reports a failed write instead of claiming success', async () => {
    const db = seed()
    db.failures.push({ table: 'table_bookings', op: 'update', error: { message: 'boom' } })
    const response = await post(OPEN, 'arrived')
    expect(response.status).toBe(500)
  })
})
