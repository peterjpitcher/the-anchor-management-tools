import { describe, expect, it } from 'vitest'
import { buildTableBookingDepositRequestEmail, buildTableBookingRescheduledEmail } from './guest-emails'
import { buildPartySizeDepositText, describePartySizeDeposit } from './guest-texts'
import { assertCleanRender, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'

/**
 * Owner decision D20 (BK-044): a confirmed party that grows to 15 or more stays confirmed with the
 * deposit owed. Its deposit request must never say the deposit "secures" a table it already has,
 * or that a hold runs out, because nothing cancels the booking any more. Fixture renders in both
 * zones, failing on undefined, Invalid Date, NaN or a zero amount.
 */

const CASES = [
  { label: 'GMT', bookingDate: '2026-12-05', bookingTime: '19:00:00' },
  { label: 'British Summer Time', bookingDate: '2026-07-11', bookingTime: '19:30:00' },
]

describe('the deposit request for a booking that stays confirmed', () => {
  it.each(CASES)('$label: says the table is still booked and the deposit is to pay before the visit', ({ bookingDate, bookingTime }) => {
    const email = buildTableBookingDepositRequestEmail({
      firstName: 'Alex',
      bookingReference: 'TB-GROWN',
      bookingDate,
      bookingTime,
      partySize: 16,
      depositKindLabel: 'table deposit',
      depositLabel: '£160.00',
      breakdownNote: ' (16 x GBP 10)',
      paymentLink: 'https://l.the-anchor.pub/pay1',
      payByIso: null,
      stillBooked: true,
      isChristmas: false,
      perPersonGbp: 10,
      refundCutoffDays: null,
    })

    assertCleanRender(email)
    expect(email.subject).toBe('Your booking at The Anchor now has a deposit to pay')
    expect(email.text).toContain(
      "Hi Alex, your party size has been updated to 16 people. Your table is still booked. There's now a table deposit of £160.00 (16 x GBP 10) to pay."
    )
    expect(email.text).toContain('Your table stays booked. Please pay the deposit before your visit.')
    expect(email.text).toContain(`Date: ${expectedLongDate(bookingDate)}`)
    expect(email.text).not.toContain('secure')
    expect(email.text).not.toContain('hold')
    expect(email.text).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
  })

  it('keeps the old wording for a booking that is waiting for its deposit', () => {
    const email = buildTableBookingDepositRequestEmail({
      firstName: 'Alex',
      bookingReference: 'TB-NEW',
      bookingDate: '2026-12-05',
      bookingTime: '19:00:00',
      partySize: 16,
      depositKindLabel: 'table deposit',
      depositLabel: '£160.00',
      breakdownNote: ' (16 x GBP 10)',
      paymentLink: 'https://l.the-anchor.pub/pay1',
      payByIso: '2026-11-20T18:00:00.000Z',
    })

    assertCleanRender(email)
    expect(email.subject).toBe('Pay your deposit to secure your booking at The Anchor')
    expect(email.text).toContain('which is when the hold on your table runs out')
  })

  it('texts the same facts without a deadline', () => {
    const text = buildPartySizeDepositText({
      firstName: 'Alex',
      wording: describePartySizeDeposit({ newPartySize: 16, depositAmount: 160, isChristmas: false, bookingType: 'regular' }),
      paymentUrl: 'https://l.the-anchor.pub/pay1',
      stillBooked: true,
    })

    expect(text).toContain(
      "The Anchor: Hi Alex, your party size has been updated to 16 people. Your table is still booked. There's now a table deposit of £160.00 (16 x GBP 10) to pay before your visit. Pay here: https://l.the-anchor.pub/pay1"
    )
    expect(text).not.toMatch(/undefined|NaN|Invalid Date|secure/)
  })
})

describe('the amended notice for a confirmed booking that owes a deposit', () => {
  it.each(CASES)('$label: still confirmed, with the deposit still to pay', ({ bookingDate, bookingTime }) => {
    const email = buildTableBookingRescheduledEmail({
      firstName: 'Alex',
      bookingReference: 'TB-GROWN',
      bookingDate,
      bookingTime,
      partySize: 16,
      status: 'confirmed',
      previousPartySize: 12,
      manageLink: 'https://l.the-anchor.pub/m1',
      deposit: {
        depositLabel: '£160.00',
        paymentLink: 'https://l.the-anchor.pub/pay1',
        isChristmas: false,
        perPersonGbp: 10,
        refundCutoffDays: null,
        payByIso: null,
        stillBooked: true,
      },
    })

    assertCleanRender(email)
    expect(email.text).toContain('Your table booking is still confirmed.')
    expect(email.text).toContain('Your deposit of £160.00 is still to pay.')
    expect(email.text).toContain('Your table stays booked. Please pay the deposit before your visit.')
    expect(email.text).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
    expect(email.text).not.toContain('not confirmed')
  })
})

// Owner requirement, 26 November 2026: 12 seats, 9 Christmas dinners, GBP 90.
describe('the deposit request after staff convert a booking to Christmas dinner for some seats', () => {
  it.each(CASES)('$label: names the seats and the diners, GBP 90, and no party-size change', ({ bookingDate, bookingTime }) => {
    const wording = describePartySizeDeposit({
      newPartySize: 12,
      depositAmount: 90,
      isChristmas: true,
      bookingType: 'christmas',
      christmasDiners: 9,
    })
    const email = buildTableBookingDepositRequestEmail({
      firstName: 'Sam',
      bookingReference: 'TB-XMAS9',
      bookingDate,
      bookingTime,
      partySize: 12,
      depositKindLabel: wording.depositKindLabel,
      depositLabel: wording.depositLabel,
      breakdownNote: wording.breakdownNote,
      paymentLink: 'https://l.the-anchor.pub/pay9',
      payByIso: null,
      stillBooked: true,
      isChristmas: true,
      perPersonGbp: 10,
      refundCutoffDays: 7,
      depositRule: 'period',
      christmasDiners: 9,
    })

    assertCleanRender(email)
    expect(email.subject).toBe('Your Christmas dinner at The Anchor: a deposit to pay')
    expect(email.text).toContain('with 9 of you having it')
    expect(email.text).toContain("There's now a Christmas deposit of £90.00 (9 x GBP 10) to pay.")
    expect(email.text).toContain("There's a £10 deposit for each Christmas dinner, which comes off your bill.")
    expect(email.text).toContain('Your table stays booked.')
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/undefined|NaN|Invalid Date|£7\.50|party size has been updated|£120/)
    }
  })

  it('names the seats when the group rule on 20 seats asks for more than 9 dinners', () => {
    const wording = describePartySizeDeposit({
      newPartySize: 20,
      depositAmount: 200,
      isChristmas: true,
      bookingType: 'christmas',
      christmasDiners: 9,
    })
    expect(wording.breakdownNote).toBe(' (20 x GBP 10)')
    expect(wording.christmasDiners).toBe(9)
  })

  it('reads as the ordinary request when every seat is having Christmas dinner', () => {
    const wording = describePartySizeDeposit({
      newPartySize: 12,
      depositAmount: 120,
      isChristmas: true,
      bookingType: 'christmas',
      christmasDiners: 12,
    })
    expect(wording.christmasDiners).toBeUndefined()
    expect(wording.breakdownNote).toBe(' (12 x GBP 10)')
  })
})
