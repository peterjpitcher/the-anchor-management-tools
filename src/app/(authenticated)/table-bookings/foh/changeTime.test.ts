import { describe, it, expect } from 'vitest'
import {
  buildTimeChangeOptions,
  collectBusyIntervals,
  formatMinutesAsClock,
  getFohTimeChangeBlocker,
  isFohBookingLive,
} from './utils'
import type { FohBooking, FohScheduleResponse, TimelineRange } from './types'

const SERVICE_DATE = '2026-09-01'
const NOW = new Date('2026-09-01T17:00:00.000Z')

function makeBooking(overrides: Partial<FohBooking> = {}): FohBooking {
  return {
    id: 'booking-1',
    booking_reference: 'TB-001',
    guest_name: 'Smith',
    booking_time: '18:00',
    party_size: 2,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    notes: null,
    start_datetime: '2026-09-01T17:00:00.000Z',
    end_datetime: '2026-09-01T18:30:00.000Z',
    assigned_table_ids: ['table-a'],
    assignment_count: 1,
    ...overrides,
  }
}

function makeSchedule(laneBookings: FohBooking[], tableId = 'table-a'): FohScheduleResponse['data'] {
  return {
    date: SERVICE_DATE,
    service_window: { start_time: '12:00', end_time: '22:00', end_next_day: false, source: 'test' },
    lanes: [
      {
        table_id: tableId,
        table_name: 'Table 1',
        capacity: 4,
        area: null,
        bookings: laneBookings,
      },
    ],
    unassigned_bookings: [],
  }
}

// 12:00 to 22:30, matching what buildTimelineRange produces for a 12:00-22:00 service.
const TIMELINE: TimelineRange = {
  startMin: 11 * 60 + 30,
  endMin: 22 * 60 + 30,
  ticks: [],
}

describe('isFohBookingLive', () => {
  it('treats a confirmed booking as holding its table', () => {
    expect(isFohBookingLive(makeBooking(), NOW)).toBe(true)
  })

  it.each(['cancelled', 'no_show'])('does not let a %s booking block', (status) => {
    expect(isFohBookingLive(makeBooking({ status }), NOW)).toBe(false)
  })

  it('releases the table once the party has left, whatever the status says', () => {
    expect(isFohBookingLive(makeBooking({ left_at: '2026-09-01T18:00:00.000Z' }), NOW)).toBe(false)
  })

  it('releases an expired unpaid hold', () => {
    const booking = makeBooking({
      status: 'pending_payment',
      hold_expires_at: '2026-09-01T16:00:00.000Z',
      payment_status: 'pending',
    })
    expect(isFohBookingLive(booking, NOW)).toBe(false)
  })

  it('keeps an expired hold that was actually paid', () => {
    const booking = makeBooking({
      status: 'pending_payment',
      hold_expires_at: '2026-09-01T16:00:00.000Z',
      payment_status: 'completed',
    })
    expect(isFohBookingLive(booking, NOW)).toBe(true)
  })

  it('keeps a hold that has not expired yet', () => {
    const booking = makeBooking({
      status: 'pending_payment',
      hold_expires_at: '2026-09-01T18:00:00.000Z',
      payment_status: 'pending',
    })
    expect(isFohBookingLive(booking, NOW)).toBe(true)
  })

  it('ignores hold expiry for a confirmed booking', () => {
    const booking = makeBooking({
      status: 'confirmed',
      hold_expires_at: '2026-09-01T16:00:00.000Z',
      payment_status: 'pending',
    })
    expect(isFohBookingLive(booking, NOW)).toBe(true)
  })
})

describe('collectBusyIntervals', () => {
  const subject = makeBooking()

  it('ignores the booking being moved', () => {
    const schedule = makeSchedule([subject])
    expect(collectBusyIntervals({ schedule, booking: subject, serviceDateIso: SERVICE_DATE, referenceNow: NOW })).toEqual([])
  })

  it('returns nothing for a booking that holds no table', () => {
    const schedule = makeSchedule([subject])
    const outside = makeBooking({ id: 'booking-2', assigned_table_ids: [] })
    expect(collectBusyIntervals({ schedule, booking: outside, serviceDateIso: SERVICE_DATE, referenceNow: NOW })).toEqual([])
  })

  it('only looks at lanes this booking actually sits on', () => {
    const other = makeBooking({ id: 'booking-2', start_datetime: '2026-09-01T19:00:00.000Z', end_datetime: '2026-09-01T20:00:00.000Z' })
    const schedule = makeSchedule([other], 'table-z')
    expect(collectBusyIntervals({ schedule, booking: subject, serviceDateIso: SERVICE_DATE, referenceNow: NOW })).toEqual([])
  })

  it('labels private and communal blocks distinctly from ordinary bookings', () => {
    const schedule = makeSchedule([
      subject,
      makeBooking({ id: 'pb-1', is_private_block: true, start_datetime: '2026-09-01T19:00:00.000Z', end_datetime: '2026-09-01T20:00:00.000Z' }),
      makeBooking({ id: 'communal-1', is_communal_event_block: true, start_datetime: '2026-09-01T20:00:00.000Z', end_datetime: '2026-09-01T21:00:00.000Z' }),
      makeBooking({ id: 'booking-3', start_datetime: '2026-09-01T12:00:00.000Z', end_datetime: '2026-09-01T13:00:00.000Z' }),
    ])
    const reasons = collectBusyIntervals({ schedule, booking: subject, serviceDateIso: SERVICE_DATE, referenceNow: NOW })
      .map((interval) => interval.reason)
      .sort()
    expect(reasons).toEqual(['event', 'private', 'taken'])
  })

  it('drops a departed booking, which no longer holds the table', () => {
    const schedule = makeSchedule([
      subject,
      makeBooking({ id: 'booking-2', left_at: '2026-09-01T18:00:00.000Z', start_datetime: '2026-09-01T19:00:00.000Z', end_datetime: '2026-09-01T20:00:00.000Z' }),
    ])
    expect(collectBusyIntervals({ schedule, booking: subject, serviceDateIso: SERVICE_DATE, referenceNow: NOW })).toEqual([])
  })
})

describe('buildTimeChangeOptions', () => {
  const subject = makeBooking()

  it('always offers the booking its own current time, marked as current', () => {
    const options = buildTimeChangeOptions({
      schedule: makeSchedule([subject]),
      booking: subject,
      timeline: TIMELINE,
      serviceDateIso: SERVICE_DATE,
      referenceNow: NOW,
    })
    const current = options.filter((option) => option.isCurrent)
    expect(current).toHaveLength(1)
    expect(current[0]!.time).toBe('18:00')
    // The current time is shown but never offered as a destination.
    expect(current[0]!.available).toBe(false)
  })

  it('keeps an off-grid current time rather than quietly rounding it', () => {
    // Live data holds times like 20:19 and 20:55.
    const offGrid = makeBooking({
      booking_time: '20:19',
      start_datetime: '2026-09-01T19:19:00.000Z',
      end_datetime: '2026-09-01T20:49:00.000Z',
    })
    const options = buildTimeChangeOptions({
      schedule: makeSchedule([offGrid]),
      booking: offGrid,
      timeline: TIMELINE,
      serviceDateIso: SERVICE_DATE,
      referenceNow: NOW,
    })
    expect(options.find((option) => option.isCurrent)?.time).toBe('20:19')
  })

  it('blocks a slot that would overlap another live booking', () => {
    const schedule = makeSchedule([
      subject,
      // 20:00 to 21:00 London.
      makeBooking({ id: 'booking-2', start_datetime: '2026-09-01T19:00:00.000Z', end_datetime: '2026-09-01T20:00:00.000Z' }),
    ])
    const options = buildTimeChangeOptions({
      schedule, booking: subject, timeline: TIMELINE, serviceDateIso: SERVICE_DATE, referenceNow: NOW,
    })
    const at1930 = options.find((option) => option.time === '19:30')
    expect(at1930?.available).toBe(false)
    expect(at1930?.blockedBy).toBe('taken')
  })

  it('uses half-open overlap, so a slot starting as another ends is free', () => {
    const schedule = makeSchedule([
      subject,
      // Ends at 20:00 London exactly.
      makeBooking({ id: 'booking-2', start_datetime: '2026-09-01T18:00:00.000Z', end_datetime: '2026-09-01T19:00:00.000Z' }),
    ])
    const options = buildTimeChangeOptions({
      schedule, booking: subject, timeline: TIMELINE, serviceDateIso: SERVICE_DATE, referenceNow: NOW,
    })
    expect(options.find((option) => option.time === '20:00')?.available).toBe(true)
    // And the slot immediately before it, which would overlap, is not.
    expect(options.find((option) => option.time === '19:45')?.available).toBe(false)
  })

  it('reports a private block ahead of an ordinary clash on the same slot', () => {
    const schedule = makeSchedule([
      subject,
      makeBooking({ id: 'booking-2', start_datetime: '2026-09-01T19:00:00.000Z', end_datetime: '2026-09-01T20:00:00.000Z' }),
      makeBooking({ id: 'pb-1', is_private_block: true, start_datetime: '2026-09-01T19:00:00.000Z', end_datetime: '2026-09-01T20:00:00.000Z' }),
    ])
    const options = buildTimeChangeOptions({
      schedule, booking: subject, timeline: TIMELINE, serviceDateIso: SERVICE_DATE, referenceNow: NOW,
    })
    expect(options.find((option) => option.time === '20:00')?.blockedBy).toBe('private')
  })

  it('never offers a slot whose booking would run past the end of the timeline', () => {
    const options = buildTimeChangeOptions({
      schedule: makeSchedule([subject]),
      booking: subject,
      timeline: TIMELINE,
      serviceDateIso: SERVICE_DATE,
      referenceNow: NOW,
    })
    // 90-minute booking against a 22:30 timeline end, so 21:00 is the last start offered.
    const latest = options.filter((option) => !option.isCurrent).at(-1)
    expect(latest?.time).toBe('21:00')
  })

  it('offers every slot to a booking that holds no table', () => {
    const outside = makeBooking({ id: 'outside-1', assigned_table_ids: [], is_outside_seating: true })
    const schedule = makeSchedule([
      makeBooking({ id: 'booking-2', start_datetime: '2026-09-01T19:00:00.000Z', end_datetime: '2026-09-01T20:00:00.000Z' }),
    ])
    const options = buildTimeChangeOptions({
      schedule, booking: outside, timeline: TIMELINE, serviceDateIso: SERVICE_DATE, referenceNow: NOW,
    })
    expect(options.every((option) => option.available || option.isCurrent)).toBe(true)
  })
})

describe('getFohTimeChangeBlocker', () => {
  it('allows a plain confirmed booking', () => {
    expect(getFohTimeChangeBlocker(makeBooking())).toBeNull()
  })

  it('allows a seated booking, which is warned about rather than blocked', () => {
    expect(getFohTimeChangeBlocker(makeBooking({ seated_at: '2026-09-01T17:05:00.000Z' }))).toBeNull()
  })

  it.each(['cancelled', 'no_show', 'completed'])('blocks a %s booking', (status) => {
    expect(getFohTimeChangeBlocker(makeBooking({ status }))).toBe('This booking is closed.')
  })

  it('blocks a booking whose party has left', () => {
    expect(getFohTimeChangeBlocker(makeBooking({ left_at: '2026-09-01T19:00:00.000Z' })))
      .toBe('This party has already left.')
  })

  it('blocks an event booking, which the schedule marks by purpose', () => {
    expect(getFohTimeChangeBlocker(makeBooking({ booking_purpose: 'event' })))
      .toMatch(/event/i)
  })

  it('blocks a private-hire block', () => {
    expect(getFohTimeChangeBlocker(makeBooking({ is_private_block: true })))
      .toMatch(/private booking/i)
  })
})

describe('formatMinutesAsClock', () => {
  it('formats a normal time', () => {
    expect(formatMinutesAsClock(18 * 60 + 30)).toBe('18:30')
  })

  it('wraps past midnight for a late service window', () => {
    expect(formatMinutesAsClock(24 * 60 + 30)).toBe('00:30')
  })
})
