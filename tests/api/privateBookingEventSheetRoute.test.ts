// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * The staff event sheet tells the team on the night whether outside food may be served. A
 * booking with "Outside food" ticked and a stored status of "not required" (a tick made before
 * the tick counted, 13 October 2026) used to print "no waiver needed" and no blocker.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  client: null as unknown,
  user: null as { id: string } | null,
  permission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: state.permission }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/pdf/anchor-logo', () => ({ getAnchorLogoDataUri: () => 'data:image/png;base64,AAAA' }))

import { GET } from '@/app/api/private-bookings/event-sheet/route'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const BLOCKER = 'Self-catering waiver is NOT signed'

let db: FakeDb

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'confirmed',
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_name: 'Sam Example',
    contact_phone: '+447700900123',
    event_type: 'Birthday party',
    event_date: '2026-12-05',
    start_time: '18:00',
    end_time: '23:00',
    end_time_next_day: false,
    guest_count: 40,
    supplier_status: 'not_applicable',
    risk_status: 'approved',
    outside_food: false,
    waiver_status: 'not_required',
    items: [],
    ...extra,
  }
}

function seed(booking: Row): void {
  db = createFakeDb({ private_bookings: [booking], private_booking_suppliers: [], private_booking_charge_batches: [] })
  state.client = db.client
}

function request(bookingId: string | null = BOOKING): NextRequest {
  const query = bookingId ? `?bookingId=${bookingId}` : ''
  return new NextRequest(`https://management.example.test/api/private-bookings/event-sheet${query}`)
}

async function sheetFor(booking: Row): Promise<string> {
  seed(booking)
  const response = await GET(request())
  expect(response.status).toBe(200)
  return response.text()
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'user-1' }
  state.permission.mockResolvedValue(true)
  seed(bookingRow())
})

describe('the food agreement on the staff event sheet', () => {
  it('blocks outside food for a booking with the tick on and a stored status of not required', async () => {
    const html = await sheetFor(bookingRow({ outside_food: true, waiver_status: 'not_required' }))

    expect(html).toContain(BLOCKER)
    expect(html).toContain('Outside food IS involved. Waiver status: REQUIRED.')
    expect(html).not.toContain('NOT_REQUIRED')
  })

  it.each(['required', 'sent', 'overdue'])('blocks outside food while the agreement is %s', async (status) => {
    const html = await sheetFor(bookingRow({ outside_food: true, waiver_status: status }))

    expect(html).toContain(BLOCKER)
    expect(html).toContain(`Waiver status: ${status.toUpperCase()}.`)
  })

  it('does not block once the agreement is signed', async () => {
    const html = await sheetFor(bookingRow({ outside_food: true, waiver_status: 'signed' }))

    expect(html).not.toContain(BLOCKER)
    expect(html).toContain('Outside food IS involved. Waiver status: SIGNED.')
  })

  it('does not block a booking with no outside food', async () => {
    const html = await sheetFor(bookingRow())

    expect(html).not.toContain(BLOCKER)
    expect(html).toContain('No outside food approved. Waiver status: NOT_REQUIRED.')
  })

  it('changes nothing: the sheet is opened by ordinary navigation', async () => {
    await sheetFor(bookingRow({ outside_food: true, waiver_status: 'not_required' }))

    expect(db.writes).toHaveLength(0)
    expect(db.rows('private_bookings')[0].waiver_status).toBe('not_required')
  })
})

describe('who may open the staff event sheet', () => {
  it('needs a booking id', async () => {
    expect((await GET(request(null))).status).toBe(400)
  })

  it('refuses someone who is not signed in', async () => {
    state.user = null
    expect((await GET(request())).status).toBe(401)
  })

  it('refuses someone who may not view private bookings', async () => {
    state.permission.mockResolvedValue(false)

    expect((await GET(request())).status).toBe(403)
    expect(state.permission).toHaveBeenCalledWith('private_bookings', 'view')
  })

  it('says so when the booking does not exist', async () => {
    expect((await GET(request('44444444-4444-4444-8444-444444444444'))).status).toBe(404)
  })
})
