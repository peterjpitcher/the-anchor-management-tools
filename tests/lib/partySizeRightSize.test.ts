import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn().mockResolvedValue(undefined) } }))

import { AuditService } from '@/services/audit'
import { hashGuestToken } from '@/lib/guest/tokens'
import { logger } from '@/lib/logger'
import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'
import { getMoveTableAvailability } from '@/lib/table-bookings/move-table'
import { pickTablesToKeep, rightSizeBookingAfterPartySizeChange } from '@/lib/table-bookings/party-size-right-size'
import { updateTableBookingPartySizeWithLinkedEventSeats } from '@/lib/events/staff-seat-updates'

/**
 * Sunday 22 November 2026: a party of 5 sat holding two joined tables of six. It had been booked
 * for 7, the guest cut it to 5 from the manage link, and nothing released the second table or the
 * longer sitting. The staff screens had the same gap, and Move table could not put a joined booking
 * onto one of its own tables, so nobody could free it by hand either.
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000001'
const SIX_A = 'bbbbbbbb-0000-4000-8000-00000000006a'
const SIX_B = 'bbbbbbbb-0000-4000-8000-00000000006b'
const FOUR_A = 'bbbbbbbb-0000-4000-8000-00000000004a'

// Sunday 22 November 2026, GMT. A party of 7 on a Sunday sits 165 minutes; a party of 5, 135.
const START = '2026-11-22T13:00:00.000Z'
const GUEST_END_FOR_7 = '2026-11-22T15:45:00.000Z'
const TABLE_END_FOR_7 = '2026-11-22T16:00:00.000Z'
const GUEST_END_FOR_5 = '2026-11-22T15:15:00.000Z'
const TABLE_END_FOR_5 = '2026-11-22T15:30:00.000Z'

type Db = FakeSupabase & { rpc: ReturnType<typeof vi.fn> }

function turnMinutes(partySize: number): number {
  const base = partySize <= 2 ? 90 : partySize <= 4 ? 105 : partySize <= 6 ? 120 : 150
  return base + 15
}

function seed(options: {
  booking?: Record<string, unknown>
  tableIds?: string[]
  moveError?: { code?: string; message: string }
  /** What the booking engine's picker offers a party this size. Default: nothing better. */
  pickerChoice?: { table_ids: string[]; total_capacity: number }
  /** Make the longer table hold clash with the next booking. */
  lengthenClashes?: boolean
} = {}): Db {
  const tableIds = options.tableIds ?? [SIX_A, SIX_B]
  const db = createFakeSupabase({
    guest_tokens: [{
      hashed_token: hashGuestToken('raw-token'),
      action_type: 'manage',
      customer_id: CUSTOMER_ID,
      table_booking_id: BOOKING_ID,
      expires_at: '2026-11-24T13:00:00.000Z',
      consumed_at: null,
    }],
    table_bookings: [{
      id: BOOKING_ID,
      customer_id: CUSTOMER_ID,
      booking_reference: 'TB-SHRINK',
      status: 'confirmed',
      party_size: 7,
      committed_party_size: 7,
      special_requirements: null,
      booking_type: 'regular',
      booking_purpose: 'food',
      booking_date: '2026-11-22',
      booking_time: '13:00:00',
      start_datetime: START,
      end_datetime: GUEST_END_FOR_7,
      duration_minutes: 165,
      is_outside_seating: false,
      requires_accessible_table: false,
      high_chair_count: 0,
      seated_at: null,
      left_at: null,
      table_pinned: false,
      event_booking_id: null,
      event_id: null,
      christmas_course_counts: null,
      payment_status: null,
      deposit_amount: null,
      deposit_amount_locked: null,
      deposit_waived: false,
      booking_period_id: null,
      booking_period_name: null,
      ...options.booking,
    }],
    tables: [
      { id: SIX_A, table_number: '10', name: 'Dining Room 6a', capacity: 6, priority: 30, bar_priority: 80 },
      { id: SIX_B, table_number: '11', name: 'Dining Room 6b', capacity: 6, priority: 40, bar_priority: 90 },
      { id: FOUR_A, table_number: '8', name: 'Dining Room 4a', capacity: 4, priority: 10, bar_priority: 60 },
    ],
    table_join_links: [
      { table_id: SIX_A, join_table_id: SIX_B },
      { table_id: FOUR_A, join_table_id: SIX_A },
      { table_id: FOUR_A, join_table_id: SIX_B },
    ],
    booking_table_assignments: tableIds.map((tableId, index) => ({
      id: `assignment-${index}`,
      table_booking_id: BOOKING_ID,
      table_id: tableId,
      start_datetime: START,
      end_datetime: TABLE_END_FOR_7,
    })),
    system_settings: [{ key: 'table_booking_max_party_online', value: { value: 20 } }],
    special_hours: [],
  }) as Db

  db.rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    if (fn === 'table_booking_turn_minutes') {
      return Promise.resolve({
        data: [{ duration_minutes: turnMinutes(Number(args.p_party_size)), turnaround_minutes: 15 }],
        error: null,
      })
    }
    if (fn === 'move_table_booking_assignments_v05') {
      if (options.moveError) return Promise.resolve({ data: null, error: options.moveError })
      return Promise.resolve({ data: { state: 'moved', table_ids: args.p_table_ids }, error: null })
    }
    if (fn === 'find_table_allocation_candidates') {
      return Promise.resolve({
        data: options.pickerChoice ? [{ ...options.pickerChoice, rank: 1, reason_code: null }] : [],
        error: null,
      })
    }
    if (fn === 'move_table_booking_time_v06') {
      if (options.lengthenClashes) {
        return Promise.resolve({ data: null, error: { code: '23P01', message: 'table_assignment_overlap' } })
      }
      const row = db.tables.table_bookings.find((entry) => entry.id === args.p_table_booking_id)
      if (row) row.end_datetime = args.p_booking_end_datetime
      for (const assignment of db.tables.booking_table_assignments) assignment.end_datetime = args.p_assignment_end_datetime
      return Promise.resolve({ data: { state: 'updated' }, error: null })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } })
  })
  return db
}

function moves(db: Db) {
  return db.rpc.mock.calls.filter(([fn]) => fn === 'move_table_booking_assignments_v05').map(([, args]) => args)
}

function booking(db: Db) {
  return db.tables.table_bookings.find((row) => row.id === BOOKING_ID) as Record<string, unknown>
}

async function guestShrinksTo(db: Db, newPartySize: number) {
  return updateTableBookingByRawToken(db as never, {
    rawToken: 'raw-token',
    action: 'update',
    newPartySize,
    appBaseUrl: 'https://management.orangejelly.co.uk',
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-21T10:00:00.000Z'))
  vi.clearAllMocks()
})
afterEach(() => vi.useRealTimers())

describe('choosing which of its own tables a smaller party keeps', () => {
  const links = new Set([[SIX_A, SIX_B].sort().join(':'), [FOUR_A, SIX_A].sort().join(':')])
  const sixA = { id: SIX_A, capacity: 6, order: 30 }
  const sixB = { id: SIX_B, capacity: 6, order: 40 }
  const fourA = { id: FOUR_A, capacity: 4, order: 10 }

  it('keeps one table of six for a party of 7 cut to 5, the first in the house order', () => {
    expect(pickTablesToKeep([sixB, sixA], links, 7, 5)).toEqual([SIX_A])
  })

  it('keeps everything when the party still needs every table', () => {
    expect(pickTablesToKeep([sixA, sixB], links, 8, 7)).toBeNull()
  })

  it('keeps a spare table somebody chose: the tables kept would have seated the old party too', () => {
    // A party of 5 given two sixes on purpose, now 4. One six always seated them.
    expect(pickTablesToKeep([sixA, sixB], links, 5, 4)).toBeNull()
  })

  it('only keeps tables that still join each other', () => {
    // 4a joins 6a, 6a joins 6b, 4a does not join 6b. A party of 15 cut to 10 cannot keep 4a + 6b.
    expect(pickTablesToKeep([fourA, sixA, sixB], links, 15, 10)?.slice().sort()).toEqual([FOUR_A, SIX_A].sort())
  })
})

describe('a guest making their own booking smaller', () => {
  it('frees the second table and shortens the sitting, keeping the turnaround', async () => {
    const db = seed()

    const result = await guestShrinksTo(db, 5)

    expect(result).toMatchObject({ state: 'updated', old_party_size: 7, new_party_size: 5 })
    expect(booking(db)).toMatchObject({ party_size: 5, end_datetime: GUEST_END_FOR_5, duration_minutes: 135 })
    expect(moves(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [SIX_A], p_start_datetime: START, p_end_datetime: TABLE_END_FOR_5 },
    ])
    expect(AuditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'table_booking.right_sized_after_party_shrink',
      resource_id: BOOKING_ID,
      old_values: { table_ids: [SIX_A, SIX_B], duration_minutes: 165 },
      new_values: { table_ids: [SIX_A], duration_minutes: 135 },
    }))
  })

  it('still saves the smaller party when the table cannot be released, and says so in the logs', async () => {
    const db = seed({ moveError: { code: 'XX000', message: 'boom' } })

    const result = await guestShrinksTo(db, 5)

    expect(result).toMatchObject({ state: 'updated', new_party_size: 5 })
    expect(booking(db).party_size).toBe(5)
    expect(logger.error).toHaveBeenCalledWith(
      'Party size changed but its tables or sitting could not be brought into line',
      expect.anything()
    )
  })

  it('leaves a sitting staff set by hand, and still frees the table', async () => {
    const db = seed({ booking: { end_datetime: '2026-11-22T16:00:00.000Z', duration_minutes: 180 } })
    for (const row of db.tables.booking_table_assignments) row.end_datetime = '2026-11-22T16:15:00.000Z'

    await guestShrinksTo(db, 5)

    expect(booking(db)).toMatchObject({ end_datetime: '2026-11-22T16:00:00.000Z', duration_minutes: 180 })
    expect(moves(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [SIX_A], p_start_datetime: START, p_end_datetime: '2026-11-22T16:15:00.000Z' },
    ])
  })

  it('shortens the sitting of a party on one table, which keeps its table', async () => {
    const db = seed({
      tableIds: [SIX_A],
      booking: { party_size: 5, committed_party_size: 5, end_datetime: GUEST_END_FOR_5, duration_minutes: 135 },
    })
    for (const row of db.tables.booking_table_assignments) row.end_datetime = TABLE_END_FOR_5

    await guestShrinksTo(db, 4)

    // A Sunday party of 4 sits 120 minutes.
    expect(booking(db)).toMatchObject({ end_datetime: '2026-11-22T15:00:00.000Z', duration_minutes: 120 })
    expect(moves(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [SIX_A], p_start_datetime: START, p_end_datetime: '2026-11-22T15:15:00.000Z' },
    ])
  })
})

describe('a smaller party and a smaller table elsewhere', () => {
  it('moves a party of 7 cut to 3 off its two sixes onto a free table of four', async () => {
    const db = seed({ pickerChoice: { table_ids: [FOUR_A], total_capacity: 4 } })

    await guestShrinksTo(db, 3)

    // A Sunday party of 3 sits 120 minutes; the table is held 15 more.
    expect(booking(db)).toMatchObject({ party_size: 3, end_datetime: '2026-11-22T15:00:00.000Z', duration_minutes: 120 })
    expect(moves(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [FOUR_A], p_start_datetime: START, p_end_datetime: '2026-11-22T15:15:00.000Z' },
    ])
    expect(db.rpc.mock.calls.find(([fn]) => fn === 'find_table_allocation_candidates')?.[1]).toMatchObject({
      p_party_size: 3, p_channel: 'online', p_exclude_booking: BOOKING_ID, p_end_at: '2026-11-22T15:15:00.000Z',
    })
  })

  it('keeps one of its own tables when the smaller one has just been taken', async () => {
    const db = seed({ pickerChoice: { table_ids: [FOUR_A], total_capacity: 4 } })
    const rpc = db.rpc.getMockImplementation() as (fn: string, args: Record<string, unknown>) => Promise<unknown>
    db.rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
      if (fn === 'move_table_booking_assignments_v05' && (args.p_table_ids as string[]).includes(FOUR_A)) {
        return Promise.resolve({ data: null, error: { code: '23P01', message: 'table_assignment_overlap' } })
      }
      return rpc(fn, args)
    }) as Db['rpc']

    await guestShrinksTo(db, 3)

    expect(moves(db).map((call) => call.p_table_ids)).toEqual([[FOUR_A], [SIX_A]])
  })

  it('does not move a party to a table that is no smaller than its own', async () => {
    const db = seed({ pickerChoice: { table_ids: [SIX_B], total_capacity: 6 } })

    await guestShrinksTo(db, 5)

    expect(moves(db).map((call) => call.p_table_ids)).toEqual([[SIX_A]])
  })

  it('never moves a diner down the house order to save a seat (Dining Room six to the bar bay)', async () => {
    const SMALL_BAY = 'bbbbbbbb-0000-4000-8000-0000000005ba'
    const db = seed({ pickerChoice: { table_ids: [SMALL_BAY], total_capacity: 5 } })
    db.tables.tables.push({ id: SMALL_BAY, table_number: '3', name: 'Small Bay', capacity: 5, priority: 60, bar_priority: 40 })

    await guestShrinksTo(db, 5)

    expect(moves(db).map((call) => call.p_table_ids)).toEqual([[SIX_A]])
  })

  it('moves it on the day of the booking too, and after staff have moved it by hand', async () => {
    vi.setSystemTime(new Date('2026-11-22T09:00:00.000Z'))
    const db = seed({ pickerChoice: { table_ids: [FOUR_A], total_capacity: 4 } })
    db.tables.audit_logs = [{ id: 'audit-1', resource_type: 'table_booking', resource_id: BOOKING_ID, operation_type: 'move_table' }]

    await guestShrinksTo(db, 3)

    expect(moves(db).map((call) => call.p_table_ids)).toEqual([[FOUR_A]])
  })

  it('moves a party on one table to a smaller one', async () => {
    const db = seed({
      tableIds: [SIX_A],
      booking: { party_size: 5, committed_party_size: 5, end_datetime: GUEST_END_FOR_5, duration_minutes: 135 },
      pickerChoice: { table_ids: [FOUR_A], total_capacity: 4 },
    })
    for (const row of db.tables.booking_table_assignments) row.end_datetime = TABLE_END_FOR_5

    await guestShrinksTo(db, 2)

    // A Sunday party of 2 sits 105 minutes.
    expect(moves(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [FOUR_A], p_start_datetime: START, p_end_datetime: '2026-11-22T15:00:00.000Z' },
    ])
  })
})

describe('a bigger party', () => {
  function seedFive(options: Parameters<typeof seed>[0] = {}) {
    const db = seed({
      ...options,
      booking: { party_size: 7, committed_party_size: 7, end_datetime: GUEST_END_FOR_5, duration_minutes: 135, ...options.booking },
    })
    for (const row of db.tables.booking_table_assignments) row.end_datetime = TABLE_END_FOR_5
    return db
  }
  const grown = { bookingId: BOOKING_ID, oldPartySize: 5, newPartySize: 7, source: 'foh' }

  it('gets the longer sitting, table hold and booking together', async () => {
    const db = seedFive()

    const result = await rightSizeBookingAfterPartySizeChange(db as never, grown)

    expect(result).toMatchObject({ state: 'right_sized', previousDurationMinutes: 135, durationMinutes: 165 })
    expect(db.rpc).toHaveBeenCalledWith('move_table_booking_time_v06', {
      p_table_booking_id: BOOKING_ID,
      p_booking_time: '13:00:00',
      p_start_datetime: START,
      p_booking_end_datetime: GUEST_END_FOR_7,
      p_assignment_end_datetime: TABLE_END_FOR_7,
    })
    expect(booking(db)).toMatchObject({ end_datetime: GUEST_END_FOR_7, duration_minutes: 165 })
  })

  it('keeps the sitting it had when the next booking needs the table', async () => {
    const db = seedFive({ lengthenClashes: true })

    const result = await rightSizeBookingAfterPartySizeChange(db as never, grown)

    expect(result).toEqual({ state: 'unchanged', reason: 'no_room_for_longer_sitting' })
    expect(booking(db)).toMatchObject({ end_datetime: GUEST_END_FOR_5, duration_minutes: 135 })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('is lengthened even when already seated', async () => {
    const db = seedFive({ booking: { seated_at: '2026-11-22T13:02:00.000Z' } })

    expect(await rightSizeBookingAfterPartySizeChange(db as never, grown)).toMatchObject({ state: 'right_sized' })
  })

  it('keeps a sitting staff set by hand', async () => {
    const db = seedFive({ booking: { end_datetime: '2026-11-22T15:00:00.000Z', duration_minutes: 120 } })

    expect(await rightSizeBookingAfterPartySizeChange(db as never, grown)).toEqual({ state: 'unchanged', reason: 'sitting_already_right' })
  })
})

describe('bookings that are left exactly as they are', () => {
  it.each([
    ['a party already seated', { seated_at: '2026-11-22T13:01:00.000Z' }, 'seated'],
    ['a pinned booking', { table_pinned: true }, 'pinned'],
    ['the table half of an event booking', { event_booking_id: 'eeeeeeee-0000-4000-8000-000000000001' }, 'event_linked'],
    ['an outside booking', { is_outside_seating: true }, 'outside'],
  ])('%s', async (_label, fields, reason) => {
    const db = seed({ booking: { party_size: 5, ...fields } })

    const result = await rightSizeBookingAfterPartySizeChange(db as never, {
      bookingId: BOOKING_ID, oldPartySize: 7, newPartySize: 5, source: 'test',
    })

    expect(result).toEqual({ state: 'unchanged', reason })
    expect(moves(db)).toEqual([])
    expect(booking(db)).toMatchObject({ end_datetime: GUEST_END_FOR_7, duration_minutes: 165 })
  })
})

describe('a party that grows back while its spare table is being released', () => {
  it('gets the table back, so it is never left on fewer seats than its party', async () => {
    const db = seed({ booking: { party_size: 5 } })
    const move = db.rpc.getMockImplementation() as (fn: string, args: Record<string, unknown>) => Promise<unknown>
    let releases = 0
    db.rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
      if (fn === 'move_table_booking_assignments_v05') {
        releases += 1
        // Staff put the party back to 7 at the very moment the first release lands.
        if (releases === 1) booking(db).party_size = 7
      }
      return move(fn, args)
    }) as Db['rpc']

    const result = await rightSizeBookingAfterPartySizeChange(db as never, {
      bookingId: BOOKING_ID, oldPartySize: 7, newPartySize: 5, source: 'test',
    })

    expect(result).toEqual({ state: 'unchanged', reason: 'failed' })
    expect(moves(db).map((call) => call.p_table_ids)).toEqual([[SIX_A], [SIX_A, SIX_B]])
    expect(moves(db)[1].p_end_datetime).toBe(TABLE_END_FOR_7)
    expect(booking(db)).toMatchObject({ party_size: 7, end_datetime: GUEST_END_FOR_7, duration_minutes: 165 })
    expect(logger.error).toHaveBeenCalled()
  })

  it('releases nothing when the party had already grown back', async () => {
    const db = seed({ booking: { party_size: 7 } })

    const result = await rightSizeBookingAfterPartySizeChange(db as never, {
      bookingId: BOOKING_ID, oldPartySize: 7, newPartySize: 5, source: 'test',
    })

    expect(result).toEqual({ state: 'unchanged', reason: 'changed_meanwhile' })
    expect(moves(db)).toEqual([])
  })
})

describe('staff making a booking smaller', () => {
  it('frees the second table and shortens the sitting', async () => {
    const db = seed()

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(db as never, {
      tableBookingId: BOOKING_ID,
      partySize: 5,
      actor: 'foh',
      sendSms: false,
      autoMoveTable: true,
    })

    expect(result).toMatchObject({ state: 'updated', old_party_size: 7, new_party_size: 5 })
    expect(booking(db)).toMatchObject({ party_size: 5, end_datetime: GUEST_END_FOR_5, duration_minutes: 135 })
    expect(moves(db)).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [SIX_A], p_start_datetime: START, p_end_datetime: TABLE_END_FOR_5 },
    ])
  })
})

describe('Move table on a joined booking', () => {
  it('offers each of the booking\'s own tables on its own, so staff can free the other', async () => {
    const db = seed({ booking: { party_size: 5 } })
    db.rpc = vi.fn(() => Promise.resolve({ data: false, error: null }))
    db.tables.tables.forEach((table) => { table.is_bookable = true })
    db.tables.event_communal_seat_allocations = []

    const availability = await getMoveTableAvailability(db as never, {
      id: BOOKING_ID,
      booking_date: '2026-11-22',
      booking_time: '13:00:00',
      start_datetime: START,
      end_datetime: GUEST_END_FOR_7,
      duration_minutes: 165,
      party_size: 5,
    })

    const singles = availability.tables.filter((option) => option.table_ids.length === 1).map((option) => option.table_ids[0])
    expect(singles).toEqual(expect.arrayContaining([SIX_A, SIX_B]))
    // The set it already holds is not a move.
    expect(availability.tables.some((option) => option.table_ids.length === 2
      && option.table_ids.includes(SIX_A) && option.table_ids.includes(SIX_B))).toBe(false)
  })
})
