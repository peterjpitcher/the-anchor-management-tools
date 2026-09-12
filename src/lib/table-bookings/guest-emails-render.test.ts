import { describe, expect, it } from 'vitest'

import {
  buildTableBookingConfirmedEmail,
  buildTableBookingDepositAtBookingEmail,
  buildTableBookingDepositRequestEmail,
  buildTableBookingPreorderReminderEmail,
  buildTableBookingRescheduledEmail,
} from './guest-emails'
import { assertCleanRender, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'

/**
 * Fixture renders of the table booking emails the 11 September review found wrong.
 *
 * Every case runs in both zones (`npm test` pins Europe/London, `npm run test:utc` runs UTC,
 * which is what the serverless runtime uses), and `assertCleanRender` fails the render on
 * undefined, Invalid Date, NaN, a zero amount, a stray dash, a missing phone number or a missing
 * sign-off. The dates are picked to cover British Summer Time, GMT and a booking either side of
 * midnight, because a booking date read in the wrong zone lands on the wrong day for exactly
 * those cases.
 */

const CASES: Array<{ label: string; bookingDate: string; bookingTime: string; time: string }> = [
  { label: 'British Summer Time', bookingDate: '2026-07-11', bookingTime: '19:30:00', time: '7:30pm' },
  { label: 'GMT', bookingDate: '2026-12-05', bookingTime: '19:00:00', time: '7pm' },
  { label: 'just before midnight, GMT', bookingDate: '2026-12-05', bookingTime: '23:45:00', time: '11:45pm' },
  { label: 'just after midnight, BST', bookingDate: '2026-07-11', bookingTime: '00:15:00', time: '12:15am' },
]

const BASE = {
  firstName: 'Alex',
  bookingReference: 'TB-RENDER',
  partySize: 16,
}

describe('table booking confirmation email renders', () => {
  it.each(CASES)('$label: $bookingDate at $bookingTime', ({ bookingDate, bookingTime, time }) => {
    const email = buildTableBookingConfirmedEmail({
      ...BASE,
      bookingDate,
      bookingTime,
      manageLink: 'https://l.the-anchor.pub/m1',
      highChairCount: 2,
    })

    assertCleanRender(email)
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain(`Time: ${time}`)
    expect(email.text).toContain('Party size: 16 people')
    expect(email.text).toContain('High chair reserved: x2')
    expect(email.text).toContain('Manage your booking: https://l.the-anchor.pub/m1')
    // The year is in the date, and no detail row is ever rendered as a fallback phrase.
    expect(email.text).toContain(bookingDate.slice(0, 4))
    expect(email.text).not.toContain('your booking time')
    // Branded, not a bare fragment: one 600px container and a preheader.
    expect(email.html).toContain('max-width:600px')
    expect(email.html).toContain('display:none')
  })

  it('tells a seasonal booking to choose its food, with the deadline SSOT section 16 states', () => {
    const email = buildTableBookingConfirmedEmail({
      ...BASE,
      partySize: 6,
      bookingDate: '2026-12-05',
      bookingTime: '19:00:00',
      manageLink: 'https://l.the-anchor.pub/food1',
      needsFoodChoices: true,
      christmasCourseCounts: [1, 2, 3, 3, 3, 3],
      preorderCutoffDays: 7,
      preorderClosesAtIso: '2026-11-28T12:00:00.000Z',
      christmasCourseSummary: 'Christmas courses: 1 x 1 course, 1 x 2 courses, 4 x 3 courses.',
    })

    assertCleanRender(email)
    expect(email.text).toContain("We need everyone's food choices before your booking.")
    expect(email.text).toContain('Every guest on three courses needs a starter, a main and a dessert chosen.')
    expect(email.text).toContain('Every guest on two courses needs a main and one other course chosen.')
    expect(email.text).toContain("Two and three courses need everyone's choices 7 days before your booking.")
    expect(email.text).toContain('For this booking that is Saturday 28 November 2026 at 12pm.')
    // The button is named for the job, as the text is.
    expect(email.text).toContain('Choose your food: https://l.the-anchor.pub/food1')
  })

  it('does not ask a party who all took one course to choose anything', () => {
    const email = buildTableBookingConfirmedEmail({
      ...BASE,
      partySize: 4,
      bookingDate: '2026-12-05',
      bookingTime: '19:00:00',
      manageLink: 'https://l.the-anchor.pub/m1',
      needsFoodChoices: true,
      christmasCourseCounts: [1, 1, 1, 1],
      preorderCutoffDays: 7,
    })

    assertCleanRender(email)
    expect(email.text).not.toContain('Choose your food')
    expect(email.text).toContain('Manage your booking: https://l.the-anchor.pub/m1')
  })
})

describe('deposit request email renders', () => {
  it.each(CASES)('$label: $bookingDate at $bookingTime', ({ bookingDate, bookingTime, time }) => {
    const email = buildTableBookingDepositAtBookingEmail({
      ...BASE,
      bookingDate,
      bookingTime,
      depositKindLabel: 'table deposit',
      depositLabel: '£160.00',
      breakdownNote: ' (16 x GBP 10)',
      paymentLink: 'https://l.the-anchor.pub/pay1',
      perPersonGbp: 10,
      refundCutoffDays: null,
      // A hold that runs out fifteen minutes before midnight on the day it was taken.
      payByIso: '2026-06-30T22:45:00.000Z',
    })

    assertCleanRender(email)
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain(`Time: ${time}`)
    expect(email.text).toContain('Deposit: £160.00')
    // The word, not just the amount.
    expect(email.text).toContain('please pay your table deposit of £160.00 (16 x GBP 10)')
    // SSOT section 16, "Group deposit", verbatim.
    expect(email.text).toContain('Groups of 15 or more: a £10 per person deposit, fully deducted from your bill.')
    expect(email.text).toContain('which is when the hold on your table runs out')
    // The sliding bands refunds.ts actually applies.
    expect(email.text).toContain('Cancel 7 or more days before and the deposit is refunded in full.')
    expect(email.text).toContain('Between 3 and 6 days before, half of it comes back.')
    expect(email.text).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
  })

  it('uses the Christmas wording and the seasonal cutoff for a Christmas booking', () => {
    const email = buildTableBookingDepositAtBookingEmail({
      ...BASE,
      partySize: 6,
      bookingDate: '2026-12-05',
      bookingTime: '19:00:00',
      depositKindLabel: 'Christmas deposit',
      depositLabel: '£60.00',
      breakdownNote: ' (6 x GBP 10)',
      paymentLink: 'https://l.the-anchor.pub/pay1',
      isChristmas: true,
      perPersonGbp: 10,
      refundCutoffDays: 7,
      payByIso: '2026-11-20T18:00:00.000Z',
    })

    assertCleanRender(email)
    // SSOT section 16, "Christmas 2026".
    expect(email.text).toContain("There's a £10 per person deposit, which comes off your bill.")
    // SSOT section 7: full refund up to and including seven days before, nothing inside.
    expect(email.text).toContain(
      'Cancel up to and including 7 days before your booking date and the deposit is refunded in full.'
    )
    expect(email.text).toContain('Fewer than 7 days before, it is not refunded.')
    expect(email.text).not.toContain('half of it comes back')
  })

  it('says nothing about days when a seasonal booking carries no readable cutoff', () => {
    const email = buildTableBookingDepositRequestEmail({
      ...BASE,
      bookingDate: '2026-12-05',
      bookingTime: '19:00:00',
      depositKindLabel: 'Christmas deposit',
      depositLabel: '£160.00',
      breakdownNote: ' (16 x GBP 10)',
      paymentLink: 'https://l.the-anchor.pub/pay1',
      isChristmas: true,
      perPersonGbp: 10,
      refundCutoffDays: null,
      payByIso: '2026-11-20T18:00:00.000Z',
    })

    assertCleanRender(email)
    expect(email.text).not.toContain('refunded in full')
    expect(email.text).not.toContain('not refunded')
  })
})

describe('booking amended email renders', () => {
  it.each(CASES)('$label: $bookingDate at $bookingTime', ({ bookingDate, bookingTime, time }) => {
    const email = buildTableBookingRescheduledEmail({
      ...BASE,
      bookingDate,
      bookingTime,
      status: 'confirmed',
      manageLink: 'https://l.the-anchor.pub/m1',
      previousStartDateTime: '2026-07-04T17:00:00.000Z',
      previousPartySize: 12,
    })

    assertCleanRender(email)
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain(`Time: ${time}`)
    // What it was, as well as what it is now.
    expect(email.text).toContain('It was Saturday 4 July 2026 at 6pm, 12 people.')
    expect(email.text).toContain('is still confirmed')
  })

  it('never says "still confirmed" while a deposit is still owed', () => {
    const email = buildTableBookingRescheduledEmail({
      ...BASE,
      bookingDate: '2026-12-05',
      bookingTime: '19:00:00',
      status: 'pending_payment',
      manageLink: 'https://l.the-anchor.pub/m1',
      previousStartDateTime: '2026-12-05T17:00:00.000Z',
      deposit: {
        depositLabel: '£160.00',
        paymentLink: 'https://l.the-anchor.pub/pay1',
        isChristmas: false,
        perPersonGbp: 10,
        refundCutoffDays: null,
        payByIso: '2026-11-20T18:00:00.000Z',
      },
    })

    assertCleanRender(email)
    expect(email.text).not.toContain('still confirmed')
    expect(email.text).toContain('is not confirmed yet: we still need your deposit of £160.00')
    expect(email.text).toContain('Groups of 15 or more: a £10 per person deposit, fully deducted from your bill.')
    expect(email.text).toContain('which is when the hold on your table runs out')
    expect(email.text).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
  })
})

describe('pre-order chase email renders', () => {
  it.each(CASES)('$label: $bookingDate at $bookingTime', ({ bookingDate, bookingTime, time }) => {
    const email = buildTableBookingPreorderReminderEmail({
      ...BASE,
      partySize: 6,
      bookingDate,
      bookingTime,
      manageLink: 'https://l.the-anchor.pub/food1',
      periodName: 'Christmas 2026',
      courseCounts: [2, 2, 3, 3, 1, 1],
      preorderCutoffDays: 7,
      preorderClosesAtIso: '2026-11-28T12:00:00.000Z',
    })

    assertCleanRender(email)
    expect(email.subject).toBe(`Christmas 2026 food choices for ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).toContain(`Time: ${time}`)
    expect(email.text).not.toContain('A starter and a dessert are optional')
    expect(email.text).toContain("Two and three courses need everyone's choices 7 days before your booking.")
  })
})
