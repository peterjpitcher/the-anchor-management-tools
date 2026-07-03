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
      estimatedRevenue: 150,
      totalLinkClicks: 5,
    })
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
