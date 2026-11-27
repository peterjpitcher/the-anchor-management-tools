import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabase } from '../../helpers/fakeSupabase'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import {
  readBalanceDues,
  readCalendarNotesInRange,
  readParkingInRange,
  readPrivateBookingsInRange,
} from '@/lib/calendar/datasets'

/**
 * The month readers behind the venue calendar. The point of them is that nothing drops off once
 * it has happened: completed, cancelled, expired and paid items in the window all come back, and
 * items that only overlap the window's edges are on it.
 */

const asClient = (db: ReturnType<typeof createFakeSupabase>) => db as unknown as SupabaseClient

// June 2026 grid: Monday 1 June to Sunday 5 July.
const START = '2026-06-01'
const END = '2026-07-05'
const START_INSTANT = '2026-05-31T23:00:00.000Z'
const END_INSTANT = '2026-07-05T23:00:00.000Z'

describe('readPrivateBookingsInRange', () => {
  it('returns every hire in the window whatever its status, and nothing outside it', async () => {
    const hire = (id: string, event_date: string, status: string) => ({
      id, event_date, status,
      customer_name: null, customer_first_name: 'Sam', customer_last_name: 'Smith',
      start_time: '19:00', end_time: '23:00', end_time_next_day: false, guest_count: 30, event_type: 'Birthday',
    })
    const db = createFakeSupabase({
      private_bookings: [
        hire('completed', '2026-06-06', 'completed'),
        hire('cancelled', '2026-06-13', 'cancelled'),
        hire('draft', START, 'draft'),
        hire('confirmed', END, 'confirmed'),
        hire('before', '2026-05-31', 'completed'),
        hire('after', '2026-07-06', 'confirmed'),
      ],
    })

    const result = await readPrivateBookingsInRange(asClient(db), START, END)

    expect(result.status).toBe('ok')
    expect(result.data.map((row) => row.id).sort()).toEqual(['cancelled', 'completed', 'confirmed', 'draft'])
    expect(result.data.find((row) => row.id === 'completed')?.customer_name).toBe('Sam Smith')
  })

  it('reports a failed read as failed, never as an empty month', async () => {
    const db = createFakeSupabase({ private_bookings: [] })
    db.failures.push({ table: 'private_bookings', op: 'select', error: { message: 'timeout' } })
    const result = await readPrivateBookingsInRange(asClient(db), START, END)
    expect(result.status).toBe('failed')
  })
})

describe('readParkingInRange', () => {
  it('returns stays that overlap the window, expired and cancelled included', async () => {
    const stay = (id: string, start_at: string, end_at: string, status: string) => ({
      id, start_at, end_at, status,
      reference: id, customer_first_name: 'A', customer_last_name: 'B', vehicle_registration: 'AB12CDE', payment_status: 'paid',
    })
    const db = createFakeSupabase({
      parking_bookings: [
        stay('expired', '2026-06-10T08:00:00.000Z', '2026-06-12T18:00:00.000Z', 'expired'),
        stay('cancelled', '2026-06-20T08:00:00.000Z', '2026-06-21T18:00:00.000Z', 'cancelled'),
        // Began last month, still parked on the 1st: on this month's grid.
        stay('spans-in', '2026-05-20T08:00:00.000Z', '2026-06-02T18:00:00.000Z', 'completed'),
        // Ended the evening before the grid's first London midnight.
        stay('ended-before', '2026-05-29T08:00:00.000Z', '2026-05-31T22:00:00.000Z', 'completed'),
        // Starts at the London midnight after the grid's last day.
        stay('starts-after', END_INSTANT, '2026-07-07T18:00:00.000Z', 'confirmed'),
      ],
    })

    const result = await readParkingInRange(asClient(db), START_INSTANT, END_INSTANT)

    expect(result.status).toBe('ok')
    expect(result.data.map((row) => row.id).sort()).toEqual(['cancelled', 'expired', 'spans-in'])
  })
})

describe('readCalendarNotesInRange', () => {
  it('returns notes that touch the window, including ones that started before it', async () => {
    const note = (id: string, note_date: string, end_date: string, extra: Record<string, unknown> = {}) => ({
      id, note_date, end_date, title: id, notes: null, source: 'manual', start_time: null, end_time: null, color: null, show_to_staff: true, ...extra,
    })
    const db = createFakeSupabase({
      calendar_notes: [
        note('inside', '2026-06-15', '2026-06-15'),
        note('spans-in', '2026-05-28', '2026-06-01'),
        note('spans-out', '2026-07-05', '2026-07-09', { show_to_staff: false }),
        note('before', '2026-05-20', '2026-05-31'),
        note('after', '2026-07-06', '2026-07-06'),
      ],
    })

    const result = await readCalendarNotesInRange(asClient(db), START, END, '#123456')

    expect(result.data.map((row) => row.id).sort()).toEqual(['inside', 'spans-in', 'spans-out'])
    expect(result.data.find((row) => row.id === 'inside')?.color).toBe('#123456')
    expect(result.data.find((row) => row.id === 'spans-out')?.show_to_staff).toBe(false)
  })
})

describe('readBalanceDues', () => {
  it('keeps paid, completed and cancelled balances, flags the paid one settled, and leaves drafts out', async () => {
    const booking = (id: string, status: string, total: number) => ({
      id, status,
      customer_name: id, customer_first_name: null, customer_last_name: null,
      balance_due_date: '2026-06-10', event_date: '2026-06-24',
      total_amount: total, calculated_total: total, gross_total: total, final_payment_date: null,
    })
    const db = createFakeSupabase({
      private_bookings_with_details: [
        booking('paid', 'completed', 500),
        booking('owing', 'confirmed', 800),
        booking('called-off', 'cancelled', 300),
        booking('draft', 'draft', 400),
      ],
      private_booking_payments: [{ booking_id: 'paid', amount: 500 }],
    })

    const result = await readBalanceDues(asClient(db), START, END)

    expect(result.status).toBe('ok')
    const byId = new Map(result.data.map((row) => [row.id, row]))
    expect([...byId.keys()].sort()).toEqual(['called-off', 'owing', 'paid'])
    expect(byId.get('paid')?.settled).toBe(true)
    expect(byId.get('owing')?.settled).toBeFalsy()
  })
})
