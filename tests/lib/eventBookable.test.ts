import { describe, expect, it } from 'vitest'
import { onlineBookingClosedReason } from '@/lib/events/bookable'

/* One rule for when a guest can book online or by text reply (BK-035, BK-089; owner decision D11). */

const NOW = Date.parse('2026-11-01T12:00:00.000Z')

describe('onlineBookingClosedReason', () => {
  it('is open for a scheduled night with bookings on and no sales close time', () => {
    expect(onlineBookingClosedReason({ event_status: 'scheduled', bookings_enabled: true, booking_open: true }, NOW)).toBeNull()
    expect(onlineBookingClosedReason({}, NOW)).toBeNull()
  })

  it.each(['cancelled', 'draft', 'postponed'])('refuses a %s night', (status) => {
    expect(onlineBookingClosedReason({ event_status: status }, NOW)).toBe('not_bookable')
  })

  it('refuses when Accept bookings is off, when the night was closed, and once sales have closed', () => {
    expect(onlineBookingClosedReason({ bookings_enabled: false }, NOW)).toBe('bookings_disabled')
    expect(onlineBookingClosedReason({ booking_open: false }, NOW)).toBe('booking_closed')
    expect(onlineBookingClosedReason({ booking_cutoff_at: '2026-11-01T12:00:00.000Z' }, NOW)).toBe('sales_closed')
    expect(onlineBookingClosedReason({ booking_cutoff_at: '2026-11-01T12:00:01.000Z' }, NOW)).toBeNull()
  })

  it('refuses once the night has started', () => {
    expect(onlineBookingClosedReason({ start_datetime: '2026-11-01T11:59:00.000Z' }, NOW)).toBe('event_started')
  })
})
