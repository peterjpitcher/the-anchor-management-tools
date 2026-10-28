import { describe, expect, it } from 'vitest'
import { buildStaffCancellationRefundNote } from '@/lib/events/staff-cancellation-refund-note'
import { normaliseToGsm7 } from '@/lib/sms/gsm7'

/**
 * The refund sentence in the staff-cancellation text (BK-090). A guest who never paid used to be
 * told "No refund is due under the event cancellation policy.", which reads as money lost.
 */
const BAD_VALUES = /undefined|null|NaN|Invalid Date|£0\.00/

describe('staff cancellation refund note', () => {
  it.each([
    ['a free night', { refundStatus: 'none', refundAmount: 0, paymentTaken: false }, null],
    ['pay cash on the night', { refundStatus: 'none', refundAmount: 0, paymentTaken: false }, null],
    ['an unpaid prepaid hold', { refundStatus: 'none', refundAmount: 0, paymentTaken: false }, null],
    ['a paid booking the manager chose not to refund', { refundStatus: 'none', refundAmount: 0, paymentTaken: true }, 'This booking was not refunded.'],
    ['a refund that went', { refundStatus: 'succeeded', refundAmount: 25, paymentTaken: true }, 'Refund issued: £25.00.'],
    ['a refund still going through', { refundStatus: 'pending', refundAmount: 12.5, paymentTaken: true }, 'Refund pending: £12.50.'],
    ['a refund that needs a person', { refundStatus: 'manual_required', refundAmount: 30, paymentTaken: true }, "We'll be in touch about your £30.00 refund."],
    ['a refund that failed', { refundStatus: 'failed', refundAmount: 30, paymentTaken: true }, "We'll be in touch about your £30.00 refund."],
    // BK-135 and the review finding on PR 277: bar money goes back at the bar, PayPal money online.
    ['a booking paid only at the bar', { refundStatus: 'none', refundAmount: 0, paymentTaken: true, barRefundAmount: 45 }, "You paid £45.00 at the bar, so we'll be in touch to give it back."],
    ['a booking paid both ways', { refundStatus: 'succeeded', refundAmount: 80, paymentTaken: true, barRefundAmount: 45 }, "Refund issued: £80.00, and we'll hand back the £45.00 you paid at the bar."],
    ['a booking paid both ways whose PayPal part needs a person', { refundStatus: 'failed', refundAmount: 80, paymentTaken: true, barRefundAmount: 45 }, "We'll be in touch about your £80.00 refund, and we'll hand back the £45.00 you paid at the bar."],
  ] as const)('%s', (_label, input, expected) => {
    const note = buildStaffCancellationRefundNote(input)
    expect(note).toBe(expected)
    if (note) {
      expect(note).not.toMatch(BAD_VALUES)
      expect(normaliseToGsm7(note)).toBe(note)
      expect(note).not.toContain('No refund is due')
    }
  })

  it('treats a NaN amount as nothing refunded', () => {
    expect(buildStaffCancellationRefundNote({ refundStatus: 'succeeded', refundAmount: Number.NaN, paymentTaken: false })).toBeNull()
  })
})
