import { describe, expect, it } from 'vitest'
import { buildEventBookingStats, resolveEventCapacity } from './stats'

describe('event stats', () => {
  it('counts only booked seats from confirmed/completed booking statuses', () => {
    const stats = buildEventBookingStats(
      { capacity: 20, price: 3, payment_mode: 'cash_only' },
      [
        { seats: 4, status: 'confirmed', is_reminder_only: false },
        { seats: 3, status: 'pending_payment', is_reminder_only: false },
        { seats: 2, status: 'cancelled', is_reminder_only: false },
        { seats: 1, status: 'confirmed', is_reminder_only: true },
        { seats: 2, status: 'completed', is_reminder_only: false },
      ],
      [{ clickCount: 5 }, { clickCount: null }]
    )

    expect(stats).toEqual({
      activeBookings: 2,
      totalSeats: 6,
      capacity: 20,
      capacityPct: 30,
      estimatedRevenue: 18,
      totalLinkClicks: 5,
    })
  })

  it('counts unexpired pending_payment holds as booked seats', () => {
    const now = new Date('2026-07-04T12:00:00Z')
    const stats = buildEventBookingStats(
      { capacity: 10, price: 10, payment_mode: 'prepaid' },
      [
        { seats: 2, status: 'confirmed', is_reminder_only: false },
        { seats: 3, status: 'pending_payment', is_reminder_only: false, hold_expires_at: '2026-07-04T12:15:00Z' },
        { seats: 4, status: 'pending_payment', is_reminder_only: false, hold_expires_at: '2026-07-04T11:00:00Z' },
        { seats: 5, status: 'pending_payment', is_reminder_only: false, hold_expires_at: null },
      ],
      [],
      now
    )

    expect(stats.activeBookings).toBe(2)
    expect(stats.totalSeats).toBe(5)
    expect(stats.capacityPct).toBe(50)
  })

  it('estimates revenue from booking charge totals when supplied, with event-price fallback', () => {
    const stats = buildEventBookingStats(
      { capacity: 20, price: 15, payment_mode: 'prepaid' },
      [
        // Multi-type booking: charge comes from its booking_items sum
        { seats: 2, status: 'confirmed', is_reminder_only: false, charge_total: 23 },
        // Legacy booking without items: event price × seats
        { seats: 2, status: 'confirmed', is_reminder_only: false },
      ]
    )

    expect(stats.estimatedRevenue).toBe(53)
  })

  it('estimates £0 revenue for free events', () => {
    const stats = buildEventBookingStats(
      { capacity: 20, price: 0, is_free: true, payment_mode: 'free' },
      [{ seats: 4, status: 'confirmed', is_reminder_only: false }]
    )

    expect(stats.estimatedRevenue).toBe(0)
  })

  it('uses split communal capacity before static capacity', () => {
    expect(resolveEventCapacity({
      booking_mode: 'communal',
      capacity: 100,
      seated_capacity: 41,
      standing_capacity: 15,
    })).toBe(56)
  })
})
