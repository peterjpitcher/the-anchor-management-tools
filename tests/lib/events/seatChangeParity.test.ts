import { describe, expect, it, vi } from 'vitest'

/*
 * BK-021: guests could do more than staff. A staff seat change on a paid booking was refused,
 * while the guest's link cut the seats and refunded at once. The guest rule now refuses every
 * case the staff rule refuses, and sends a paid booking to a manager instead.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { guestSeatChangeBlock, updateEventBookingSeatsById, type EventManagePreviewResult } from '@/lib/events/manage-booking'

type Scenario = {
  name: string
  paymentMode: 'prepaid' | 'cash_only'
  status: 'confirmed' | 'pending_payment'
  items: Array<{ ticket_type_id: string; quantity: number }>
  namedGuests: boolean
}

function fakeSupabase(scenario: Scenario) {
  const rpc = vi.fn(async () => ({
    data: scenario.namedGuests ? { state: 'blocked', reason: 'guest_details_locked' } : { state: 'updated', delta: -1 },
    error: null,
  }))
  return {
    rpc,
    from: (table: string) => {
      const data = table === 'bookings'
        ? { id: 'booking-1', event_id: 'event-1', status: scenario.status, seats: 3, is_reminder_only: false, event: { id: 'event-1', payment_mode: scenario.paymentMode } }
        : table === 'event_ticket_types' ? { id: 'adult' } : null
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: table === 'booking_items' ? scenario.items.map((item, index) => ({ id: `i${index}`, booking_id: 'booking-1', unit_price: 10, attendee_names: [], ...item })) : [], error: null }),
      }
      return builder
    },
  }
}

function previewFor(scenario: Scenario): EventManagePreviewResult {
  return {
    state: 'ready', booking_id: 'booking-1', event_id: 'event-1', status: scenario.status, seats: 3,
    payment_mode: scenario.paymentMode, can_change_seats: !scenario.namedGuests, has_named_guests: scenario.namedGuests,
    seat_change_blocked_reason: scenario.namedGuests ? 'guest_details_locked' : null,
  }
}

const SCENARIOS: Array<Scenario & { staff: string | null; guest: string | null }> = [
  { name: 'a paid prepaid booking', paymentMode: 'prepaid', status: 'confirmed', items: [{ ticket_type_id: 'adult', quantity: 3 }], namedGuests: false, staff: 'prepaid_paid_booking', guest: 'change_by_request' },
  { name: 'a multi-type booking', paymentMode: 'cash_only', status: 'confirmed', items: [{ ticket_type_id: 'adult', quantity: 2 }, { ticket_type_id: 'child', quantity: 1 }], namedGuests: false, staff: 'multi_ticket_type_booking', guest: 'multi_ticket_type_booking' },
  { name: 'named guests on a pay-on-the-night booking', paymentMode: 'cash_only', status: 'confirmed', items: [{ ticket_type_id: 'adult', quantity: 3 }], namedGuests: true, staff: 'guest_details_locked', guest: 'guest_details_locked' },
  { name: 'an ordinary pay-on-the-night booking', paymentMode: 'cash_only', status: 'confirmed', items: [{ ticket_type_id: 'adult', quantity: 3 }], namedGuests: false, staff: null, guest: null },
  // BK-143: the booking's only line is on 'early-bird', a type taken off sale so the event's
  // default is now 'adult' (the fixture's default type). It still changes size.
  { name: 'a one-line booking on a ticket type that is no longer the default', paymentMode: 'cash_only', status: 'confirmed', items: [{ ticket_type_id: 'early-bird', quantity: 3 }], namedGuests: false, staff: null, guest: null },
]

describe('guest and staff seat changes follow the same rule', () => {
  it.each(SCENARIOS)('$name', async (scenario) => {
    const staffDb = fakeSupabase(scenario)
    const staff = await updateEventBookingSeatsById(staffDb as never, { bookingId: 'booking-1', newSeats: 2 })
    expect(staff.state === 'blocked' ? staff.reason : null).toBe(scenario.staff)

    const guest = await guestSeatChangeBlock(fakeSupabase(scenario) as never, previewFor(scenario))
    expect(guest).toBe(scenario.guest)

    // Whatever the staff rule refuses, the guest link does not change directly either.
    expect(scenario.staff === null).toBe(guest === null)
  })
})
