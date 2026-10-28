import { describe, expect, it } from 'vitest'
import {
  buildEventReminderEmailLines,
  buildEventReminderSms,
  formatReminderPrice,
  type EventReminderInput,
} from '@/lib/events/event-reminder-message'
import { countSmsSegments, normaliseToGsm7 } from '@/lib/sms/gsm7'

/**
 * The day-before event reminder follows the night (BK-086): seats only when a table is held,
 * places on shared seating, tickets for standing, and the cash price on pay-on-the-night events.
 * Every fixture is rendered and checked for the values that have reached guests before.
 */

const BAD_VALUES = /undefined|null|NaN|Invalid Date|£0(?![.\d])|£0\.00/
// What a shortened manage link adds to the text.
const LINK_PART = ' Change: https://l.the-anchor.pub/abc123'

const base: EventReminderInput = {
  firstName: 'Sam',
  eventName: 'Quiz Night',
  eventDateText: 'Wed 16 Sept, 7:30 pm',
  reminderDay: 'tomorrow',
  seats: 2,
  bookingMode: 'table',
  seatingType: 'seated',
  paymentMode: 'free',
  doorPricePerSeat: 0,
  doorsTime: null,
  eventStartIso: '2026-09-16T18:30:00Z',
}

const fixtures: Array<[string, EventReminderInput, string]> = [
  [
    'table night',
    base,
    'The Anchor: Sam, Quiz Night is tomorrow, Wed 16 Sept, 7:30 pm. Your 2 seats are ready. Come a bit early tomorrow if you fancy a drink.',
  ],
  [
    'shared seating, pay cash on the night, with an arrival time',
    {
      ...base,
      eventName: 'Music Bingo',
      bookingMode: 'communal',
      paymentMode: 'cash_only',
      doorPricePerSeat: 5,
      doorsTime: '19:00:00',
    },
    'The Anchor: Sam, Music Bingo is tomorrow, Wed 16 Sept, 7:30 pm. Your 2 places are booked. Seating is shared on the night. Bring cash: £5 each. Arrive from 7pm for a 7:30pm start.',
  ],
  [
    'standing tickets',
    { ...base, eventName: 'Live Music', bookingMode: 'mixed', seatingType: 'standing', seats: 3 },
    'The Anchor: Sam, Live Music is tomorrow, Wed 16 Sept, 7:30 pm. Your 3 standing tickets are booked. Come a bit early tomorrow if you fancy a drink.',
  ],
  [
    'general admission, one place, on the day, cash with pence',
    { ...base, bookingMode: 'general', seats: 1, reminderDay: 'today', paymentMode: 'cash_only', doorPricePerSeat: 7.5 },
    'The Anchor: Sam, Quiz Night is today, Wed 16 Sept, 7:30 pm. Your place is booked. Bring cash: £7.50 each. Come a bit early if you fancy a drink.',
  ],
  [
    'cash only with no price on the record',
    { ...base, paymentMode: 'cash_only', doorPricePerSeat: 0 },
    'The Anchor: Sam, Quiz Night is tomorrow, Wed 16 Sept, 7:30 pm. Your 2 seats are ready. Bring cash to pay on the night. Come a bit early tomorrow if you fancy a drink.',
  ],
  [
    'no booking mode on the record reads as a table night',
    { ...base, bookingMode: null, seatingType: null, seats: 1 },
    'The Anchor: Sam, Quiz Night is tomorrow, Wed 16 Sept, 7:30 pm. Your seat is ready. Come a bit early tomorrow if you fancy a drink.',
  ],
]

describe('day-before reminder text', () => {
  it.each(fixtures)('%s', (_label, input, expected) => {
    const body = buildEventReminderSms(input)
    expect(body).toBe(expected)
    expect(body).not.toMatch(BAD_VALUES)
    // GSM-7 already: normalising changes nothing, so no curly quote doubles the cost.
    expect(normaliseToGsm7(body + LINK_PART)).toBe(body + LINK_PART)
    expect(countSmsSegments(body + LINK_PART)).toBeLessThanOrEqual(2)
  })

  it('never says seats on a shared-seating night', () => {
    expect(buildEventReminderSms({ ...base, bookingMode: 'communal' })).not.toMatch(/seats? (is|are) ready/)
  })

  it('stays within two segments for a long event name', () => {
    const body = buildEventReminderSms({
      ...base,
      eventName: 'Tinsel and Tipples Christmas Cocktail Masterclass',
      bookingMode: 'communal',
      paymentMode: 'cash_only',
      doorPricePerSeat: 12.5,
      doorsTime: '18:30:00',
    })
    expect(countSmsSegments(body + LINK_PART)).toBeLessThanOrEqual(2)
  })
})

describe('day-before reminder email lines', () => {
  it.each(fixtures)('%s', (_label, input) => {
    const lines = buildEventReminderEmailLines({ ...input, eventDateText: 'Wednesday 16 September 2026 at 7:30pm' })
    expect(lines[0]).toBe(`Just a reminder that ${input.eventName} is ${input.reminderDay}, Wednesday 16 September 2026 at 7:30pm.`)
    for (const line of lines) expect(line).not.toMatch(BAD_VALUES)
  })

  it('tells a pay-on-the-night guest to bring cash and when to arrive', () => {
    const lines = buildEventReminderEmailLines({
      ...base,
      bookingMode: 'communal',
      paymentMode: 'cash_only',
      doorPricePerSeat: 5,
      doorsTime: '19:00',
    })
    expect(lines).toEqual(expect.arrayContaining([
      'Your 2 places are booked. Seating is shared on the night.',
      'Bring cash: £5 each.',
      'Arrive from 7pm for a 7:30pm start.',
    ]))
  })
})

describe('formatReminderPrice', () => {
  it('drops pence on whole pounds and keeps them otherwise', () => {
    expect(formatReminderPrice(5)).toBe('£5')
    expect(formatReminderPrice(7.5)).toBe('£7.50')
    expect(formatReminderPrice(0)).toBeNull()
    expect(formatReminderPrice(Number.NaN)).toBeNull()
    expect(formatReminderPrice(null)).toBeNull()
  })
})
