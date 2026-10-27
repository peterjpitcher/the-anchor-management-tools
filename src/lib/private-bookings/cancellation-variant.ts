import {
  bookingCancelledHoldMessage,
  bookingCancelledManualReviewMessage,
  bookingCancelledPartialRefundMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledRetentionMessage,
  bookingCancelledReviewPendingMessage,
} from '@/lib/private-bookings/messages'
import type {
  CancellationFinancialOutcome,
  PrivateBookingCancellationOutcome,
} from '@/services/private-bookings/financial'

/**
 * Which cancellation message a private booking gets, and the money it states, from its financial
 * outcome and the decisions staff make in the cancel dialog. One pure rule, used by the dialog's
 * preview (getCancellationPreview) and by cancelBooking, so what staff see is what is sent.
 *
 * Decisions:
 * - retainedAmount: for a cancellation inside 30 days with a paid deposit, how much of the deposit
 *   a manager keeps (SOP §14). Without it the outcome is "review pending", which cancelBooking no
 *   longer accepts (BK-065): the decision is made in the dialog.
 * - costsKept: direct costs already committed for the hire that are kept back from the refund,
 *   with a reason (owner decision D26, 26 October 2026; the contract allows it). Never more than
 *   the refund. When there are any, the guest gets the retention message, which says how much was
 *   kept to cover costs and what will be refunded.
 */
export type CancellationVariant = {
  triggerType:
    | 'booking_cancelled_hold'
    | 'booking_cancelled_refundable'
    | 'booking_cancelled_partial_refund'
    | 'booking_cancelled_retention'
    | 'booking_cancelled_review_pending'
    | 'booking_cancelled_manual_review'
  templateKey:
    | 'private_booking_cancelled_hold'
    | 'private_booking_cancelled_refundable'
    | 'private_booking_cancelled_partial_refund'
    | 'private_booking_cancelled_retention'
    | 'private_booking_cancelled_review_pending'
    | 'private_booking_cancelled_manual_review'
  messageBody: string
  outcome: CancellationFinancialOutcome
  /** What will be refunded to the guest. */
  refundAmount: number
  /** What is kept: a retained deposit, the administration deduction folded into costs, or costs. */
  retainedAmount: number
  /** The administration deduction the partial-refund text states; 0 for every other variant. */
  deductionAmount: number
  /** Direct costs kept back from the refund; 0 when none. */
  costsKept: number
}

export type CancellationDecisions = {
  retainedAmount?: number | null
  costsKept?: number | null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * The refund the outcome gives before any costs are kept, and what is kept by then. Null for an
 * outcome that refunds nothing by rule (no money, manual review, or a retention not yet decided).
 */
export function refundBeforeCosts(
  outcome: PrivateBookingCancellationOutcome,
  decisions: CancellationDecisions,
): { refund: number; kept: number } | null {
  switch (outcome.outcome) {
    case 'deposit_partial_refund':
      return { refund: outcome.refund_amount, kept: outcome.deposit_deduction }
    case 'refundable':
      return { refund: outcome.refund_amount, kept: 0 }
    case 'gm_review_required': {
      if (decisions.retainedAmount === null || decisions.retainedAmount === undefined) return null
      const retained = Math.min(Math.max(decisions.retainedAmount, 0), outcome.max_retainable)
      return { refund: roundMoney(outcome.refund_amount + (outcome.max_retainable - retained)), kept: retained }
    }
    default:
      return null
  }
}

export function chooseCancellationVariant(
  outcome: PrivateBookingCancellationOutcome,
  guest: { customerFirstName: string | null | undefined; eventDate: string },
  decisions: CancellationDecisions = {},
): CancellationVariant {
  const none = { deductionAmount: 0, costsKept: 0 }

  if (outcome.outcome === 'no_money') {
    return {
      triggerType: 'booking_cancelled_hold',
      templateKey: 'private_booking_cancelled_hold',
      messageBody: bookingCancelledHoldMessage(guest),
      outcome: outcome.outcome,
      refundAmount: outcome.refund_amount,
      retainedAmount: outcome.retained_amount,
      ...none,
    }
  }

  const base = refundBeforeCosts(outcome, decisions)

  if (outcome.outcome === 'gm_review_required' && !base) {
    // Cancelled before a retention decision exists: tell the guest the payment review is in
    // progress, never an automatic retention. cancelBooking now asks for the decision first.
    return {
      triggerType: 'booking_cancelled_review_pending',
      templateKey: 'private_booking_cancelled_review_pending',
      messageBody: bookingCancelledReviewPendingMessage(guest),
      outcome: outcome.outcome,
      refundAmount: outcome.refund_amount,
      retainedAmount: 0,
      ...none,
    }
  }

  if (!base) {
    return {
      triggerType: 'booking_cancelled_manual_review',
      templateKey: 'private_booking_cancelled_manual_review',
      messageBody: bookingCancelledManualReviewMessage(guest),
      outcome: 'manual_review',
      refundAmount: outcome.refund_amount,
      retainedAmount: outcome.retained_amount,
      ...none,
    }
  }

  const costs = roundMoney(Math.min(Math.max(decisions.costsKept ?? 0, 0), base.refund))
  if (costs > 0 || (outcome.outcome === 'gm_review_required' && base.kept > 0)) {
    const kept = roundMoney(base.kept + costs)
    const refund = roundMoney(base.refund - costs)
    return {
      triggerType: 'booking_cancelled_retention',
      templateKey: 'private_booking_cancelled_retention',
      messageBody: bookingCancelledRetentionMessage({ ...guest, retainedAmount: kept, refundAmount: refund }),
      outcome: outcome.outcome,
      refundAmount: refund,
      retainedAmount: kept,
      deductionAmount: 0,
      costsKept: costs,
    }
  }

  if (outcome.outcome === 'deposit_partial_refund') {
    return {
      triggerType: 'booking_cancelled_partial_refund',
      templateKey: 'private_booking_cancelled_partial_refund',
      messageBody: bookingCancelledPartialRefundMessage({
        ...guest,
        refundAmount: base.refund,
        deductionAmount: outcome.deposit_deduction,
      }),
      outcome: outcome.outcome,
      refundAmount: base.refund,
      retainedAmount: outcome.retained_amount,
      deductionAmount: outcome.deposit_deduction,
      costsKept: 0,
    }
  }

  return {
    triggerType: 'booking_cancelled_refundable',
    templateKey: 'private_booking_cancelled_refundable',
    messageBody: bookingCancelledRefundableMessage({ ...guest, refundAmount: base.refund }),
    outcome: outcome.outcome,
    refundAmount: base.refund,
    // What the outcome itself keeps (nothing once a manager has decided to keep nothing).
    retainedAmount: outcome.outcome === 'gm_review_required' ? 0 : outcome.retained_amount,
    ...none,
  }
}
