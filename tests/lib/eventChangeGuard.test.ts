import { describe, expect, it } from 'vitest'
import {
  assessEventChange,
  describeEventLifecycleImpact,
  diffEventSnapshots,
  EMPTY_EVENT_BOOKING_IMPACT,
  loadEventBookingImpact,
  type EventChangeInput,
} from '@/lib/events/event-change-guard'

/* The pure rules and counts behind event edit confirmations (BK-026, BK-036, BK-089, BK-139, BK-140). */

const current: EventChangeInput['current'] = {
  date: '2099-11-20',
  time: '19:00:00',
  end_time: '22:00:00',
  event_status: 'scheduled',
  payment_mode: 'prepaid',
  price: 45,
  capacity: null,
  booking_mode: 'general',
  booking_cutoff_at: '2099-11-20T17:00:00.000Z',
  online_discount_ends_at: '2099-11-19T18:00:00.000Z',
}

function input(next: Partial<EventChangeInput['next']>, activeBookings = 0): EventChangeInput {
  return {
    current,
    next: { date: current.date, time: current.time, event_status: 'scheduled', payment_mode: 'prepaid', price: 45, capacity: null, ...next },
    impact: { ...EMPTY_EVENT_BOOKING_IMPACT, activeBookings, activeSeats: activeBookings * 2, reachableByEmail: activeBookings },
    seatedBookingsMoveWithEvent: false,
  }
}

describe('assessEventChange', () => {
  it('lets an unbooked event change anything but its status to cancelled or postponed', () => {
    expect(assessEventChange(input({ date: '2099-11-27', payment_mode: 'cash_only', price: 40 }))).toEqual({ blockers: [], confirmations: [], warnings: [] })
    expect(assessEventChange(input({ event_status: 'cancelled' })).blockers[0]).toContain('Use Cancel event')
  })

  it('warns when the sales close time or discount deadline would fall after an earlier new start (BK-140)', () => {
    const result = assessEventChange(input({ date: '2099-11-18' }))
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0]).toContain('Online ticket sales are set to close at')
    expect(result.warnings[0]).toContain('after the new start')
    expect(result.warnings[1]).toContain('The online discount ends at')
  })

  it('treats 19:00 and 19:00:00 as the same time', () => {
    expect(assessEventChange(input({ time: '19:00' }, 4)).confirmations).toEqual([])
  })

  it('uses one booking and many bookings correctly', () => {
    expect(assessEventChange(input({ price: 50 }, 1)).confirmations).toEqual([
      '1 booking (2 seats) keeps the price they booked at. The new price applies to new sales only.',
    ])
  })
})

describe('diffEventSnapshots', () => {
  it('records only what changed, reading numbers and times the way the database stores them', () => {
    expect(diffEventSnapshots(
      { price: '45.00', time: '19:00:00', name: 'Quiz', capacity: null },
      { price: 45, time: '19:00', name: 'Quiz Night', capacity: null },
    )).toEqual({ old_values: { name: 'Quiz' }, new_values: { name: 'Quiz Night' } })
    expect(diffEventSnapshots({ price: 45 }, { price: 45 })).toBeNull()
  })
})

describe('describeEventLifecycleImpact', () => {
  it('says plainly when nobody has booked', () => {
    expect(describeEventLifecycleImpact('cancel', EMPTY_EVENT_BOOKING_IMPACT)).toEqual(['Nobody has booked, so nobody is refunded or told.'])
  })

  it('lists who must be rung because no message can reach them (BK-089)', () => {
    const lines = describeEventLifecycleImpact('postpone', { ...EMPTY_EVENT_BOOKING_IMPACT, activeBookings: 9, activeSeats: 20, reachableByEmail: 4, reachableByTextOnly: 4, unreachable: 1 })
    expect(lines[1]).toContain('Guests are told 4 by email and 4 by text. 1 booking has no email or textable mobile, so ring that guest.')
  })
})

describe('loadEventBookingImpact', () => {
  function db(tables: Record<string, unknown[]>, failing?: string) {
    return {
      from: (table: string) => {
        const builder: Record<string, unknown> = {}
        Object.assign(builder, {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          then: (resolve: (value: unknown) => unknown) => resolve(failing === table
            ? { data: null, error: { message: 'down' } }
            : { data: tables[table] ?? [], error: null }),
        })
        return builder
      },
    }
  }

  it('counts active seats, money still held, seated bookings and how each guest can be reached', async () => {
    const result = await loadEventBookingImpact(db({
      bookings: [
        { id: 'a', seats: 2, status: 'confirmed', is_reminder_only: false, customer: { email: 'a@example.com' } },
        { id: 'b', seats: 3, status: 'pending_payment', is_reminder_only: false, customer: { email: null, mobile_number: '+447700900001', sms_status: 'active' } },
        { id: 'c', seats: 1, status: 'confirmed', is_reminder_only: false, customer: { email: null, mobile_number: null, sms_status: null } },
        { id: 'd', seats: 0, status: 'confirmed', is_reminder_only: true, customer: { email: 'd@example.com' } },
        { id: 'e', seats: 2, status: 'expired', is_reminder_only: false, customer: { email: 'e@example.com' } },
      ],
      // payments is read twice (charges, then refunds); the mock serves both from one list, so the
      // refund rows here are charge rows too, which is enough to prove they are subtracted.
      payments: [{ event_booking_id: 'a', amount: 40 }, { event_booking_id: 'e', amount: 20 }],
      table_bookings: [{ event_booking_id: 'a' }],
      event_communal_seat_allocations: [{ event_booking_id: 'c' }],
    }) as never, 'event')
    expect(result).toMatchObject({
      activeBookings: 3,
      activeSeats: 6,
      pendingPaymentBookings: 1,
      seatedBookings: 2,
      reachableByEmail: 1,
      reachableByTextOnly: 1,
      unreachable: 1,
    })
    // Charges and refunds are equal in this mock, so nothing is still owed.
    expect(result.paidBookings).toBe(0)
    expect(result.amountPaid).toBe(0)
  })

  it('throws when a count cannot be read, rather than reporting nobody affected', async () => {
    await expect(loadEventBookingImpact(db({ bookings: [] }, 'bookings') as never, 'event')).rejects.toThrow('Could not count')
    await expect(loadEventBookingImpact(db({ bookings: [{ id: 'a', seats: 1, status: 'confirmed' }] }, 'payments') as never, 'event')).rejects.toThrow('Could not check')
  })
})
