// @vitest-environment node
//
// Private hire blocks on the FOH schedule across the two clock-change nights.
//
// A block's times were turned into instants with fromZonedTime, and a finish after midnight
// was "the same clock time plus 24 hours". Both land an hour out across a clock change: the
// block showed a 2am finish on 25 October an hour early. Times are now read off the London
// clock on the date they fall on.
//
// The real route and London date helpers run here; only the database is an in-memory fake.
// Instants are in UTC so the file reads the same in both test zones: London is on GMT from
// 25 October 2026 to 28 March 2027 and on BST (UTC+1) either side.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: vi.fn() }))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { GET as getSchedule } from '@/app/api/foh/schedule/route'

type Row = Record<string, unknown>

const WEEKLY: Row = {
  opens: '12:00:00',
  closes: '22:00:00',
  kitchen_opens: '12:00:00',
  kitchen_closes: '21:00:00',
  is_closed: false,
  is_kitchen_closed: false,
}

function seedPrivateHire(eventDate: string, startTime: string, endTime: string) {
  const db: FakeSupabase & { rpc?: unknown } = createFakeSupabase({
    tables: [{ id: 'table-1', table_number: '1', name: 'Table 1', capacity: 4, area: null, area_id: 'area-1', is_bookable: true }],
    table_areas: [{ id: 'area-1', name: 'Bar' }],
    special_hours: [],
    table_bookings: [],
    booking_table_assignments: [],
    private_bookings: [
      {
        id: 'pb-1',
        customer_name: 'Party',
        customer_first_name: null,
        customer_last_name: null,
        event_type: 'Birthday',
        status: 'confirmed',
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime,
        setup_date: null,
        setup_time: null,
      },
    ],
    private_booking_items: [{ booking_id: 'pb-1', space_id: 'space-1', item_type: 'space' }],
    venue_space_table_areas: [{ venue_space_id: 'space-1', table_area_id: 'area-1' }],
    event_communal_seat_allocations: [],
    bookings: [],
    events: [],
  })
  db.rpc = vi.fn((fn: string) =>
    Promise.resolve(fn === 'business_hours_for_date' ? { data: [WEEKLY], error: null } : { data: null, error: { message: `unexpected rpc ${fn}` } }),
  )
  vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-1', supabase: db } as never)
}

async function blockOn(date: string) {
  vi.setSystemTime(new Date(`${date}T12:00:00Z`))
  const response = await getSchedule(new NextRequest(`https://management.orangejelly.co.uk/api/foh/schedule?date=${date}`))
  expect(response.status).toBe(200)
  return (await response.json()).data.lanes[0].bookings[0]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('private hire blocks on the clock-change nights', () => {
  it('ends a 2am finish at 2am GMT when the clocks go back, not an hour early', async () => {
    // Saturday 24 October 2026, 20:00 BST to 02:00 GMT, each side buffered by 30 minutes.
    seedPrivateHire('2026-10-24', '20:00:00', '02:00:00')
    expect(await blockOn('2026-10-24')).toMatchObject({
      id: 'private-pb-1-table-1',
      start_datetime: '2026-10-24T18:30:00.000Z',
      end_datetime: '2026-10-25T02:30:00.000Z',
    })
  })

  it('ends a 1:30am finish when the clock jumps on the night the clocks go forward', async () => {
    // Saturday 27 March 2027, 20:00 GMT to 01:30, which never shows: the clock passes it at
    // 01:00 GMT, jumping to 02:00 BST. Plus the 30 minute buffer.
    seedPrivateHire('2027-03-27', '20:00:00', '01:30:00')
    expect(await blockOn('2027-03-27')).toMatchObject({
      start_datetime: '2027-03-27T19:30:00.000Z',
      end_datetime: '2027-03-28T01:30:00.000Z',
    })
  })

  it('is unchanged on an ordinary night', async () => {
    // Saturday 12 September 2026, 19:00 to 23:30 BST.
    seedPrivateHire('2026-09-12', '19:00:00', '23:30:00')
    expect(await blockOn('2026-09-12')).toMatchObject({
      start_datetime: '2026-09-12T17:30:00.000Z',
      end_datetime: '2026-09-12T23:00:00.000Z',
    })
  })
})
