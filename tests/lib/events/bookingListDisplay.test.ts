import { describe, expect, it } from 'vitest'
import {
  canEditEventBookingSeats,
  describeEventBookingPayment,
  describeEventBookingSeats,
  describeEventBookingStatus,
  hasEventBookingGuestDetails,
  isChangeableEventBooking,
} from '@/lib/events/booking-list-display'

/*
 * The event page's bookings list (owner request, 9 November 2026): each booking with its seats,
 * phone, whether it is paid, its status, when it was made and the actions that still work.
 * Tasting night bookings as they stood that day are the fixtures.
 */

const NOW = new Date('2026-11-09T16:00:00Z')

describe('seats', () => {
  it('says standing only when the booking stands, so a seated booking is not mistaken for a status', () => {
    expect(describeEventBookingSeats({ seats: 2, event_seating_type: 'seated' })).toBe('2')
    expect(describeEventBookingSeats({ seats: 2, event_seating_type: null })).toBe('2')
    expect(describeEventBookingSeats({ seats: 3, event_seating_type: 'standing' })).toBe('3 standing')
    expect(describeEventBookingSeats({ seats: 0 })).toBe('-')
  })
})

describe('paid', () => {
  it('names the amount and method when money was taken', () => {
    expect(describeEventBookingPayment({ paid_amount: 160, payment_status_summary: 'Paid', payment_method_summary: 'PayPal' }, 'prepaid')).toBe('Paid £160.00 · PayPal')
    expect(describeEventBookingPayment({ paid_amount: 40, payment_status_summary: 'Part refunded', payment_method_summary: 'Cash' }, 'prepaid')).toBe('Part refunded £40.00 · Cash')
  })

  it('says a hold with an unfinished PayPal checkout is not paid', () => {
    expect(describeEventBookingPayment({ paid_amount: 0, payment_status_summary: 'Pending', payment_method_summary: 'PayPal' }, 'prepaid')).toBe('Not paid')
  })

  it('separates comps, refunds, free nights and nights paid on the door from unpaid bookings', () => {
    expect(describeEventBookingPayment({ paid_amount: 0, payment_method_summary: 'Comp' }, 'prepaid')).toBe('Comp')
    expect(describeEventBookingPayment({ paid_amount: 0, payment_status_summary: 'Refunded', payment_method_summary: 'PayPal' }, 'prepaid')).toBe('Refunded · PayPal')
    expect(describeEventBookingPayment({ paid_amount: 0 }, 'free')).toBe('Free')
    expect(describeEventBookingPayment({ paid_amount: 0 }, 'cash_only')).toBe('Pays on the night')
    expect(describeEventBookingPayment({ paid_amount: 0, is_reminder_only: true }, 'prepaid')).toBe('-')
  })
})

describe('status', () => {
  it('says how long a held booking has to pay, in London time', () => {
    expect(describeEventBookingStatus({ status: 'pending_payment', hold_expires_at: '2026-11-10T14:20:00Z' }, NOW))
      .toEqual({ label: 'Waiting for payment', detail: 'until Tue 10 Nov at 2:20pm' })
    expect(describeEventBookingStatus({ status: 'pending_payment', hold_expires_at: '2026-11-09T18:30:00Z' }, NOW))
      .toEqual({ label: 'Waiting for payment', detail: 'until 6:30pm' })
  })

  it('says when a hold has ended but the hold job has not yet released it', () => {
    expect(describeEventBookingStatus({ status: 'pending_payment', hold_expires_at: '2026-11-09T14:25:16Z' }, NOW))
      .toEqual({ label: 'Waiting for payment', detail: 'hold ended 2:25pm' })
  })

  it('labels the other statuses plainly', () => {
    expect(describeEventBookingStatus({ status: 'expired' }, NOW)).toEqual({ label: 'Expired', detail: null })
    expect(describeEventBookingStatus({ status: 'confirmed' }, NOW)).toEqual({ label: 'Confirmed', detail: null })
    expect(describeEventBookingStatus({ status: 'no_show' }, NOW)).toEqual({ label: 'No Show', detail: null })
    expect(describeEventBookingStatus({ status: null }, NOW)).toEqual({ label: 'Unknown', detail: null })
  })
})

describe('which buttons work', () => {
  it('treats only confirmed and held bookings as changeable', () => {
    expect(isChangeableEventBooking({ status: 'confirmed' })).toBe(true)
    expect(isChangeableEventBooking({ status: 'pending_payment' })).toBe(true)
    for (const status of ['expired', 'cancelled', 'completed', 'no_show']) {
      expect(isChangeableEventBooking({ status })).toBe(false)
    }
  })

  it('offers Edit only where the server would accept a new seat count', () => {
    // Leo and Rupi: phone bookings whose hold ran out. The database refuses status_not_changeable.
    expect(canEditEventBookingSeats({ status: 'expired', seats: 2 }, 'prepaid')).toBe(false)
    // A held phone booking with no named guests can change size before it is paid.
    expect(canEditEventBookingSeats({ status: 'pending_payment', seats: 2, attendees: [] }, 'prepaid')).toBe(true)
    // Paid on a night paid in advance: the server sends staff to Change Tickets.
    expect(canEditEventBookingSeats({ status: 'confirmed', seats: 2 }, 'prepaid')).toBe(false)
    expect(canEditEventBookingSeats({ status: 'confirmed', seats: 2 }, 'cash_only')).toBe(true)
    // Named guests or several ticket types change guest by guest, not here.
    expect(canEditEventBookingSeats({ status: 'pending_payment', seats: 2, attendees: [{}, {}] }, 'prepaid')).toBe(false)
    expect(canEditEventBookingSeats({ status: 'confirmed', seats: 2, ticket_breakdown: '1x Adult, 1x Child' }, 'cash_only')).toBe(false)
  })

  it('offers guest details where there are some, or where the event asks for them', () => {
    expect(hasEventBookingGuestDetails({ attendees: [{}] }, false)).toBe(true)
    expect(hasEventBookingGuestDetails({ attendees: [], attendee_names: ['Sam'] }, false)).toBe(true)
    expect(hasEventBookingGuestDetails({ attendees: [], attendee_names: [' '] }, false)).toBe(false)
    expect(hasEventBookingGuestDetails({ attendees: [] }, true)).toBe(true)
    expect(hasEventBookingGuestDetails({ attendees: [], is_reminder_only: true }, true)).toBe(false)
  })
})
