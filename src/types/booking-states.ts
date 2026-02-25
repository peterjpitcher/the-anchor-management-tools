/**
 * Canonical booking status types for all booking domains.
 *
 * DB enum cross-reference:
 *   private_bookings.status    → PrivateBookingStatus  (booking_status enum)
 *   parking_bookings.status    → ParkingBookingStatus  (parking_booking_status enum)
 *   table_bookings.status      → TableBookingStatus    (table_booking_status enum)
 *   event_bookings.status      → EventBookingStatus    (event_booking_status enum)
 */

export type { BookingStatus as PrivateBookingStatus } from './private-bookings'
export type { ParkingBookingStatus } from './parking'

export type TableBookingStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type EventBookingStatus =
  | 'pending'
  | 'confirmed'
  | 'waitlisted'
  | 'cancelled'
  | 'attended'
  | 'no_show'
