/**
 * The refund email and text a guest actually receives, rendered from fixtures.
 *
 * Runs in both the London suite and the UTC suite, because the booking date is what the guest
 * checks first and a server in UTC used to be the fastest way to print yesterday.
 */

import { describe, expect, it } from 'vitest'
import { buildRefundEmail, buildRefundSmsBody } from '@/lib/refund-notifications'
import { assertCleanRender, assertCleanText, expectedLongDate } from '../mocks/emailRenderChecks'

// British Summer Time, Greenwich Mean Time, and a timestamp whose UTC date and London date
// differ: 24 October 2026 at 23:30Z is 25 October at 00:30 in London, the night the clocks
// go back.
const BST_DATE = '2026-07-04'
const GMT_DATE = '2026-01-17'
const NEAR_MIDNIGHT = '2026-10-24T23:30:00Z'

describe('refund email copy', () => {
  it('names the booking, its date and its reference', () => {
    const email = buildRefundEmail({
      customerName: 'Jane Smith',
      amount: 160,
      context: {
        subject: 'table_booking',
        bookingDate: BST_DATE,
        reference: 'ANC-4821',
      },
    })

    assertCleanRender(email)
    expect(email.subject).toBe('Refund of £160.00 for your table booking')
    expect(email.text).toContain(`your table booking on ${expectedLongDate(BST_DATE)} (ANC-4821)`)
    expect(email.text).toContain('We have refunded £160.00')
  })

  it('says the same timing as the text message, not "5 business days"', () => {
    const context = { subject: 'table_booking' as const, bookingDate: BST_DATE }
    const email = buildRefundEmail({ customerName: 'Jane Smith', amount: 160, context })
    const sms = buildRefundSmsBody({ customerName: 'Jane Smith', amount: 160, context })

    const timing = 'It usually reaches your account in 5 to 10 days, depending on your bank.'
    expect(email.text).toContain(timing)
    expect(sms).toContain(timing)
    expect(email.text).not.toContain('business days')
    expect(email.html).not.toContain('business days')
  })

  it('gives the guest a way to reach us, and signs off as the venue', () => {
    const email = buildRefundEmail({
      customerName: 'Jane Smith',
      amount: 40,
      context: { subject: 'private_booking', bookingDate: GMT_DATE },
    })

    assertCleanRender(email)
    expect(email.text).toContain('01753 682707')
    expect(email.text).toContain('manager@the-anchor.pub')
    expect(email.text.endsWith('The Anchor')).toBe(true)
    // The old version told guests not to hesitate to contact us without saying how.
    expect(email.text).not.toContain('hesitate')
  })

  it('escapes a name that would otherwise land in the markup', () => {
    const email = buildRefundEmail({
      customerName: "Jane <b>O'Brien</b> & Co",
      amount: 10,
      context: { subject: 'table_booking', bookingDate: GMT_DATE },
    })

    expect(email.html).not.toContain('<b>')
    expect(email.html).toContain('Jane')
    assertCleanRender(email)
  })

  it('tells a parking guest their booking is cancelled', () => {
    const context = {
      subject: 'parking' as const,
      bookingDate: NEAR_MIDNIGHT,
      reference: 'PK-7781',
      bookingCancelled: true,
    }
    const email = buildRefundEmail({ customerName: 'Sam Patel', amount: 72.5, context })
    const sms = buildRefundSmsBody({ customerName: 'Sam Patel', amount: 72.5, context })

    assertCleanRender(email)
    assertCleanText(sms)
    expect(email.text).toContain('Your booking is cancelled, so no space is being held for you.')
    expect(sms).toContain('Your booking is cancelled')
    // Read in London, so the night the clocks go back reads as the 25th, not the 24th.
    expect(email.text).toContain(expectedLongDate('2026-10-25'))
  })

  it('says nothing about cancellation on a partial refund', () => {
    const email = buildRefundEmail({
      customerName: 'Sam Patel',
      amount: 20,
      context: { subject: 'parking', bookingDate: NEAR_MIDNIGHT, bookingCancelled: false },
    })

    expect(email.text).not.toContain('cancelled')
    assertCleanRender(email)
  })

  it('renders cleanly with no context at all rather than naming the wrong booking', () => {
    const email = buildRefundEmail({ customerName: 'Jane Smith', amount: 5 })

    assertCleanRender(email)
    expect(email.subject).toBe('Refund of £5.00 from The Anchor')
    expect(email.text).toContain('to your original payment method')
    expect(email.text).not.toContain('booking on')
  })

  it('falls back to a greeting rather than an empty name', () => {
    const email = buildRefundEmail({ customerName: '   ', amount: 5 })

    assertCleanRender(email)
    expect(email.text.startsWith('Hi there,')).toBe(true)
  })

  it('keeps a bad date out of the copy instead of printing an invalid one', () => {
    const email = buildRefundEmail({
      customerName: 'Jane Smith',
      amount: 5,
      context: { subject: 'table_booking', bookingDate: 'not-a-date' },
    })

    assertCleanRender(email)
    expect(email.text).toContain('for your table booking.')
  })

  it('renders a GMT date as that date', () => {
    const email = buildRefundEmail({
      customerName: 'Jane Smith',
      amount: 5,
      context: { subject: 'table_booking', bookingDate: GMT_DATE },
    })

    expect(email.text).toContain(expectedLongDate(GMT_DATE))
  })
})
