import { describe, expect, it } from 'vitest'
import { buildEventBookingStats, resolveEventCapacity } from './stats'

describe('event stats', () => {
  it('excludes cancelled and reminder-only bookings', () => {
    const stats = buildEventBookingStats(
      { capacity: 20, price: 3, payment_mode: 'cash_only' },
      [
        { seats: 4, status: 'confirmed', is_reminder_only: false },
        { seats: 2, status: 'cancelled', is_reminder_only: false },
        { seats: 1, status: 'confirmed', is_reminder_only: true },
      ],
      [{ clickCount: 5 }, { clickCount: null }]
    )

    expect(stats).toEqual({
      activeBookings: 1,
      totalSeats: 4,
      capacity: 20,
      capacityPct: 20,
      estimatedRevenue: 100,
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
