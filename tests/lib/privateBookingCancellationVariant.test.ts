import { describe, expect, it } from 'vitest'
import { chooseCancellationVariant, refundBeforeCosts } from '@/lib/private-bookings/cancellation-variant'
import { refundDueByIso, refundStillOwed } from '@/lib/private-bookings/refund-due'
import type { PrivateBookingCancellationOutcome } from '@/services/private-bookings/financial'

/**
 * BK-065 and owner decision D26 (customer bookings review, 24 October 2026): one rule for the
 * cancellation message and the refund it promises, used by the dialog's preview and by
 * cancelBooking; costs already committed may be kept back from the refund, with a reason.
 */
const guest = { customerFirstName: 'Alex', eventDate: '12 December 2026' }

const outcome = (overrides: Partial<PrivateBookingCancellationOutcome>): PrivateBookingCancellationOutcome => ({
  outcome: 'refundable',
  refund_amount: 0,
  retained_amount: 0,
  deposit_deduction: 0,
  max_retainable: 0,
  ...overrides,
})

describe('the cancellation message and refund', () => {
  it('30 days or more ahead: the deposit less 5%, with the deduction named', () => {
    const variant = chooseCancellationVariant(
      outcome({ outcome: 'deposit_partial_refund', refund_amount: 237.5, retained_amount: 12.5, deposit_deduction: 12.5 }),
      guest,
    )
    expect(variant).toMatchObject({ triggerType: 'booking_cancelled_partial_refund', refundAmount: 237.5, deductionAmount: 12.5, costsKept: 0 })
    expect(variant.messageBody).toContain('£12.50 cancellation administration deduction')
  })

  it('costs kept turn it into the retention message, with the refund less the costs', () => {
    const variant = chooseCancellationVariant(
      outcome({ outcome: 'deposit_partial_refund', refund_amount: 237.5, retained_amount: 12.5, deposit_deduction: 12.5 }),
      guest,
      { costsKept: 100 },
    )
    expect(variant).toMatchObject({ triggerType: 'booking_cancelled_retention', refundAmount: 137.5, retainedAmount: 112.5, costsKept: 100 })
    expect(variant.messageBody).toBe(
      "Hi Alex, your booking on 12 December 2026 is cancelled. Following review, we've kept £112.50 to cover costs from the cancellation. £137.50 will be refunded within 10 working days. We'll send a breakdown on request.",
    )
  })

  it('a manager retention inside 30 days, plus costs from the balance refund', () => {
    const decided = outcome({ outcome: 'gm_review_required', refund_amount: 400, max_retainable: 250 })
    expect(refundBeforeCosts(decided, { retainedAmount: 100 })).toEqual({ refund: 550, kept: 100 })
    expect(chooseCancellationVariant(decided, guest, { retainedAmount: 100, costsKept: 50 })).toMatchObject({
      triggerType: 'booking_cancelled_retention', refundAmount: 500, retainedAmount: 150,
    })
  })

  it('inside 30 days with no decision yet: review pending, and no refund to keep costs from', () => {
    const pending = outcome({ outcome: 'gm_review_required', refund_amount: 0, max_retainable: 250 })
    expect(refundBeforeCosts(pending, {})).toBeNull()
    expect(chooseCancellationVariant(pending, guest).triggerType).toBe('booking_cancelled_review_pending')
  })

  it('never keeps more in costs than the refund', () => {
    expect(chooseCancellationVariant(outcome({ refund_amount: 80 }), guest, { costsKept: 500 })).toMatchObject({ refundAmount: 0, costsKept: 80 })
  })
})

describe('when the refund is promised by', () => {
  it('is 10 working days later, skipping weekends, as a London date', () => {
    // Tuesday 27 October 2026 to Tuesday 10 November 2026.
    expect(refundDueByIso(new Date('2026-10-27T15:00:00.000Z'))).toBe('2026-11-10')
    // A Saturday counts from the Monday.
    expect(refundDueByIso(new Date('2026-10-31T10:00:00.000Z'))).toBe('2026-11-13')
  })

  it('is still owed until the refunds recorded reach it', () => {
    expect(refundStillOwed({ refund_due_amount: 237.5 }, 100)).toBe(137.5)
    expect(refundStillOwed({ refund_due_amount: 237.5 }, 237.5)).toBe(0)
    expect(refundStillOwed({ refund_due_amount: null }, 0)).toBe(0)
  })
})
