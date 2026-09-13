import { describe, expect, it } from 'vitest'
import {
  bookingCalendarInviteSequence,
  generateBookingCalendarInvite,
} from '@/lib/email/calendar-invite'

/**
 * The .ics a private booking guest is sent.
 *
 * This suite runs twice, under TEST_TZ=Europe/London (npm test) and TEST_TZ=UTC (npm run
 * test:utc), which is what the serverless runtime actually runs in. The default end time used to
 * differ between the two across the October clock change (review PB-12), so every instant here is
 * asserted, not just the shape of the file.
 */

const BOOKING_ID = '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b'
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`)

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    event_date: '2026-10-03',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    event_type: 'Birthday party',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    guest_count: 40,
    status: 'confirmed',
    date_tbd: false,
    internal_notes: null,
    ...overrides,
  }
}

/** The unfolded content lines, so an assertion reads the value rather than the wrapping. */
function lines(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n')
}

function valueOf(ics: string, name: string): string | undefined {
  const line = lines(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))
  return line?.slice(line.indexOf(':') + 1)
}

describe('private booking calendar invite', () => {
  it('sends nothing for a booking whose date is still to be confirmed', () => {
    // event_date holds the placeholder the booking was created with, so an invite would put a real
    // event in the guest's diary on the day they enquired (review PB-1).
    expect(generateBookingCalendarInvite(booking({ date_tbd: true }))).toBeNull()
    expect(
      generateBookingCalendarInvite(booking({ date_tbd: false, internal_notes: 'Event date/time to be confirmed' }))
    ).toBeNull()
    expect(generateBookingCalendarInvite(booking({ event_date: '' }))).toBeNull()
  })

  it('is a calendar entry to add, not a meeting request to answer', () => {
    const ics = generateBookingCalendarInvite(booking()) as string
    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).not.toContain('METHOD:REQUEST')
    expect(ics).not.toContain('ATTENDEE')
  })

  it('names the one address that reaches a person', () => {
    const ics = generateBookingCalendarInvite(booking()) as string
    expect(ics).toContain('mailto:manager@the-anchor.pub')
    expect(ics).not.toContain('events@the-anchor.pub')
    expect(valueOf(ics, 'DESCRIPTION')).toContain('manager@the-anchor.pub')
  })

  it('carries the Europe/London rules with it', () => {
    const ics = generateBookingCalendarInvite(booking()) as string
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:Europe/London')
    expect(ics).toContain('TZNAME:BST')
    expect(ics).toContain('TZNAME:GMT')
  })

  it('folds every line to 75 octets', () => {
    const ics = generateBookingCalendarInvite(
      booking({ event_type: 'Fiftieth birthday party with a live band, a buffet and a late bar' })
    ) as string
    for (const line of ics.split('\r\n')) {
      expect(Buffer.from(line, 'utf-8').length).toBeLessThanOrEqual(75)
    }
    // Folding is only wrapping: the value still reads whole.
    expect(valueOf(ics, 'SUMMARY')).toContain('Fiftieth birthday party with a live band')
  })

  it('states the booked times as London wall-clock values', () => {
    const ics = generateBookingCalendarInvite(booking()) as string
    expect(ics).toContain('DTSTART;TZID=Europe/London:20261003T190000')
    expect(ics).toContain('DTEND;TZID=Europe/London:20261003T233000')
  })

  it('rolls an overnight end time into the next day', () => {
    const ics = generateBookingCalendarInvite(
      booking({ event_date: '2026-12-05', start_time: '19:30:00', end_time: '00:30:00', end_time_next_day: true })
    ) as string
    expect(ics).toContain('DTSTART;TZID=Europe/London:20261205T193000')
    expect(ics).toContain('DTEND;TZID=Europe/London:20261206T003000')
  })

  it('works out the default end on the London clock, whatever zone the server runs in', () => {
    // 25 October 2026 is the day the clocks go back. Adding three hours of elapsed time to a
    // host-local Date ended this at 02:30 under one zone and 03:30 under the other.
    const ics = generateBookingCalendarInvite(
      booking({ event_date: '2026-10-25', start_time: '00:30:00', end_time: null })
    ) as string
    expect(ics).toContain('DTSTART;TZID=Europe/London:20261025T003000')
    expect(ics).toContain('DTEND;TZID=Europe/London:20261025T033000')
  })

  it('rolls the default end past midnight into the next day', () => {
    const ics = generateBookingCalendarInvite(
      booking({ event_date: '2026-10-17', start_time: '23:30:00', end_time: null })
    ) as string
    expect(ics).toContain('DTSTART;TZID=Europe/London:20261017T233000')
    expect(ics).toContain('DTEND;TZID=Europe/London:20261018T023000')
  })

  it('books the whole day rather than inventing a lunchtime when no time is set', () => {
    // The booking form allows a date without a time, and 12:00 to 15:00 was invented for it
    // (review PB-21).
    const ics = generateBookingCalendarInvite(booking({ start_time: null, end_time: null })) as string
    expect(ics).toContain('DTSTART;VALUE=DATE:20261003')
    expect(ics).toContain('DTEND;VALUE=DATE:20261004')
    expect(ics).not.toContain('T120000')
  })

  it('is tentative while the booking is only a provisional hold', () => {
    expect(generateBookingCalendarInvite(booking({ status: 'draft' }))).toContain('STATUS:TENTATIVE')
    expect(generateBookingCalendarInvite(booking({ status: 'confirmed' }))).toContain('STATUS:CONFIRMED')
  })

  it('can cancel the entry it created', () => {
    const ics = generateBookingCalendarInvite(booking(), { method: 'CANCEL', sequence: 7 }) as string
    expect(ics).toContain('METHOD:CANCEL')
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics).toContain('SEQUENCE:7')
    // The same UID, or the client has nothing to cancel.
    expect(ics).toContain(`UID:booking-${BOOKING_ID}@the-anchor`)
  })

  it('counts one guest as a guest', () => {
    expect(valueOf(generateBookingCalendarInvite(booking({ guest_count: 1 })) as string, 'DESCRIPTION')).toContain('1 guest on')
    expect(valueOf(generateBookingCalendarInvite(booking({ guest_count: 2 })) as string, 'DESCRIPTION')).toContain('2 guests on')
  })

  it('prints the date with its weekday, in London', () => {
    const description = valueOf(generateBookingCalendarInvite(booking()) as string, 'DESCRIPTION') as string
    expect(description).toContain('Saturday')
    expect(description).toContain('3 October 2026')
  })

  it('carries no banned dash and no broken value', () => {
    for (const overrides of [{}, { start_time: null, end_time: null }, { guest_count: null }, { event_type: null }]) {
      const ics = generateBookingCalendarInvite(booking(overrides)) as string
      expect(ics).not.toMatch(DASHES)
      expect(ics).not.toMatch(/undefined|Invalid Date|NaN|null/)
    }
  })

  it('escapes the characters a customer can type into the event type', () => {
    const ics = generateBookingCalendarInvite(booking({ event_type: 'Party; drinks, cake' })) as string
    expect(valueOf(ics, 'SUMMARY')).toContain('Party\\; drinks\\, cake')
  })

  it('raises the sequence every time the booking is saved', () => {
    const first = bookingCalendarInviteSequence('2026-09-12T10:00:00.000Z')
    const later = bookingCalendarInviteSequence('2026-09-12T10:05:00.000Z')
    expect(later).toBeGreaterThan(first)
    expect(bookingCalendarInviteSequence(null)).toBe(0)
    expect(bookingCalendarInviteSequence('not a date')).toBe(0)
  })
})
