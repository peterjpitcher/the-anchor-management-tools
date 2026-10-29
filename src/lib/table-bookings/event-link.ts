import { NextResponse } from 'next/server'

/**
 * A table booking made for an event booking is the table half of one booking (BK-074, customer
 * bookings review of 24 October 2026). Cancelling the event booking cancels its table, but
 * cancelling, no-showing, moving or deleting the table from FOH or BOH used to leave the paid ticket
 * confirmed with no seat, still counting against capacity, and skipped the manager's refund
 * choice. Every staff and guest path that changes the table on its own now refuses, with the rule
 * and code the FOH time route already used.
 */
export const EVENT_LINKED_TABLE_BOOKING_ERROR = 'This booking is tied to an event. Change it from the event instead.'
export const EVENT_LINKED_TABLE_BOOKING_CODE = 'event_linked'

export function isEventLinkedTableBooking(booking: { event_booking_id?: string | null } | null | undefined): boolean {
  return typeof booking?.event_booking_id === 'string' && booking.event_booking_id.length > 0
}

export function eventLinkedTableBookingResponse(): NextResponse {
  return NextResponse.json(
    { error: EVENT_LINKED_TABLE_BOOKING_ERROR, code: EVENT_LINKED_TABLE_BOOKING_CODE },
    { status: 409 },
  )
}
