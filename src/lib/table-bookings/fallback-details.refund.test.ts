import { describe, expect, it } from 'vitest'
import { cancellationFacts, refundResultFromFacts } from './fallback-details'
import { describeTableBookingCancellationRefund, type TableBookingCancellationRefundResult } from './guest-texts'

/**
 * The fallback text after a bounced cancellation email is rebuilt from the facts stored with the
 * email. It has to state the same refund sentence the email did, including what had already gone
 * back, or the two messages give the guest two different figures to check.
 */
describe('cancellation facts carry what had already gone back', () => {
  const variants: Array<[string, TableBookingCancellationRefundResult]> = [
    ['rest of a full refund', { refunded: true, amountPence: 10000, tier: 'full', alreadyReturnedPence: 5000 }],
    ['rest of a half refund', { refunded: true, amountPence: 2500, tier: 'half', alreadyReturnedPence: 5000 }],
    ['plain full refund', { refunded: true, amountPence: 15000, tier: 'full' }],
    ['Christmas, inside its 7-day cutoff', { refunded: false, reason: 'seasonal_cutoff', cutoffDays: 7 }],
    ['a deposit that was never refundable', { refunded: false, reason: 'seasonal_cutoff', cutoffDays: 0 }],
    // BK-046 and BK-041: the bounce fallback must apologise as the email did, and name the cash owed.
    ['the pub cancelled, refunded in full', { refunded: true, amountPence: 16000, tier: 'full', cancelledBy: 'venue' }],
    ['the pub cancelled, no deposit', { refunded: false, reason: 'no_deposit', cancelledBy: 'venue' }],
    ['a manager chose the amount', { refunded: true, amountPence: 4000, tier: 'chosen' }],
    ['a cash deposit is owed', { refunded: false, reason: 'cash_refund_due', depositOwed: true, amountOwedPence: 8000 }],
  ]

  it.each(variants)('%s: the rebuilt sentence is the sentence first sent', (_label, refundResult) => {
    const facts = cancellationFacts({ bookingDate: '2026-09-12', refundResult })
    const rebuilt = refundResultFromFacts(facts)

    expect(rebuilt).toEqual(refundResult)
    expect(describeTableBookingCancellationRefund(rebuilt!)).toBe(describeTableBookingCancellationRefund(refundResult))
  })

  it('reads facts stored before this field existed as a plain refund', () => {
    const rebuilt = refundResultFromFacts({
      booking_date: '2026-09-12',
      refund_outcome: 'refunded',
      refund_tier: 'full',
      refund_amount_pence: 15000,
    })

    expect(rebuilt).toEqual({ refunded: true, amountPence: 15000, tier: 'full' })
  })
})
