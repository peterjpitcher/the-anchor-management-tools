import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase } from '../helpers/fakeSupabase'

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: vi.fn() }))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { GET as getSchedule } from '@/app/api/foh/schedule/route'

/**
 * BK-091: a guest who changes their own party size through the manage link is shown to the floor
 * as "changed by guest", read from the audit row the change writes.
 */

const WEEKLY = {
  opens: '12:00:00',
  closes: '22:00:00',
  kitchen_opens: '12:00:00',
  kitchen_closes: '21:00:00',
  is_closed: false,
  is_kitchen_closed: false,
}

function booking(id: string) {
  return {
    id,
    booking_reference: id.toUpperCase(),
    booking_date: '2026-11-14',
    booking_time: '19:00:00',
    party_size: 6,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    start_datetime: '2026-11-14T19:00:00.000Z',
    end_datetime: '2026-11-14T21:00:00.000Z',
    event_id: null,
    customer_id: null,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
  const db = createFakeSupabase({
    tables: [{ id: 'table-1', table_number: '1', name: 'Table 1', capacity: 6, area: null, area_id: 'area-1', is_bookable: true }],
    table_areas: [{ id: 'area-1', name: 'Bar' }],
    special_hours: [],
    table_bookings: [booking('tb-guest'), booking('tb-staff')],
    booking_table_assignments: [
      { table_booking_id: 'tb-guest', table_id: 'table-1', start_datetime: '2026-11-14T19:00:00.000Z', end_datetime: '2026-11-14T21:15:00.000Z' },
      { table_booking_id: 'tb-staff', table_id: 'table-1', start_datetime: '2026-11-14T21:15:00.000Z', end_datetime: '2026-11-14T21:45:00.000Z' },
    ],
    audit_logs: [
      {
        resource_type: 'table_booking',
        resource_id: 'tb-guest',
        operation_type: 'table_booking.party_size_changed_by_guest',
        created_at: '2026-11-10T09:00:00.000Z',
        additional_info: { source: 'guest_manage_link', previousPartySize: 4, newPartySize: 6 },
      },
    ],
    private_bookings: [],
    private_booking_items: [],
    venue_space_table_areas: [],
    event_communal_seat_allocations: [],
    bookings: [],
    events: [],
  }) as ReturnType<typeof createFakeSupabase> & { rpc?: unknown }
  db.rpc = vi.fn((fn: string) =>
    Promise.resolve(fn === 'business_hours_for_date' ? { data: [WEEKLY], error: null } : { data: null, error: { message: `unexpected rpc ${fn}` } }),
  )
  vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-1', supabase: db } as never)
})

afterEach(() => vi.useRealTimers())

describe('the FOH schedule', () => {
  it('marks the booking the guest changed, and only that one', async () => {
    const response = await getSchedule(new NextRequest('https://management.orangejelly.co.uk/api/foh/schedule?date=2026-11-14'))
    const body = await response.json()
    const bookings = body.data.lanes[0].bookings as Array<Record<string, unknown>>

    expect(bookings.find((row) => row.id === 'tb-guest')?.guest_party_size_change).toEqual({
      at: '2026-11-10T09:00:00.000Z',
      from: 4,
      to: 6,
    })
    expect(bookings.find((row) => row.id === 'tb-staff')?.guest_party_size_change).toBeNull()
  })
})
