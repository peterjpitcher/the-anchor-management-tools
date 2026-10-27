import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Review BK-076 (24 October 2026): saving special hours, changing the weekly hours or publishing a
 * new schedule never looked at what was already booked, so guests booked on a day that then closed
 * were not surfaced until they turned up. After a change the manager is now shown every live booking
 * the new hours leave out; nothing is moved, cancelled or messaged.
 */

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/business-hours/day-hours', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/business-hours/day-hours')>()),
  loadDayHours: vi.fn(),
}))
vi.mock('@/services/kitchen-load', () => ({ loadKitchenLoads: vi.fn(async () => []) }))

import { checkHoursImpact, findBookingsOutsideHours, insideWindow, tableBookingProblem } from '@/services/hours-impact'
import { combineDayHours, loadDayHours } from '@/lib/business-hours/day-hours'
import { loadKitchenLoads } from '@/services/kitchen-load'

const OPEN = { opens: '12:00', closes: '23:00', kitchen_opens: '12:00', kitchen_closes: '21:00', is_closed: false, is_kitchen_closed: false }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-01T10:00:00.000Z'))
  vi.mocked(loadKitchenLoads).mockResolvedValue([])
})

describe('a booking against the day\'s hours', () => {
  it('reads windows on the London clock, including ones that run past midnight', () => {
    expect(insideWindow('19:00', '12:00', '23:00')).toBe(true)
    expect(insideWindow('23:00', '12:00', '23:00')).toBe(false)
    expect(insideWindow('11:45', '12:00', '23:00')).toBe(false)
    expect(insideWindow('00:30', '18:00', '01:00')).toBe(true)
    expect(insideWindow('01:30', '18:00', '01:00')).toBe(false)
    expect(insideWindow(null, '12:00', '23:00')).toBe(false)
  })

  it('names why a booking no longer fits, food against the kitchen too', () => {
    const open = combineDayHours('2026-12-24', OPEN, null)
    expect(tableBookingProblem({ booking_time: '19:00', booking_purpose: 'food' }, open)).toBeNull()
    expect(tableBookingProblem({ booking_time: '21:30', booking_purpose: 'food' }, open)).toBe('outside_kitchen_hours')
    expect(tableBookingProblem({ booking_time: '21:30', booking_purpose: 'drinks' }, open)).toBeNull()
    expect(tableBookingProblem({ booking_time: '23:30', booking_purpose: 'drinks' }, open)).toBe('outside_hours')
    expect(tableBookingProblem({ booking_time: '19:00', booking_purpose: 'food' }, combineDayHours('2026-12-25', OPEN, { ...OPEN, is_closed: true }))).toBe('closed')
    expect(tableBookingProblem({ booking_time: '19:00', booking_purpose: 'food' }, combineDayHours('2026-12-26', { ...OPEN, is_kitchen_closed: true }, null))).toBe('kitchen_closed')
    // Hours nobody set are unknown, never "closed".
    expect(tableBookingProblem({ booking_time: '19:00', booking_purpose: 'food' }, combineDayHours('2026-12-27', null, null))).toBeNull()
  })
})

describe('the bookings an hours change leaves out', () => {
  function seed() {
    return createFakeSupabase({
      table_bookings: [
        { id: 'tb-closed', booking_reference: 'TB-1', booking_date: '2026-12-25', booking_time: '13:00', booking_purpose: 'food', party_size: 6, status: 'confirmed', customer_id: 'c1' },
        { id: 'tb-late-food', booking_reference: 'TB-2', booking_date: '2026-12-24', booking_time: '20:30', booking_purpose: 'food', party_size: 2, status: 'confirmed', customer_id: 'c1' },
        { id: 'tb-fine', booking_reference: 'TB-3', booking_date: '2026-12-24', booking_time: '13:00', booking_purpose: 'food', party_size: 4, status: 'confirmed', customer_id: 'c1' },
        { id: 'tb-past', booking_reference: 'TB-4', booking_date: '2026-11-20', booking_time: '13:00', booking_purpose: 'food', party_size: 4, status: 'confirmed', customer_id: 'c1' },
      ],
      customers: [{ id: 'c1', first_name: 'Ann', last_name: 'Diner' }],
      events: [
        { id: 'event-closed', name: 'Carols', date: '2026-12-25', time: '18:00', event_status: 'scheduled' },
        { id: 'event-food', name: 'Supper Club', date: '2026-12-26', time: '19:00', event_status: 'scheduled' },
        { id: 'event-no-food', name: 'Quiz', date: '2026-12-26', time: '20:00', event_status: 'scheduled' },
      ],
      private_bookings: [
        { id: 'hire-closed', customer_name: 'Party', event_date: '2026-12-25', start_time: '19:00', guest_count: 40, status: 'confirmed', date_tbd: false },
        { id: 'hire-undated', customer_name: 'Maybe', event_date: '2026-12-25', start_time: '19:00', guest_count: 40, status: 'draft', date_tbd: true },
      ],
    })
  }

  it('lists table bookings, events and hires the hours now leave out, from today on, in date order', async () => {
    vi.mocked(loadDayHours).mockResolvedValue(new Map([
      ['2026-12-24', combineDayHours('2026-12-24', OPEN, { ...OPEN, kitchen_closes: '20:00' })],
      ['2026-12-25', combineDayHours('2026-12-25', OPEN, { ...OPEN, is_closed: true })],
      ['2026-12-26', combineDayHours('2026-12-26', { ...OPEN, is_kitchen_closed: true }, null)],
    ]))
    vi.mocked(loadKitchenLoads).mockResolvedValue([
      { sourceKind: 'event', sourceId: 'event-food', date: '2026-12-26', foodTime: '19:00', covers: 30 },
    ])

    const impact = await findBookingsOutsideHours('2026-11-01', '2026-12-26', seed())

    // The check starts today (1 December), not at a date already past.
    expect(loadDayHours).toHaveBeenCalledWith('2026-12-01', '2026-12-26', expect.anything())
    expect(impact.from).toBe('2026-12-01')
    expect(impact.items.map((item) => [item.kind, item.id, item.reason])).toEqual([
      ['table_booking', 'tb-late-food', 'outside_kitchen_hours'],
      ['table_booking', 'tb-closed', 'closed'],
      ['event', 'event-closed', 'closed'],
      ['private_hire', 'hire-closed', 'closed'],
      ['event', 'event-food', 'kitchen_closed'],
    ])
    expect(impact.items[0]).toMatchObject({ reference: 'TB-2', label: 'Ann Diner', time: '20:30', guests: 2 })
  })

  it('says the check did not run rather than reporting nothing, and never throws', async () => {
    vi.mocked(loadDayHours).mockRejectedValue(new Error('timeout'))
    await expect(checkHoursImpact('2026-12-24', '2026-12-26', seed())).resolves.toEqual({
      impactError: 'The hours were saved, but the bookings already taken could not be checked against them. Check the diary for these dates.',
    })
  })
})
