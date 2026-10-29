import { describe, expect, it } from 'vitest'
import { assertCleanGsmText } from '../../mocks/emailRenderChecks'
import { houseStyleErrors } from '@/lib/copy/house-style'
import {
  buildEventBookingCancelledText,
  buildEventBookingConfirmedText,
  buildEventBookingHeldText,
  buildEventGuestDetailsReminderText,
  buildEventHoldReleasedText,
  buildEventPaymentConfirmedText,
  buildEventPaymentManualReviewText,
  buildEventPaymentReminderText,
  buildEventReviewAskText,
  buildEventSeatUpdateText,
  describeEventPlaces,
  formatEventTextWhen,
} from '@/lib/events/event-guest-texts'

/**
 * Every event text rendered with fixture bookings (BK-221): free, cash on the night, prepaid,
 * comped (paid at zero), standing, shared seating and multi-ticket. Runs in the London and the
 * UTC suite, so the date is worked out in London whatever zone the server is in. Each text must
 * pass the broken-value checks, stay in GSM-7 and carry none of the casual wording the owner ruled
 * out for booking and money messages (BK-171, owner decision D15).
 */

const LINK = 'https://l.the-anchor.pub/abc123'
// 19:00 London on Saturday 21 November 2026 (GMT), and 19:30 London on 16 September (BST).
const WINTER_START = '2026-11-21T19:00:00.000Z'
const SUMMER_START = '2026-09-16T18:30:00.000Z'
const BANNED = /nice one|locked in|you're in\b|belter|quick nudge|see you (there|then)!|sorted/i

function assertGuestText(body: string, maxSegments = 2): void {
  assertCleanGsmText(body)
  expect(body).not.toMatch(BANNED)
  expect(houseStyleErrors(body)).toEqual([])
  // GSM-7 multipart texts carry 153 characters a segment. The link is shortened at send time, so
  // measuring with a short link is the real length.
  expect(Math.ceil(body.length / 153)).toBeLessThanOrEqual(maxSegments)
}

describe('event text dates', () => {
  it('works the date out in London, either side of the clocks', () => {
    expect(formatEventTextWhen(WINTER_START)).toBe('Sat 21 Nov at 7pm')
    expect(formatEventTextWhen(SUMMER_START)).toBe('Wed 16 Sep at 7:30pm')
  })

  it('gives no stand-in when the date is missing', () => {
    expect(formatEventTextWhen(null)).toBeNull()
    expect(buildEventBookingConfirmedText({ firstName: 'Pat', eventName: 'Quiz Night', when: null, seats: 2 }))
      .toBe("The Anchor: Hi Pat, you're booked in for Quiz Night, 2 seats.")
  })
})

describe('what a booked place is called', () => {
  it.each([
    [{ seats: 1 }, '1 seat'],
    [{ seats: 4 }, '4 seats'],
    [{ seats: 2, seatingType: 'standing' }, '2 standing tickets'],
    [{ seats: 1, seatingType: 'standing' }, '1 standing ticket'],
    [{ seats: 3, bookingMode: 'communal' }, '3 places'],
    [{ seats: 1, bookingMode: 'general' }, '1 place'],
    [{ seats: 0 }, '1 seat'],
  ])('%o is %s', (input, expected) => {
    expect(describeEventPlaces(input)).toBe(expected)
  })
})

describe.each([
  { name: 'free', when: formatEventTextWhen(WINTER_START), seats: 2, seatingType: null, bookingMode: 'table' },
  { name: 'cash on the night', when: formatEventTextWhen(SUMMER_START), seats: 4, seatingType: null, bookingMode: 'general' },
  { name: 'standing', when: formatEventTextWhen(WINTER_START), seats: 2, seatingType: 'standing', bookingMode: 'mixed' },
  { name: 'shared seating', when: formatEventTextWhen(SUMMER_START), seats: 6, seatingType: 'seated', bookingMode: 'communal' },
])('a $name booking', ({ when, seats, seatingType, bookingMode }) => {
  const facts = { firstName: 'Pat', eventName: 'Quiz Night', when, seats, seatingType, bookingMode }

  it('is confirmed calmly, with the manage link last', () => {
    const body = buildEventBookingConfirmedText({ ...facts, manageLink: LINK })
    assertGuestText(body)
    expect(body.startsWith("The Anchor: Hi Pat, you're booked in for Quiz Night on ")).toBe(true)
    expect(body.endsWith(`Manage your booking: ${LINK}`)).toBe(true)
    if (bookingMode === 'communal') expect(body).toContain('places')
  })

  it('is held with the time the hold ends and the payment link', () => {
    const body = buildEventBookingHeldText({ ...facts, holdUntil: '7:42pm', paymentLink: LINK, manageLink: null })
    assertGuestText(body)
    expect(body).toContain('until 7:42pm.')
    expect(body).toContain(`Pay here to confirm: ${LINK}`)
  })

  it('says the payment link could not be sent, with the pub number, when it is missing', () => {
    const body = buildEventBookingHeldText({ ...facts, holdUntil: null, paymentLink: null, manageLink: LINK })
    assertGuestText(body)
    expect(body).toContain('call us on 01753 682707')
  })

  it('is released with a way to book again', () => {
    const body = buildEventHoldReleasedText({ ...facts, rebookLink: 'https://www.the-anchor.pub/events/quiz-night' })
    assertGuestText(body)
    expect(body).toContain('To book again: https://www.the-anchor.pub/events/quiz-night')
    expect(buildEventHoldReleasedText({ ...facts, rebookLink: null })).toContain('To book again, call us on 01753 682707.')
  })

  it('is cancelled with its refund note', () => {
    const body = buildEventBookingCancelledText({ ...facts, isReminderOnly: false, refundNote: 'A refund of £20.00 is on its way.' })
    assertGuestText(body)
    expect(body).toContain('has been cancelled')
  })
})

describe('a prepaid booking', () => {
  it('confirms the payment, with the ticket mix for a multi-ticket booking', () => {
    const body = buildEventPaymentConfirmedText({
      firstName: 'Pat', eventName: 'Tasting Night', when: formatEventTextWhen(WINTER_START), seats: 2,
      breakdown: ' (1x Adult, 1x Child)', manageLink: LINK,
    })
    assertGuestText(body)
    expect(body).toBe(`The Anchor: Hi Pat, payment received. Your booking for Tasting Night on Sat 21 Nov at 7pm is confirmed for 2 seats (1x Adult, 1x Child). Manage booking: ${LINK}`)
  })

  it('confirms a comped booking (paid at zero) with no amount at all', () => {
    const body = buildEventPaymentConfirmedText({ firstName: 'Pat', eventName: 'Tasting Night', when: null, seats: 1, manageLink: null })
    assertGuestText(body)
    expect(body).not.toMatch(/£/)
  })

  it('says a person is checking it, and not to pay again', () => {
    const body = buildEventPaymentManualReviewText({ firstName: 'Pat', eventName: 'Tasting Night' })
    assertGuestText(body)
    expect(body).toContain("You don't need to pay again.")
  })

  it('reminds a phone booking to pay, with the deadline', () => {
    const body = buildEventPaymentReminderText({ firstName: 'Pat', eventName: 'Tasting Night', heldUntil: 'Fri 20 Nov at 7pm', paymentLink: LINK })
    assertGuestText(body, 1)
  })
})

describe('the other event texts', () => {
  it('a seat change says from and to', () => {
    const body = buildEventSeatUpdateText({ firstName: 'Pat', eventName: 'Quiz Night', oldSeats: 2, newSeats: 1, manageLink: LINK })
    assertGuestText(body)
    expect(body).toContain('from 2 seats to 1 seat')
  })

  it('a reminder-only entry is removed, not cancelled', () => {
    const body = buildEventBookingCancelledText({ firstName: 'Pat', eventName: 'Quiz Night', when: null, seats: 0, isReminderOnly: true })
    assertGuestText(body)
    expect(body).toContain('has been removed')
  })

  it('the review ask is calm, with no "belter"', () => {
    const body = buildEventReviewAskText({ firstName: 'Sam', eventName: 'Music Bingo', dayText: 'last night', reviewLink: LINK })
    assertGuestText(body)
    expect(body).toBe(`The Anchor: Hi Sam, thanks for coming to Music Bingo last night. If you have 30 seconds, we'd love to know how it went: ${LINK}`)
  })

  it('the guest details reminder says how many tickets need details', () => {
    const one = buildEventGuestDetailsReminderText({ firstName: 'Pat', eventName: 'Tasting Night', when: formatEventTextWhen(WINTER_START), missingCount: 1, detailsLink: LINK })
    const three = buildEventGuestDetailsReminderText({ firstName: 'Pat', eventName: 'Tasting Night', when: null, missingCount: 3, detailsLink: LINK })
    assertGuestText(one)
    assertGuestText(three)
    expect(one).toContain('1 ticket still needs a guest name or answers for Tasting Night on Sat 21 Nov at 7pm')
    expect(three).toContain('3 tickets still need a guest name or answers for Tasting Night.')
  })

  it('"Hi there" stays a greeting when the name is missing, never a bare "there,"', () => {
    const body = buildEventBookingConfirmedText({ firstName: 'there', eventName: 'Quiz Night', when: null, seats: 1 })
    assertGuestText(body)
    expect(body.startsWith('The Anchor: Hi there, ')).toBe(true)
  })
})
