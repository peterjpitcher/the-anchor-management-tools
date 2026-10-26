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
