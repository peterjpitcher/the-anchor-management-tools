import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { requireFohPermission } from '@/lib/foh/api-auth'

// Private hire blocks come from the database list (private_hire_table_blocks, service-role only),
// read with the admin client after the FOH permission check.
const adminRpc = vi.fn()
const adminFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: adminRpc, from: adminFrom })),
}))

vi.mock('@/lib/foh/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/foh/api-auth')>('@/lib/foh/api-auth')
  return {
    ...actual,
    requireFohPermission: vi.fn(),
  }
})

const SERVICE_DATE = '2026-07-08'

// Build a chainable Supabase query-builder mock. Every filter/order method returns
// the same builder (so calls chain), and the builder is thenable + .maybeSingle()/
// .single() resolve to the per-table `result`.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'gte', 'lte', 'gt', 'lt', 'is', 'order']) {
    builder[method] = vi.fn(chain)
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.single = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return builder
}

type FromResults = Record<string, { data: unknown; error: unknown }>

function createSupabaseMock(fromResults: FromResults) {
  const defaults: FromResults = {
    tables: { data: [], error: null },
    table_bookings: { data: [], error: null },
    // The weekly hours now come from the effective-dated resolver RPC rather than
    // a business_hours table read, so the key below feeds `rpc`, not `from`. It
    // returns a set, hence an array.
    business_hours_for_date: { data: [], error: null },
    special_hours: { data: null, error: null },
    table_areas: { data: [], error: null },
    events: { data: [], error: null },
    booking_table_assignments: { data: [], error: null },
    private_bookings: { data: [], error: null },
    event_communal_seat_allocations: { data: [], error: null },
    bookings: { data: [], error: null },
    private_booking_items: { data: [], error: null },
    venue_space_table_areas: { data: [], error: null },
  }
  const merged = { ...defaults, ...fromResults }
  const from = vi.fn((table: string) => makeBuilder(merged[table] ?? { data: null, error: null }))
  const rpc = vi.fn(async (fn: string) => merged[fn] ?? { data: null, error: null })
  return { from, rpc }
}

function mockAuthSuccess(dbMock: Record<string, unknown>) {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: true,
    userId: 'user-1',
    supabase: dbMock as unknown as Extract<Awaited<ReturnType<typeof requireFohPermission>>, { ok: true }>['supabase'],
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

const makeRequest = () =>
  new NextRequest(`http://localhost/api/foh/schedule?date=${SERVICE_DATE}`)

// A single bookable indoor table so lanes are non-empty and any accidental outside
// lane would be visible alongside a real one.
const INDOOR_TABLE = {
  id: 'table-1',
  table_number: '1',
  name: 'Table 1',
  capacity: 4,
  area: 'Main',
  area_id: null,
  is_bookable: true,
}

// Two outside bookings that overlap in time (18:00–19:30 and 18:30–20:00). Neither
// has a table assignment, so both fall into the untabled bucket and — being outside —
// into outside_bookings. In the old single "Outside" lane these would have collided.
const OUTSIDE_BOOKING_A = {
  id: 'outside-a',
  booking_reference: 'TB-OUTA',
  booking_date: SERVICE_DATE,
  booking_time: '18:00',
  party_size: 2,
  booking_type: 'regular',
  booking_purpose: 'food',
  status: 'confirmed',
  start_datetime: `${SERVICE_DATE}T17:00:00.000Z`,
  end_datetime: `${SERVICE_DATE}T18:30:00.000Z`,
  event_id: null,
  high_chair_count: 0,
  is_outside_seating: true,
  customer: { first_name: 'Ada', last_name: 'Outside' },
}
const OUTSIDE_BOOKING_B = {
  id: 'outside-b',
  booking_reference: 'TB-OUTB',
  booking_date: SERVICE_DATE,
  booking_time: '18:30',
  party_size: 4,
  booking_type: 'regular',
  booking_purpose: 'food',
  status: 'confirmed',
  start_datetime: `${SERVICE_DATE}T17:30:00.000Z`,
  end_datetime: `${SERVICE_DATE}T19:00:00.000Z`,
  event_id: null,
  high_chair_count: 0,
  is_outside_seating: true,
  customer: { first_name: 'Grace', last_name: 'Outside' },
}

describe('GET /api/foh/schedule: private hire blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminRpc.mockResolvedValue({ data: [], error: null })
    adminFrom.mockImplementation(() => makeBuilder({ data: [], error: null }))
  })

  const AREA_TABLE = { ...INDOOR_TABLE, area_id: 'area-1' }
  const HIDDEN_TABLE = { ...INDOOR_TABLE, id: 'table-hidden', table_number: '9', name: 'Table 9', is_bookable: false }
  const hire = (id: string, guest_count: number | null) => ({
    id,
    customer_name: 'Fixture Hire',
    customer_first_name: 'Fixture',
    customer_last_name: 'Hire',
    event_type: 'Birthday',
    start_time: '18:00:00',
    guest_count,
  })

  // BK-159: the screen draws the tables the database takes off sale, for exactly the times it
  // holds them (setup, clear-down and turnaround included), instead of recomputing the window.
  // Which hires count, and the window across clock changes, are tested against the SQL in
  // scripts/testing/private-hire-room-window-postgres.py.
  it('draws the blocks the database returns, with the party size, for the schedule window', async () => {
    adminRpc.mockResolvedValue({
      data: [
        { private_booking_id: 'pb-1', table_id: 'table-1', blocked_from: '2026-07-08T16:30:00+00:00', blocked_until: '2026-07-08T23:30:00+00:00' },
        { private_booking_id: 'pb-1', table_id: 'table-hidden', blocked_from: '2026-07-08T16:30:00+00:00', blocked_until: '2026-07-08T23:30:00+00:00' },
        { private_booking_id: 'pb-2', table_id: 'table-1', blocked_from: '2026-07-08T11:00:00+00:00', blocked_until: '2026-07-08T15:30:00+00:00' },
      ],
      error: null,
    })
    adminFrom.mockImplementation((table: string) =>
      makeBuilder(table === 'private_bookings' ? { data: [hire('pb-1', 30), hire('pb-2', null)], error: null } : { data: [], error: null }))
    const db = createSupabaseMock({ tables: { data: [AREA_TABLE, HIDDEN_TABLE], error: null } })
    mockAuthSuccess(db)

    const res = await GET(makeRequest())
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(adminRpc).toHaveBeenCalledWith('private_hire_table_blocks', {
      // Midnight to 6am the next morning on the London clock (BST in July).
      p_window_start: '2026-07-07T23:00:00.000Z',
      p_window_end: '2026-07-09T05:00:00.000Z',
    })
    const lanes = payload.data.lanes as Array<{ table_id: string; bookings: Array<Record<string, unknown>> }>
    expect(lanes.map((lane) => lane.table_id)).toEqual(['table-1'])
    const blocks = lanes[0].bookings.filter((b) => b.is_private_block)
    expect(blocks.map((b) => b.private_booking_id).sort()).toEqual(['pb-1', 'pb-2'])
    expect(blocks.find((b) => b.private_booking_id === 'pb-1')).toMatchObject({
      party_size: 30,
      start_datetime: '2026-07-08T16:30:00+00:00',
      end_datetime: '2026-07-08T23:30:00+00:00',
      booking_reference: 'PB-PB-1',
      guest_name: 'Fixture Hire',
    })
    expect(blocks.find((b) => b.private_booking_id === 'pb-2')!.party_size).toBeNull()
    expect(payload.data.private_hires_unavailable).toBe(false)
  })

  it('says so, and draws no blocks, when the hires cannot be read', async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const db = createSupabaseMock({ tables: { data: [AREA_TABLE], error: null } })
    mockAuthSuccess(db)

    const res = await GET(makeRequest())
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.data.private_hires_unavailable).toBe(true)
    expect(payload.data.lanes[0].bookings.filter((b: { is_private_block?: boolean }) => b.is_private_block)).toEqual([])
  })

  it('says so when the hire details cannot be read', async () => {
    adminRpc.mockResolvedValue({
      data: [{ private_booking_id: 'pb-1', table_id: 'table-1', blocked_from: '2026-07-08T16:30:00+00:00', blocked_until: '2026-07-08T23:30:00+00:00' }],
      error: null,
    })
    adminFrom.mockImplementation(() => makeBuilder({ data: null, error: { message: 'timeout' } }))
    const db = createSupabaseMock({ tables: { data: [AREA_TABLE], error: null } })
    mockAuthSuccess(db)

    const payload = await (await GET(makeRequest())).json()

    expect(payload.data.private_hires_unavailable).toBe(true)
  })
})

describe('GET /api/foh/schedule — outside bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns overlapping outside bookings as a list and emits no __outside__ lane', async () => {
    const db = createSupabaseMock({
      tables: { data: [INDOOR_TABLE], error: null },
      table_bookings: { data: [OUTSIDE_BOOKING_A, OUTSIDE_BOOKING_B], error: null },
    })
    mockAuthSuccess(db)

    const res = await GET(makeRequest())
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)

    const lanes = payload.data.lanes as Array<{ table_id: string }>
    // (a) No virtual "__outside__" lane is emitted.
    expect(lanes.some((lane) => lane.table_id === '__outside__')).toBe(false)
    // Only the real indoor table lane is present.
    expect(lanes).toHaveLength(1)
    expect(lanes[0].table_id).toBe('table-1')

    const outside = payload.data.outside_bookings as Array<{ id: string }>
    // (b) & (c) Both overlapping outside bookings appear in outside_bookings.
    const outsideIds = outside.map((b) => b.id)
    expect(outsideIds).toContain('outside-a')
    expect(outsideIds).toContain('outside-b')
    expect(outsideIds).toHaveLength(2)

    // Outside bookings are not duplicated into unassigned_bookings.
    const unassignedIds = (payload.data.unassigned_bookings as Array<{ id: string }>).map((b) => b.id)
    expect(unassignedIds).not.toContain('outside-a')
    expect(unassignedIds).not.toContain('outside-b')
  })

  it('sorts outside_bookings by start_datetime (fallback to booking_time then id)', async () => {
    // Provide B before A in the source rows to prove sorting is applied.
    const db = createSupabaseMock({
      tables: { data: [INDOOR_TABLE], error: null },
      table_bookings: { data: [OUTSIDE_BOOKING_B, OUTSIDE_BOOKING_A], error: null },
    })
    mockAuthSuccess(db)

    const res = await GET(makeRequest())
    const payload = await res.json()

    const outsideIds = (payload.data.outside_bookings as Array<{ id: string }>).map((b) => b.id)
    // A starts 17:00Z, B starts 17:30Z → A first.
    expect(outsideIds).toEqual(['outside-a', 'outside-b'])
  })

  it('should order a null-start_datetime booking by its London-local time, not as a string', async () => {
    // Regression: start_datetime is a UTC timestamptz but booking_time is London-local.
    // The old `start_datetime || booking_time` string compare put C first, because
    // '19:00' sorts before '2026-…'. In BST: A = 18:00 London (17:00Z),
    // C = 19:00 London (18:00Z) → A must come first.
    const OUTSIDE_BOOKING_C = {
      ...OUTSIDE_BOOKING_A,
      id: 'outside-c',
      booking_reference: 'TB-OUTC',
      booking_time: '19:00',
      start_datetime: null,
      end_datetime: null,
      customer: { first_name: 'Cara', last_name: 'Outside' },
    }
    const db = createSupabaseMock({
      tables: { data: [INDOOR_TABLE], error: null },
      table_bookings: { data: [OUTSIDE_BOOKING_C, OUTSIDE_BOOKING_A], error: null },
    })
    mockAuthSuccess(db)

    const res = await GET(makeRequest())
    const payload = await res.json()

    const outsideIds = (payload.data.outside_bookings as Array<{ id: string }>).map((b) => b.id)
    expect(outsideIds).toEqual(['outside-a', 'outside-c'])
  })

  it('should keep an outside booking out of the lanes even if a stray table assignment exists', async () => {
    // Defence-in-depth: the create RPC and the move guards stop an outside booking ever
    // holding a table, but the view must not depend on that invariant.
    const db = createSupabaseMock({
      tables: { data: [INDOOR_TABLE], error: null },
      table_bookings: { data: [OUTSIDE_BOOKING_A], error: null },
      booking_table_assignments: {
        data: [{ table_booking_id: 'outside-a', table_id: 'table-1' }],
        error: null,
      },
    })
    mockAuthSuccess(db)

    const res = await GET(makeRequest())
    const payload = await res.json()

    const laneBookingIds = (payload.data.lanes as Array<{ bookings: Array<{ id: string }> }>)
      .flatMap((lane) => lane.bookings.map((b) => b.id))
    expect(laneBookingIds).not.toContain('outside-a')
    expect((payload.data.outside_bookings as Array<{ id: string }>).map((b) => b.id)).toEqual([
      'outside-a',
    ])
  })

  it('keeps genuinely-untabled indoor bookings in unassigned_bookings, not outside', async () => {
    const indoorUntabled = {
      ...OUTSIDE_BOOKING_A,
      id: 'indoor-untabled',
      booking_reference: 'TB-IND',
      is_outside_seating: false,
      customer: { first_name: 'Indoor', last_name: 'Guest' },
    }
    const db = createSupabaseMock({
      tables: { data: [INDOOR_TABLE], error: null },
      table_bookings: { data: [indoorUntabled], error: null },
    })
    mockAuthSuccess(db)

    const res = await GET(makeRequest())
    const payload = await res.json()

    const outsideIds = (payload.data.outside_bookings as Array<{ id: string }>).map((b) => b.id)
    const unassignedIds = (payload.data.unassigned_bookings as Array<{ id: string }>).map((b) => b.id)
    expect(outsideIds).not.toContain('indoor-untabled')
    expect(unassignedIds).toContain('indoor-untabled')
  })
})
