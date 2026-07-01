import { describe, it, expect } from 'vitest'
import { getMoveTableAvailability } from '@/lib/table-bookings/move-table'

// Policy: a table used for a communal event cannot be shared with a food booking at all.
// getMoveTableAvailability must never offer such a table (previously it did "partial sharing",
// proposing combos the DB trigger enforce_booking_table_assignment_integrity_v05 then rejected).

const TABLE_FREE = 'aaaaaaaa-0000-4000-8000-000000000001' // cap 6, free
const TABLE_COMMUNAL = 'bbbbbbbb-0000-4000-8000-000000000002' // cap 6, has communal seats
const TABLE_SMALL = 'cccccccc-0000-4000-8000-000000000003' // cap 4, free
const BOOKING_ID = 'dddddddd-0000-4000-8000-000000000004'

function buildSupabase() {
  const tables = [
    { id: TABLE_FREE, table_number: '1', name: 'Free', capacity: 6, is_bookable: true },
    { id: TABLE_COMMUNAL, table_number: '2', name: 'Communal', capacity: 6, is_bookable: true },
    { id: TABLE_SMALL, table_number: '3', name: 'Small', capacity: 4, is_bookable: true },
  ]
  // Free joins both Communal and Small.
  const joinLinks = [
    { table_id: TABLE_FREE, join_table_id: TABLE_COMMUNAL },
    { table_id: TABLE_FREE, join_table_id: TABLE_SMALL },
  ]
  // Communal event holds 2 seats on TABLE_COMMUNAL for the window.
  const communal = [
    { table_id: TABLE_COMMUNAL, seats: 2, booking: { status: 'confirmed', hold_expires_at: null } },
  ]

  const tablesSelect = () => ({ order: () => ({ order: () => Promise.resolve({ data: tables, error: null }) }) })

  const existingAssignmentEq = () => Promise.resolve({ data: [{ table_id: TABLE_FREE }], error: null })
  const overlapChain = { gt: () => Promise.resolve({ data: [], error: null }) }
  const assignmentSelect = (cols: string) => {
    if (cols === 'table_id') return { eq: existingAssignmentEq }
    if (cols === 'table_id, table_booking_id') {
      return { in: () => ({ neq: () => ({ lt: () => overlapChain }) }) }
    }
    throw new Error(`unexpected assignment select: ${cols}`)
  }

  const communalSelect = () => ({ in: () => ({ lt: () => ({ gt: () => Promise.resolve({ data: communal, error: null }) }) }) })

  return {
    from: (table: string) => {
      if (table === 'tables') return { select: tablesSelect }
      if (table === 'booking_table_assignments') return { select: assignmentSelect }
      if (table === 'table_join_links') return { select: () => Promise.resolve({ data: joinLinks, error: null }) }
      if (table === 'event_communal_seat_allocations') return { select: communalSelect }
      if (table === 'table_bookings') return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: () => Promise.resolve({ data: false, error: null }),
  }
}

describe('getMoveTableAvailability communal exclusion', () => {
  it('never offers a communal-held table, but still offers a non-communal join combo', async () => {
    const supabase = buildSupabase() as never
    const availability = await getMoveTableAvailability(supabase, {
      id: BOOKING_ID,
      booking_date: '2026-07-01',
      booking_time: '19:30:00',
      start_datetime: '2026-07-01T18:30:00.000Z',
      end_datetime: '2026-07-01T20:30:00.000Z',
      duration_minutes: 120,
      party_size: 8,
    })

    const offeredTableIds = availability.tables.flatMap((option) => option.table_ids)
    // The communal-held table must never be proposed.
    expect(offeredTableIds).not.toContain(TABLE_COMMUNAL)
    // The valid non-communal combo (6 + 4 = 10 >= 8) is still offered.
    expect(
      availability.tables.some(
        (option) =>
          option.table_ids.length === 2 &&
          option.table_ids.includes(TABLE_FREE) &&
          option.table_ids.includes(TABLE_SMALL)
      )
    ).toBe(true)
  })
})
