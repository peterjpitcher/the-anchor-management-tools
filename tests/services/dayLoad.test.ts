import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Review BK-075 (24 October 2026): the FOH header, the dashboard, the calendar and the rota each
 * counted covers differently, none added private-hire guests, and a Saturday with a 120-guest
 * party read as 0. One day load now counts them all the same way.
 */

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/business-hours/effective', () => ({ getBusinessHoursForDates: vi.fn() }))

import { buildDayLoads, describeCovers, loadDayLoads } from '@/services/day-load'
import { combineDayHours, loadDayHours } from '@/lib/business-hours/day-hours'
import { getBusinessHoursForDates } from '@/lib/business-hours/effective'
import { logger } from '@/lib/logger'

const NOW = new Date('2026-11-21T09:00:00.000Z')

function hire(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hire-1', event_date: '2026-11-21', status: 'confirmed', customer_name: 'Party', customer_first_name: 'Sam',
    customer_last_name: 'Host', start_time: '19:30:00', end_time: '23:30:00', guest_count: 120, date_tbd: false,
    deposit_paid_date: null, hold_expiry: null, ...overrides,
  }
}

describe('the day load (one count for every screen)', () => {
  it('counts diners, event tickets once, and private-hire guests as their own line', () => {
    const loads = buildDayLoads({
      startIso: '2026-11-21',
      endIso: '2026-11-22',
      tableBookings: [
        { booking_date: '2026-11-21', party_size: 4, booking_purpose: 'food', event_id: null, high_chair_count: 1, is_outside_seating: false },
        { booking_date: '2026-11-21', party_size: 2, booking_purpose: 'drinks', event_id: null, high_chair_count: 0, is_outside_seating: true },
        // A table-mode event's table is its ticket: counted with the tickets, not again as diners.
        { booking_date: '2026-11-21', party_size: 6, booking_purpose: 'drinks', event_id: 'event-table', high_chair_count: 0, is_outside_seating: false },
      ],
      events: [
        { id: 'event-table', date: '2026-11-21', booking_mode: 'table' },
        { id: 'event-ga', date: '2026-11-21', booking_mode: 'general' },
        { id: 'event-communal', date: '2026-11-21', booking_mode: 'communal' },
      ],
      tickets: [
        { event_id: 'event-table', seats: 6, status: 'confirmed', hold_expires_at: null },
        { event_id: 'event-ga', seats: 10, status: 'confirmed', hold_expires_at: null },
        { event_id: 'event-ga', seats: 3, status: 'pending_payment', hold_expires_at: '2026-11-21T09:30:00.000Z' },
        { event_id: 'event-ga', seats: 9, status: 'pending_payment', hold_expires_at: '2026-11-21T08:00:00.000Z' },
        { event_id: 'event-communal', seats: 5, status: 'completed', hold_expires_at: null },
      ],
      hires: [
        hire(),
        hire({ id: 'hire-enquiry', status: 'draft', guest_count: 40, start_time: '12:00:00' }),
        hire({ id: 'hire-undated', date_tbd: true }),
      ],
      hireItems: [
        { booking_id: 'hire-1', item_type: 'space', description: 'Entire Pub', quantity: 1, space: { name: 'Entire Pub' } },
        { booking_id: 'hire-1', item_type: 'catering', description: 'Finger Buffet', quantity: 120 },
      ],
      kitchen: [{ sourceKind: 'private_booking', sourceId: 'hire-1', date: '2026-11-21', foodTime: '20:00', covers: 120 }],
      now: NOW,
    })

    const day = loads.get('2026-11-21')!
    expect(day.diners).toEqual({ food: 4, drinks: 2, highChairs: 1, outside: 2 })
    expect(day.eventTickets).toEqual({ total: 24, byMode: { table: 6, general: 13, communal: 5 } })
    expect(day.covers).toBe(30)
    // Only a hire holding its room counts; the enquiry is listed but not counted.
    expect(day.privateHireGuests).toBe(120)
    expect(day.kitchenCovers).toBe(120)
    expect(day.privateHires.map((entry) => [entry.id, entry.holdsRoom])).toEqual([['hire-enquiry', false], ['hire-1', true]])
    expect(day.privateHires[1]).toMatchObject({
      customerName: 'Sam Host', startTime: '19:30', endTime: '23:30', roomNames: ['Entire Pub'],
      catering: ['Finger Buffet x 120'], kitchen: { covers: 120, foodTime: '20:00' },
    })
    expect(day.privateHires[0]).toMatchObject({ roomNames: [], catering: [], kitchen: null })
    expect(loads.get('2026-11-22')).toMatchObject({ covers: 0, privateHireGuests: 0, privateHires: [] })
    expect(describeCovers(day)).toBe('30 covers (6 diners, 24 event tickets)')
  })

  it("keeps an event table's high chairs and outside seats, which its tickets do not carry", () => {
    // The rota grid read both figures from this count; dropping event tables lost them (PR 261 review).
    const loads = buildDayLoads({
      startIso: '2026-11-21',
      endIso: '2026-11-21',
      tableBookings: [
        { booking_date: '2026-11-21', party_size: 6, booking_purpose: 'food', event_id: 'event-table', high_chair_count: 2, is_outside_seating: true },
      ],
      events: [{ id: 'event-table', date: '2026-11-21', booking_mode: 'table' }],
      tickets: [{ event_id: 'event-table', seats: 6, status: 'confirmed', hold_expires_at: null }],
      hires: [],
      hireItems: [],
      kitchen: [],
      now: NOW,
    })

    const day = loads.get('2026-11-21')!
    // Still counted once, as tickets, never again as diners.
    expect(day.diners).toEqual({ food: 0, drinks: 0, highChairs: 2, outside: 6 })
    expect(day.covers).toBe(6)
  })

  it('says the kitchen covers are unknown rather than 0 when they could not be read', () => {
    const loads = buildDayLoads({
      startIso: '2026-11-21', endIso: '2026-11-21', tableBookings: [], events: [], tickets: [], hires: [hire()], hireItems: [],
      kitchen: null, now: NOW,
    })
    expect(loads.get('2026-11-21')).toMatchObject({ kitchenCovers: null, privateHireGuests: 120 })
  })

  it('reads every row across pages, and keeps the day when only the kitchen list fails', async () => {
    const tableBookings = Array.from({ length: 1205 }, (_, index) => ({
      id: `tb-${String(index).padStart(5, '0')}`, booking_date: '2026-11-21', party_size: 1, booking_purpose: 'food',
      event_id: null, high_chair_count: 0, is_outside_seating: false, status: 'confirmed',
    }))
    const db = createFakeSupabase({
      table_bookings: tableBookings,
      events: [{ id: 'event-1', date: '2026-11-21', booking_mode: 'general', event_status: 'scheduled' }],
      bookings: [{ id: 'eb-1', event_id: 'event-1', seats: 8, status: 'confirmed', hold_expires_at: null }],
      private_bookings: [{ ...hire(), customer_first_name: null, customer_last_name: null }],
      private_booking_items: [{ id: 'item-1', booking_id: 'hire-1', item_type: 'space', space_id: 'space-1', description: 'Dining Room', quantity: 1 }],
      venue_spaces: [{ id: 'space-1', name: 'The Dining Room' }],
    }) as ReturnType<typeof createFakeSupabase> & { rpc?: unknown }
    db.rpc = vi.fn(async () => ({ data: null, error: { message: 'function kitchen_food_loads does not exist' } }))

    const loads = await loadDayLoads('2026-11-21', '2026-11-21', { db, withHours: false, now: NOW })

    expect(loads.get('2026-11-21')).toMatchObject({
      covers: 1213, privateHireGuests: 120, kitchenCovers: null,
      privateHires: [expect.objectContaining({ customerName: 'Party', roomNames: ['The Dining Room'] })],
    })
    expect(logger.error).toHaveBeenCalledWith('Could not read the kitchen covers for the day load', expect.anything())
  })
})

describe('the hours on a date', () => {
  it('lets special hours win field by field, and treats missing hours as shut', () => {
    const weekly = { opens: '12:00:00', closes: '23:00:00', kitchen_opens: '12:00:00', kitchen_closes: '21:00:00', is_closed: false, is_kitchen_closed: false }
    expect(combineDayHours('2026-12-25', weekly, { ...weekly, is_closed: true })).toMatchObject({ closed: true, kitchenClosed: true, special: true })
    expect(combineDayHours('2026-12-24', weekly, { opens: null, closes: '18:00', kitchen_opens: null, kitchen_closes: null, is_closed: false, is_kitchen_closed: true }))
      .toMatchObject({ closed: false, kitchenClosed: true, opens: '12:00', closes: '18:00' })
    expect(combineDayHours('2026-12-23', { ...weekly, kitchen_opens: null }, null)).toMatchObject({ closed: false, kitchenClosed: true })
    expect(combineDayHours('2026-12-22', null, null)).toMatchObject({ known: false, closed: false })
  })

  it('reads a range in one go', async () => {
    vi.mocked(getBusinessHoursForDates).mockResolvedValue(new Map([
      ['2026-12-24', { opens: '12:00', closes: '23:00', kitchen_opens: '12:00', kitchen_closes: '21:00', is_closed: false, is_kitchen_closed: false }],
      ['2026-12-25', { opens: '12:00', closes: '23:00', kitchen_opens: '12:00', kitchen_closes: '21:00', is_closed: false, is_kitchen_closed: false }],
    ]) as never)
    const db = createFakeSupabase({
      special_hours: [{ date: '2026-12-25', opens: null, closes: null, kitchen_opens: null, kitchen_closes: null, is_closed: true, is_kitchen_closed: true }],
    })

    const hours = await loadDayHours('2026-12-24', '2026-12-25', db)

    expect(hours.get('2026-12-24')).toMatchObject({ closed: false, kitchenClosed: false })
    expect(hours.get('2026-12-25')).toMatchObject({ closed: true, special: true })
  })
})

beforeEach(() => {
  vi.mocked(logger.error).mockClear()
})
