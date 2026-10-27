import { describe, expect, it } from 'vitest'
import {
  eventBookingReference,
  eventBookingSeatsCounted,
  eventBookingStatus,
  privateBookingCountsTowardValue,
  splitEventTableBookings,
} from '@/lib/customers/booking-history'

describe('customer profile booking history (BK-092)', () => {
  it.each([
    ['confirmed', 'Booked', 'confirmed'],
    ['completed', 'Completed', 'completed'],
    ['cancelled', 'Cancelled', 'cancelled'],
    ['expired', 'Expired', 'expired'],
    ['pending_payment', 'Awaiting Payment', 'pending_payment'],
  ])('labels an event booking with status %s as %s', (status, label, key) => {
    expect(eventBookingStatus(status, false)).toEqual({ label, key })
  })

  it('labels a reminder as a reminder whatever its status', () => {
    expect(eventBookingStatus('confirmed', true).label).toBe('Reminder Only')
  })

  it('labels a missing status as unknown, not booked', () => {
    expect(eventBookingStatus(null, false).label).toBe('Unknown')
  })

  it("uses the booking's own id as the reference", () => {
    expect(eventBookingReference('abcdef12-3456-4000-8000-000000000000')).toBe('ABCDEF12')
  })

  it('leaves cancelled, expired and reminder bookings out of the seat total', () => {
    expect(eventBookingSeatsCounted({ seats: 4, is_reminder_only: false, status: 'confirmed' })).toBe(4)
    expect(eventBookingSeatsCounted({ seats: 4, is_reminder_only: false, status: 'completed' })).toBe(4)
    expect(eventBookingSeatsCounted({ seats: 4, is_reminder_only: false, status: 'cancelled' })).toBe(0)
    expect(eventBookingSeatsCounted({ seats: 4, is_reminder_only: false, status: 'expired' })).toBe(0)
    expect(eventBookingSeatsCounted({ seats: 4, is_reminder_only: true, status: 'confirmed' })).toBe(0)
  })

  it('leaves cancelled hires out of the lifetime value', () => {
    expect(privateBookingCountsTowardValue('cancelled')).toBe(false)
    expect(privateBookingCountsTowardValue('confirmed')).toBe(true)
    expect(privateBookingCountsTowardValue('completed')).toBe(true)
  })

  it("folds a table booked with an event booking into that event's row", () => {
    const tables = [
      { id: 't1', event_booking_id: 'e1' },
      { id: 't2', event_booking_id: null },
      { id: 't3', event_booking_id: 'e-not-on-this-profile' },
    ]
    const { standalone, byEventBooking } = splitEventTableBookings(tables, new Set(['e1']))
    expect(standalone.map((t) => t.id)).toEqual(['t2', 't3'])
    expect(byEventBooking.get('e1')?.map((t) => t.id)).toEqual(['t1'])
  })
})
