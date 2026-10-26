import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  requireBohTableBookingPermission: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { carriedTurnaroundMs, getMoveTableAvailability } from '@/lib/table-bookings/move-table'
import { updateTableBookingPartySizeWithLinkedEventSeats } from '@/lib/events/staff-seat-updates'
import { POST as postFohMoveTable } from '@/app/api/foh/bookings/[id]/move-table/route'
import { NextRequest } from 'next/server'

/**
 * BK-037 (customer bookings review of 24 October 2026): a booking's table is held for the guest's
 * time plus a 15-minute turnaround. Moving it to another table, growing the party onto a bigger
 * one, or (most often) the FOH walk-in that is created and then moved a second later, all wrote the
 * guest's end as the table's end, so the table looked free the moment the guest's time was up.
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER_BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const TABLE_CURRENT = 'bbbbbbbb-0000-4000-8000-000000000001' // seats 4, where the booking is now
const TABLE_TIGHT = 'bbbbbbbb-0000-4000-8000-000000000002' // seats 4, next party sits at 21:05
const TABLE_FREE = 'bbbbbbbb-0000-4000-8000-000000000003' // seats 6, free all evening

// Saturday 7 November 2026 is GMT, so London and UTC agree and the test reads the same in both zones.
const GUEST_START = '2026-11-07T19:00:00.000Z'
const GUEST_END = '2026-11-07T21:00:00.000Z'
const TABLE_END = '2026-11-07T21:15:00.000Z'

type Db = FakeSupabase & { rpc: ReturnType<typeof vi.fn> }

function seed(options: { gapCarried?: boolean; settings?: { enabled: boolean; gap: number } } = {}): Db {
  const gapCarried = options.gapCarried ?? true
  const db = createFakeSupabase({
    tables: [
      { id: TABLE_CURRENT, table_number: '1', name: 'One', capacity: 4, is_bookable: true },
      { id: TABLE_TIGHT, table_number: '2', name: 'Two', capacity: 4, is_bookable: true },
      { id: TABLE_FREE, table_number: '3', name: 'Three', capacity: 6, is_bookable: true },
    ],
    table_join_links: [],
    event_communal_seat_allocations: [],
    table_bookings: [
      {
        id: BOOKING_ID,
        booking_date: '2026-11-07',
        booking_time: '19:00:00',
        start_datetime: GUEST_START,
        end_datetime: GUEST_END,
        duration_minutes: 120,
        party_size: 4,
        committed_party_size: 4,
        status: 'confirmed',
        event_booking_id: null,
        event_id: null,
        booking_type: 'regular',
        christmas_course_counts: null,
        booking_period_answer: null,
      },
      { id: OTHER_BOOKING_ID, status: 'confirmed', left_at: null },
    ],
    booking_table_assignments: [
      ...(gapCarried
        ? [{ id: 'assign-1', table_booking_id: BOOKING_ID, table_id: TABLE_CURRENT, start_datetime: GUEST_START, end_datetime: TABLE_END }]
        : []),
      // The next party on table Two sits down at 21:05: inside our turnaround, outside our guest window.
      { id: 'assign-2', table_booking_id: OTHER_BOOKING_ID, table_id: TABLE_TIGHT, start_datetime: '2026-11-07T21:05:00.000Z', end_datetime: '2026-11-07T23:00:00.000Z' },
    ],
  }) as Db

  const settings = options.settings ?? { enabled: true, gap: 15 }
  db.rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    if (fn === 'is_table_blocked_by_private_booking_v05') return Promise.resolve({ data: false, error: null })
    if (fn === 'get_setting_bool') return Promise.resolve({ data: settings.enabled, error: null })
    if (fn === 'get_setting_int') return Promise.resolve({ data: settings.gap, error: null })
    if (fn === 'move_table_booking_assignments_v05') {
      return Promise.resolve({ data: { state: 'moved', table_ids: args.p_table_ids }, error: null })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } })
  })
  return db
}

const BOOKING = {
  id: BOOKING_ID,
  booking_date: '2026-11-07',
  booking_time: '19:00:00',
  start_datetime: GUEST_START,
  end_datetime: GUEST_END,
  duration_minutes: 120,
  party_size: 4,
}

function moveCalls(db: Db) {
  return db.rpc.mock.calls.filter(([fn]) => fn === 'move_table_booking_assignments_v05').map(([, args]) => args)
}

describe('carriedTurnaroundMs', () => {
  it('is the latest table end beyond the guest end', () => {
    expect(carriedTurnaroundMs(GUEST_END, [TABLE_END, GUEST_END])).toBe(15 * 60 * 1000)
  })

  it('is never negative and is null with no table held', () => {
    expect(carriedTurnaroundMs(GUEST_END, ['2026-11-07T20:30:00.000Z'])).toBe(0)
    expect(carriedTurnaroundMs(GUEST_END, [])).toBeNull()
    expect(carriedTurnaroundMs('not a date', [TABLE_END])).toBeNull()
  })
})

describe('moves keep the turnaround the booking carries', () => {
  let db: Db
  beforeEach(() => {
    db = seed()
  })

  it('checks every table against the guest end plus the turnaround', async () => {
    const availability = await getMoveTableAvailability(db as never, BOOKING)

    expect(availability.bookingEndIso).toBe(GUEST_END)
    expect(availability.endIso).toBe(TABLE_END)
    expect(availability.turnaroundMinutes).toBe(15)
    const offered = availability.tables.map((option) => option.table_ids.join(','))
    // Table Two's next party sits down at 21:05, inside our 15 minutes, so it is not offered.
    expect(offered).not.toContain(TABLE_TIGHT)
    expect(offered).toContain(TABLE_FREE)
    // The carried gap is read from the booking, never from the setting.
    expect(db.rpc.mock.calls.some(([fn]) => fn === 'get_setting_bool')).toBe(false)
  })

  it('gives a booking with no table yet the configured turnaround', async () => {
    db = seed({ gapCarried: false })
    expect((await getMoveTableAvailability(db as never, BOOKING)).endIso).toBe(TABLE_END)

    db = seed({ gapCarried: false, settings: { enabled: false, gap: 15 } })
    expect((await getMoveTableAvailability(db as never, BOOKING)).endIso).toBe(GUEST_END)
  })

  it('keeps the gap on the FOH walk-in that is created and then moved straight away', async () => {
    // The walk-in was made through the booking engine, which held table One to 21:15. FOH then
    // moves it to the table the staff member tapped, a second later.
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-1', supabase: db } as never)
    const response = await postFohMoveTable(
      new NextRequest(`https://management.orangejelly.co.uk/api/foh/bookings/${BOOKING_ID}/move-table`, {
        method: 'POST',
        body: JSON.stringify({ table_id: TABLE_FREE }),
      }),
      { params: Promise.resolve({ id: BOOKING_ID }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.end_datetime).toBe(GUEST_END)
    expect(body.data.table_end_datetime).toBe(TABLE_END)
    expect(moveCalls(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [TABLE_FREE], p_start_datetime: GUEST_START, p_end_datetime: TABLE_END },
    ])
  })

  it('keeps the gap when a staff party-size change moves the party to a bigger table', async () => {
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(db as never, {
      tableBookingId: BOOKING_ID,
      partySize: 6,
      actor: 'foh',
      autoMoveTable: true,
    })

    expect(result.state).toBe('updated')
    expect(moveCalls(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [TABLE_FREE], p_start_datetime: GUEST_START, p_end_datetime: TABLE_END },
    ])
  })
})
