import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../../helpers/fakeSupabase'

/**
 * BK-120: the bookings report counted every event row (1,143 of them old reminder-only
 * sign-ups), cancellations and expiries as bookings, counted cancelled and no-show tables,
 * dropped completed private hires, and bucketed covers by when the booking was made. Now it
 * counts real bookings and buckets covers by the day the guests came.
 */

const state = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))

import { loadTableBookingReportsSnapshot } from '@/lib/analytics/table-booking-reports'

function seed() {
  state.db = createFakeSupabase({
    events: [
      { id: 'event-past', start_datetime: '2026-10-10T18:00:00.000Z', date: '2026-10-10', time: '19:00' },
      { id: 'event-future', start_datetime: '2026-11-05T19:00:00.000Z', date: '2026-11-05', time: '19:00' },
    ],
    bookings: [
      { id: 'b1', event_id: 'event-past', customer_id: 'c1', seats: 4, status: 'confirmed', is_reminder_only: false, booking_source: 'direct_booking', created_at: '2026-08-01T10:00:00.000Z' },
      { id: 'b2', event_id: 'event-past', customer_id: 'c2', seats: 2, status: 'completed', is_reminder_only: false, booking_source: 'direct_booking', created_at: '2026-10-05T10:00:00.000Z' },
      { id: 'b3', event_id: 'event-past', customer_id: 'c3', seats: 1, status: 'confirmed', is_reminder_only: true, booking_source: 'bulk_add', created_at: '2026-10-06T10:00:00.000Z' },
      { id: 'b4', event_id: 'event-past', customer_id: 'c4', seats: 3, status: 'cancelled', is_reminder_only: false, booking_source: 'direct_booking', created_at: '2026-10-06T10:00:00.000Z' },
      { id: 'b5', event_id: 'event-past', customer_id: 'c5', seats: 2, status: 'expired', is_reminder_only: false, booking_source: 'direct_booking', created_at: '2026-10-07T10:00:00.000Z' },
      { id: 'b6', event_id: 'event-future', customer_id: 'c6', seats: 5, status: 'confirmed', is_reminder_only: false, booking_source: 'direct_booking', created_at: '2026-10-20T10:00:00.000Z' },
    ],
    table_bookings: [
      { id: 't1', customer_id: 'c7', party_size: 4, status: 'confirmed', source: 'brand_site', booking_date: '2026-10-12', booking_time: '18:00:00', start_datetime: '2026-10-12T17:00:00.000Z', created_at: '2026-09-01T10:00:00.000Z' },
      { id: 't2', customer_id: 'c8', party_size: 6, status: 'cancelled', source: 'brand_site', booking_date: '2026-10-13', booking_time: '18:00:00', start_datetime: '2026-10-13T17:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' },
      { id: 't3', customer_id: 'c9', party_size: 2, status: 'no_show', source: 'phone', booking_date: '2026-10-14', booking_time: '18:00:00', start_datetime: '2026-10-14T17:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' },
      { id: 't4', customer_id: 'c10', party_size: 3, status: 'completed', source: 'phone', booking_date: '2026-10-15', booking_time: '18:00:00', start_datetime: null, created_at: '2026-10-03T10:00:00.000Z' },
    ],
    private_bookings: [
      { id: 'p1', customer_id: 'c11', guest_count: 30, status: 'confirmed', source: 'phone', event_date: '2026-10-18', start_time: '19:00:00', date_tbd: false, created_at: '2026-07-01T10:00:00.000Z' },
      { id: 'p2', customer_id: 'c12', guest_count: 20, status: 'completed', source: 'phone', event_date: '2026-10-03', start_time: '12:00:00', date_tbd: false, created_at: '2026-10-01T09:00:00.000Z' },
      { id: 'p3', customer_id: 'c13', guest_count: 40, status: 'cancelled', source: 'phone', event_date: '2026-10-19', start_time: '19:00:00', date_tbd: false, created_at: '2026-10-02T10:00:00.000Z' },
      { id: 'p4', customer_id: 'c14', guest_count: 50, status: 'confirmed', source: 'phone', event_date: '2026-10-20', start_time: '19:00:00', date_tbd: true, created_at: '2026-10-21T10:00:00.000Z' },
    ],
    waitlist_entries: [],
    waitlist_offers: [],
    customer_scores: [],
    customers: [],
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'))
  seed()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('table booking reports count real bookings (BK-120)', () => {
  it('leaves out reminder-only sign-ups, cancellations, expiries and no-shows, and keeps completed private hires', async () => {
    const snapshot = await loadTableBookingReportsSnapshot({ window: 'month' })

    expect(snapshot.bookings_by_type.all_time).toEqual({ event: 3, table: 2, private: 3, total: 8 })
    // This month (from 1 October, London): b2 and b6; t4; p2 and p4.
    expect(snapshot.bookings_by_type.selected_window).toEqual({ event: 2, table: 1, private: 2, total: 5 })
  })

  it('counts event conversion from bookings, not reminder-only sign-ups', async () => {
    const snapshot = await loadTableBookingReportsSnapshot({ window: 'month' })

    expect(snapshot.event_conversion_and_waitlist).toMatchObject({
      bookings_created: 5,
      bookings_confirmed: 3,
      bookings_cancelled: 1,
    })
  })

  it('counts covers by the day the guests came, leaving out the future and placeholder dates', async () => {
    const snapshot = await loadTableBookingReportsSnapshot({ window: 'month' })

    // Event 4 + 2, tables 4 + 3, private hire 30 + 20. Booking dates do not matter.
    expect(snapshot.covers_trend.total_covers).toBe(63)
  })

  it('counts active guests from real bookings only', async () => {
    const snapshot = await loadTableBookingReportsSnapshot({ window: 'month' })

    // Real bookings made since 1 October: b2, b6, t4, p2 and p4.
    expect(snapshot.new_vs_returning.active_guests_selected_window).toBe(5)
  })
})
