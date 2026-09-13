/**
 * What a guest is told about a table booking deposit: what it is, that it comes off the bill, by
 * when it has to be paid, and what comes back if they cancel.
 *
 * One place, because the 11 September email review found the deposit request saying "please pay
 * your £160.00 to secure your table": the amount had replaced the word, so the email never said
 * the money was a deposit, never said it came off the bill, gave no deadline and gave no refund
 * terms. The same four facts are owed by the deposit request, the booking confirmation, the
 * rescheduled notice and the guest cancel page, so they are written once here.
 *
 * Every sentence is either the approved wording from website SSOT section 16 or a statement of
 * the rule the code actually applies:
 *
 *  - The group line is SSOT section 16 verbatim, built from the live threshold and rate.
 *  - The Christmas line is SSOT section 16's Christmas wording, with the refundability from
 *    section 7.
 *  - The sliding refund bands are `calculateRefundTier` in refunds.ts (7 or more days full,
 *    3 to 6 days half, inside 3 days none).
 *  - A seasonal booking's own cutoff is the promise it was sold on, which is what
 *    `refundTableBookingDeposit` honours, so that wins wherever the booking carries one.
 *
 * Nothing here invents an amount or a policy: when the per-person rate or the seasonal cutoff is
 * unknown, the sentence that would have stated it is left out rather than guessed.
 *
 * Pure: no database, no clock.
 */

import { LARGE_GROUP_DEPOSIT_THRESHOLD } from './deposit'

/** "£10", for a whole-pound rate. Null for anything that is not a positive amount. */
function formatWholePounds(amount: number | null | undefined): string | null {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null
  const whole = Math.round(value * 100) / 100
  return Number.isInteger(whole)
    ? `£${whole}`
    : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(whole)
}

/** The per-person rate a deposit works out at, or null when either half is unknown. */
export function depositPerPerson(depositAmount: number | null | undefined, partySize: number | null | undefined): number | null {
  const amount = Number(depositAmount)
  const size = Math.floor(Number(partySize))
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (!Number.isFinite(size) || size < 1) return null
  return Math.round((amount / size) * 100) / 100
}

/**
 * What the deposit is and where it goes. SSOT section 16, "Group deposit" and "Christmas 2026".
 */
export function depositPurposeLine(input: { isChristmas: boolean; perPersonGbp: number | null }): string {
  const rate = formatWholePounds(input.perPersonGbp)

  if (input.isChristmas) {
    return rate
      ? `There's a ${rate} per person deposit, which comes off your bill.`
      : 'The deposit comes off your bill.'
  }

  return rate
    ? `Groups of ${LARGE_GROUP_DEPOSIT_THRESHOLD} or more: a ${rate} per person deposit, fully deducted from your bill.`
    : 'The deposit is fully deducted from your bill.'
}

/**
 * What comes back if the guest cancels.
 *
 * `refundCutoffDays` is the booking's own `deposit_refund_cutoff_days`, the seasonal promise it
 * was sold on. Null means the booking carries no seasonal terms, so the sliding bands apply. A
 * seasonal booking with no readable cutoff gets no sentence at all: that is exactly the case
 * `refundTableBookingDeposit` refuses to decide, and copy must not promise what the refund path
 * will not do.
 */
export function depositRefundLine(input: { isChristmas: boolean; refundCutoffDays: number | null }): string | null {
  // `typeof` first, deliberately: `Number(null)` is 0, which `Number.isFinite` accepts, so a
  // booking with no seasonal terms would have been told its deposit was never refundable.
  const cutoff = input.refundCutoffDays
  const hasCutoff = typeof cutoff === 'number' && Number.isFinite(cutoff) && cutoff >= 0

  if (hasCutoff) {
    if (cutoff === 0) {
      return 'The deposit is not refundable once the booking is made, though a manager may waive that.'
    }
    return (
      `Cancel up to and including ${cutoff} days before your booking date and the deposit is refunded in full. ` +
      `Fewer than ${cutoff} days before, it is not refunded.`
    )
  }

  if (input.isChristmas) return null

  return (
    'Cancel 7 or more days before and the deposit is refunded in full. ' +
    'Between 3 and 6 days before, half of it comes back. Inside 3 days it is not refunded.'
  )
}

/**
 * The deadline. `payByLabel` is the hold instant as the guest reads it; the booking function sets
 * that hold to the sooner of the booking start and 24 hours from now, so "up to 24 hours" is the
 * honest fallback when the instant is not to hand.
 */
export function depositPayByLine(payByLabel: string | null): string {
  return payByLabel
    ? `Please pay by ${payByLabel}, which is when the hold on your table runs out.`
    : 'Your table is held while you pay, for up to 24 hours.'
}

/**
 * The deposit facts in the order a guest needs them: what it is, by when, what comes back.
 * Used by every email that asks for a deposit or restates one that is still owed.
 */
export function depositTermsLines(input: {
  isChristmas: boolean
  perPersonGbp: number | null
  refundCutoffDays: number | null
  payByLabel: string | null
}): string[] {
  const refund = depositRefundLine(input)
  return [
    depositPurposeLine(input),
    depositPayByLine(input.payByLabel),
    ...(refund ? [refund] : []),
  ]
}

/**
 * What the guest cancel page says about the deposit before they confirm.
 *
 * Deliberately conditional ("if you paid a deposit"): the manage preview carries no payment
 * state, by design, so the page knows the booking type and nothing about the money. Stating the
 * rule without claiming a deposit was taken is the only honest form of this sentence.
 */
export function guestCancellationRefundNotice(input: {
  isChristmas: boolean
  refundCutoffDays: number | null
}): string {
  const refund = depositRefundLine(input)
  return refund
    ? `If you paid a deposit: ${refund.charAt(0).toLowerCase()}${refund.slice(1)}`
    : 'If you paid a deposit, call us and we will sort it out with you.'
}
