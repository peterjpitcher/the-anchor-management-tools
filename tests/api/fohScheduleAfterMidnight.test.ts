// @vitest-environment node
//
// The FOH schedule around a close after midnight.
//
// New Year's Eve 2026 is 12:00 to 01:00 (a special hours row) and 1 January is closed. The
// floor screen used the calendar date: at 00:30 it jumped to 1 January and drew an invented
// 09:00 to 23:00 service for a day the pub is shut, while the party was still running.
//
// The real route, the real trading-day resolver and the real London date helpers run here;
// only the database is an in-memory fake. Instants are written in UTC so the file reads the
// same in both test zones: London is on GMT from 25 October 2026 to 28 March 2027 and on BST
// (UTC+1) either side.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: vi.fn() }))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { GET as getSchedule } from '@/app/api/foh/schedule/route'

type Row = Record<string, unknown>

// Fixture weekly hours, the same every day: 12:00 to 22:00 with the kitchen 12:00 to 21:00.
const WEEKLY: Row = {
  opens: '12:00:00',
  closes: '22:00:00',
  kitchen_opens: '12:00:00',
  kitchen_closes: '21:00:00',
  is_closed: false,
  is_kitchen_closed: false,
}

const SPECIALS: Row[] = [
  { date: '2026-12-31', opens: '12:00:00', closes: '01:00:00', is_closed: false, kitchen_opens: null, kitchen_closes: null, is_kitchen_closed: true },
  { date: '2027-01-01', opens: null, closes: null, is_closed: true, kitchen_opens: null, kitchen_closes: null, is_kitchen_closed: true },
]

const TABLE = { id: 'table-1', table_number: '1', name: 'Table 1', capacity: 4, area: null, area_id: 'area-1', is_bookable: true }

function tableBooking(id: string, bookingDate: string, bookingTime: string, start: string, end: string): Row {
  return {
    id,
    booking_reference: id.toUpperCase(),
    booking_date: bookingDate,
    booking_time: bookingTime,
    party_size: 2,
    booking_type: 'regular',
    booking_purpose: 'drinks',
    status: 'confirmed',
    start_datetime: start,
    end_datetime: end,
    event_id: null,
    customer_id: null,
  }
}

let db: FakeSupabase & { rpc?: unknown }

function seed(tables: Record<string, Row[]> = {}) {
  db = createFakeSupabase({
    tables: [TABLE],
    table_areas: [{ id: 'area-1', name: 'Bar' }],
    special_hours: SPECIALS,
    table_bookings: [],
    booking_table_assignments: [],
    private_bookings: [],
    private_booking_items: [],
    venue_space_table_areas: [],
    event_communal_seat_allocations: [],
    bookings: [],
    events: [],
    ...tables,
  })
  // business_hours_for_date: the one weekly row in force, as a set.
  db.rpc = vi.fn((fn: string) =>
    Promise.resolve(fn === 'business_hours_for_date' ? { data: [WEEKLY], error: null } : { data: null, error: { message: `unexpected rpc ${fn}` } }),
  )
  vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-1', supabase: db } as never)
}

async function scheduleAt(isoInstant: string, query = '') {
  vi.setSystemTime(new Date(isoInstant))
  const response = await getSchedule(new NextRequest(`https://management.orangejelly.co.uk/api/foh/schedule${query}`))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.success).toBe(true)
  return body.data
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  seed()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('New Year\'s Eve, closing at 1am', () => {
  it('stays on 31 December at 00:30 on 1 January, with its after-midnight bookings', async () => {
    seed({
      table_bookings: [
        tableBooking('tb-evening', '2026-12-31', '22:00:00', '2026-12-31T22:00:00.000Z', '2026-12-31T23:30:00.000Z'),
        tableBooking('tb-late', '2026-12-31', '00:15:00', '2027-01-01T00:15:00.000Z', '2027-01-01T00:45:00.000Z'),
      ],
      booking_table_assignments: [
        { table_booking_id: 'tb-evening', table_id: 'table-1', start_datetime: '2026-12-31T22:00:00.000Z', end_datetime: '2026-12-31T23:45:00.000Z' },
        { table_booking_id: 'tb-late', table_id: 'table-1', start_datetime: '2027-01-01T00:15:00.000Z', end_datetime: '2027-01-01T01:00:00.000Z' },
      ],
    })

    const data = await scheduleAt('2027-01-01T00:30:00Z')
    expect(data.date).toBe('2026-12-31')
    expect(data.trading_day_now).toEqual({ date: '2026-12-31', until: '2027-01-01T01:00:00.000Z' })
    expect(data.service_window).toMatchObject({ start_time: '12:00', end_time: '01:00', end_next_day: true, source: 'business_hours' })
    expect(data.lanes[0].bookings.map((booking: Row) => booking.id)).toEqual(['tb-evening', 'tb-late'])
  })

  it('is 31 December at 23:30, and tells a screen browsing another date which day is in force', async () => {
    expect((await scheduleAt('2026-12-31T23:30:00Z')).date).toBe('2026-12-31')

    const browsing = await scheduleAt('2026-12-31T23:30:00Z', '?date=2027-01-05')
    expect(browsing.date).toBe('2027-01-05')
    expect(browsing.trading_day_now).toEqual({ date: '2026-12-31', until: '2027-01-01T01:00:00.000Z' })
  })

  it('moves to 1 January at the 1am close, and shows it closed rather than inventing hours', async () => {
    const data = await scheduleAt('2027-01-01T01:00:00Z')
    expect(data.date).toBe('2027-01-01')
    expect(data.trading_day_now).toEqual({ date: '2027-01-01', until: '2027-01-02T00:00:00.000Z' })
    expect(data.service_window).toMatchObject({ source: 'closed' })
  })
})

describe('an ordinary day is unchanged', () => {
  it('shows today on its own hours and changes day at midnight', async () => {
    // 18:00 BST on Friday 11 September 2026.
    const data = await scheduleAt('2026-09-11T17:00:00Z')
    expect(data.date).toBe('2026-09-11')
    expect(data.trading_day_now).toEqual({ date: '2026-09-11', until: '2026-09-11T23:00:00.000Z' })
    expect(data.service_window).toEqual({
      start_time: '12:00',
      end_time: '22:00',
      end_next_day: false,
      kitchen_start_time: '12:00',
      kitchen_end_time: '21:00',
      kitchen_end_next_day: false,
      kitchen_closed: false,
      source: 'business_hours',
    })

    // 00:30 BST on Saturday: Friday shut at 22:00, so it is Saturday.
    expect((await scheduleAt('2026-09-11T23:30:00Z')).date).toBe('2026-09-12')
  })
})
