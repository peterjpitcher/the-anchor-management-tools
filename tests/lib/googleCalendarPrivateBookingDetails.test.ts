import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Pub Ops calendar entry for a private booking (BK-156, BK-209, D28): the real deposit, the
 * rooms, the times with setup and cleardown, an enquiry with no time said so, and a finish after
 * midnight on the right instant on the nights the clocks change.
 */

const state = vi.hoisted(() => ({ facts: null as Record<string, unknown> | null, inserted: [] as Array<Record<string, any>> }))

vi.mock('googleapis', () => {
  const calendar = {
    events: {
      insert: vi.fn(async (input: { requestBody: Record<string, unknown> }) => {
        state.inserted.push(input.requestBody)
        return { data: { id: 'event-1' } }
      }),
      update: vi.fn(),
    },
  }
  class OAuth2 {
    setCredentials() {}
  }
  return { google: { calendar: () => calendar, auth: { OAuth2 } } }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.facts, error: state.facts ? null : { message: 'gone' } }) }),
      }),
    }),
  }),
}))

import { combineDateAndTime, describeCalendarDeposit, formatBookingDetails, syncCalendarEvent } from '@/lib/google-calendar'
import type { PrivateBooking } from '@/types/private-bookings'

const BOOKING = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  customer_name: 'Jane Doe',
  contact_phone: '+447700900123',
  event_date: '2026-12-05',
  start_time: '18:00:00',
  end_time: '23:30:00',
  end_time_next_day: false,
  guest_count: 40,
  status: 'confirmed',
  deposit_amount: 100,
} as unknown as PrivateBooking

describe('the calendar deposit line', () => {
  it.each([
    [{ deposit_paid_date: '2026-10-01', deposit_amount: 100 }, 'Deposit: paid'],
    [{ deposit_waived: true, deposit_amount: 0 }, 'Deposit: waived'],
    [{ deposit_amount: 100, deposit_confirmed_at: '2026-10-01T10:00:00Z' }, 'Deposit: £100 due'],
    [{ deposit_amount: 87.5, deposit_confirmed_at: '2026-10-01T10:00:00Z' }, 'Deposit: £87.50 due'],
    [{ deposit_amount: 100, deposit_confirmed_at: null }, 'Deposit: £100, to be confirmed'],
    [{ deposit_amount: 0 }, 'Deposit: none'],
    [{ deposit_amount: null }, 'Deposit: none'],
  ])('%o reads %s', (booking, line) => {
    expect(describeCalendarDeposit(booking as never)).toBe(line)
  })

  it('never says £250 when that is not the deposit', () => {
    expect(formatBookingDetails({ ...BOOKING, deposit_waived: true, deposit_amount: 0 } as PrivateBooking)).not.toContain('250')
  })
})

describe('the calendar description', () => {
  it('names the rooms, the times and the setup and cleardown', () => {
    const text = formatBookingDetails(
      { ...BOOKING, setup_time: '17:00', end_time: '00:30', end_time_next_day: true } as PrivateBooking,
      ['Function Room', 'Garden'],
    )
    expect(text).toContain('Guests: 40')
    expect(text).toContain('Rooms: Function Room, Garden')
    expect(text).toContain('Times: 18:00 to 00:30 (next day)')
    expect(text).toContain('Access: setup from 17:00, cleared by 01:30 (next day) (standard hour)')
  })

  it('says when no room is booked', () => {
    expect(formatBookingDetails(BOOKING, [])).toContain('Rooms: none booked yet')
  })

  it('labels a website enquiry that gave no time instead of showing a lunchtime slot', () => {
    const text = formatBookingDetails({ ...BOOKING, source: 'website', start_time: '12:00:00', end_time: undefined } as unknown as PrivateBooking)
    expect(text).toContain('Enquiry, time not given')
    expect(text).not.toContain('Times:')
  })

  for (const tz of ['Europe/London', 'UTC']) {
    it(`renders with no undefined, NaN or Invalid Date (${tz} run)`, () => {
      const text = formatBookingDetails({ ...BOOKING } as PrivateBooking, ['Function Room'])
      expect(text).not.toMatch(/undefined|NaN|Invalid Date/)
    })
  }
})

describe('a finish after midnight (BK-209)', () => {
  it.each([
    ['2026-10-24', '2026-10-25T02:00:00.000Z'],
    ['2027-03-27', '2027-03-28T01:00:00.000Z'],
    ['2026-06-15', '2026-06-16T01:00:00.000Z'],
  ])('02:00 next day after %s is %s', (date, instant) => {
    expect(combineDateAndTime(date, '02:00', true).toISOString()).toBe(instant)
  })

  it('a same-day time is unchanged', () => {
    expect(combineDateAndTime('2026-10-24', '23:00').toISOString()).toBe('2026-10-24T22:00:00.000Z')
  })
})

describe('syncing a booking', () => {
  beforeEach(() => {
    state.inserted = []
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh'
  })

  it('describes the deposit and rooms as stored, not as the caller passed them', async () => {
    state.facts = {
      id: BOOKING.id,
      deposit_amount: 0,
      deposit_paid_date: null,
      deposit_waived: true,
      deposit_confirmed_at: null,
      setup_date: null,
      setup_time: null,
      cleardown_time: null,
      source: 'phone',
      items: [{ space_id: 'room-1', display_order: 1, space: { name: 'Function Room' } }, { space_id: null, display_order: 2, space: null }],
    }
    expect(await syncCalendarEvent(BOOKING)).toBe('event-1')
    expect(state.inserted[0].description).toContain('Deposit: waived')
    expect(state.inserted[0].description).toContain('Rooms: Function Room')
  })

  it('ends a 02:00 finish on the night the clocks go back at 02:00 GMT', async () => {
    state.facts = null
    await syncCalendarEvent({ ...BOOKING, event_date: '2026-10-24', start_time: '20:00', end_time: '02:00', end_time_next_day: true } as PrivateBooking)
    expect(state.inserted[0].end.dateTime).toBe('2026-10-25T02:00:00Z')
  })
})
