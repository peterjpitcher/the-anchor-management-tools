/**
 * The single place that decides what deposit a table booking owes.
 *
 * Pure. No database, no clock, no environment. Everything it needs is passed in, which is what
 * makes the tie case below testable at all.
 *
 * THE RULES, owner-confirmed 2026-07-30
 *
 *   1. A manager waiver wins outright. No deposit, any party size, any period.
 *   2. The party-size rule: 10 guests or more, at GBP 10 per head. This is the existing live rule.
 *   3. The period rule: per head or per booking at the period's own rate, and ONLY when the guest
 *      actually accepted the seasonal offer. Saying "no, this is not a Christmas dinner" during a
 *      Christmas period is allowed, and that guest gets the normal menu at normal terms.
 *   4. The LARGER of 2 and 3 wins. They NEVER stack. A tie resolves to the period, so the wording
 *      the guest sees names the season rather than "large group".
 *
 * WHY THE TIE MATTERS. Christmas is configured at GBP 10 per head, which is exactly the party-size
 * rate. A party of 12 inside Christmas therefore produces GBP 120 by both routes. A stacking bug
 * would charge GBP 240 and would be completely invisible in casual testing, because every other
 * number would look right. There is an explicit test for it.
 *
 * NOTHING HERE TRUSTS THE CLIENT. `booking_period_id` arrives from a browser. The caller must load
 * the period from the database and pass the loaded row; `resolveTableBookingDeposit` then re-checks
 * it against the booking date, the party limits and the menu state, and returns a distinguishable
 * error code rather than a silent zero when it does not hold up.
 *
 * The database carries the same rules in `resolve_table_booking_deposit`
 * (supabase/migrations/20260803000100_seasonal_booking_periods.sql), because the create path has to
 * price inside its own transaction. If you change a rule here, change it there in the same commit.
 */

import { LARGE_GROUP_DEPOSIT_PER_PERSON_GBP, LARGE_GROUP_DEPOSIT_THRESHOLD } from './deposit'
import { formatGbp, getPeriodOfferability, type BookingPeriod, type DepositBasis } from './periods'

export type DepositRule = 'waived' | 'none' | 'group' | 'period'

export type GroupDepositRule = {
  thresholdGuests: number
  perPersonGbp: number
}

/** The live party-size rule, taken from the existing single source of truth. */
export const DEFAULT_GROUP_DEPOSIT_RULE: GroupDepositRule = {
  thresholdGuests: LARGE_GROUP_DEPOSIT_THRESHOLD,
  perPersonGbp: LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
}

export type DepositRejectionCode =
  | 'invalid_party_size'
  | 'period_inactive'
  | 'period_archived'
  | 'period_date_mismatch'
  | 'period_menu_not_ready'
  | 'period_party_too_small'
  | 'period_party_too_large'

export type ResolveDepositInput = {
  partySize: number
  /** Booking date as YYYY-MM-DD. Compared against the period window. */
  bookingDate: string
  /**
   * The period row as loaded from the database by the server. Never the browser's copy.
   * `null` or omitted means no period applies to this date.
   */
  period?: BookingPeriod | null
  /**
   * What the guest answered to the period's question. `false` (or omitted) means they declined and
   * are booking the normal menu at normal terms, so no period deposit applies.
   */
  periodAccepted?: boolean
  depositWaived?: boolean
  /** Overridable only so tests can prove the comparison, not so it can drift in production. */
  groupRule?: GroupDepositRule
}

export type ResolvedDeposit = {
  required: boolean
  /** The single amount owed in pounds. Never a sum of two rules. */
  amount: number
  rule: DepositRule
  basis: DepositBasis | null
  rate: number | null
  /** Plain-English explanation of which rule won and why. Safe to show staff. */
  reason: string
  periodId: string | null
  periodCode: string | null
  periodName: string | null
  refundCutoffDays: number | null
  refundPolicy: string | null
}

export type DepositResolution =
  | { ok: true; deposit: ResolvedDeposit }
  | { ok: false; code: DepositRejectionCode; message: string }

const REJECTION_MESSAGES: Record<DepositRejectionCode, string> = {
  invalid_party_size: 'The party size must be at least one guest.',
  period_inactive: 'That booking period is not switched on.',
  period_archived: 'That booking period has been archived.',
  period_date_mismatch: 'That booking period does not cover the booking date.',
  period_menu_not_ready: 'That booking period needs a pre-order and its menu has not been published yet.',
  period_party_too_small: 'That booking period has a larger minimum party size.',
  period_party_too_large: 'That booking period has a smaller maximum party size.',
}

function reject(code: DepositRejectionCode): DepositResolution {
  return { ok: false, code, message: REJECTION_MESSAGES[code] }
}

/** Round to pence, avoiding the float drift that turns 60 into 59.999999999999993. */
function toMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function describeRefundPolicy(refundCutoffDays: number): string {
  if (refundCutoffDays <= 0) {
    return 'The deposit is not refundable once the booking is made, though a manager may waive that.'
  }
  return (
    `Full refund up to ${refundCutoffDays} days before the booking date. ` +
    `Inside ${refundCutoffDays} days the deposit is not refunded, though a manager may waive that. ` +
    'The deposit comes off the bill on the day.'
  )
}

function periodDepositAmount(period: BookingPeriod, partySize: number): number {
  if (period.depositBasis === 'per_head') return toMoney(partySize * period.depositAmount)
  if (period.depositBasis === 'per_booking') return toMoney(period.depositAmount)
  return 0
}

/**
 * Returns the single applicable deposit and why, or a distinguishable rejection code.
 *
 * A rejection means the request itself does not hold up (a stale period id, a party outside the
 * period's limits, an unpublished menu). It is NOT the same as "no deposit due", which is a
 * successful resolution with `required: false`.
 */
export function resolveTableBookingDeposit(input: ResolveDepositInput): DepositResolution {
  const { partySize, bookingDate, period = null, periodAccepted = false, depositWaived = false } = input
  const groupRule = input.groupRule ?? DEFAULT_GROUP_DEPOSIT_RULE

  if (!Number.isFinite(partySize) || partySize < 1) {
    return reject('invalid_party_size')
  }

  // 1. A manager waiver wins outright, before anything else is even looked at.
  if (depositWaived) {
    return {
      ok: true,
      deposit: {
        required: false,
        amount: 0,
        rule: 'waived',
        basis: null,
        rate: null,
        reason: 'A manager waived the deposit for this booking.',
        periodId: null,
        periodCode: null,
        periodName: null,
        refundCutoffDays: null,
        refundPolicy: null,
      },
    }
  }

  // 2. Validate the period before any money is computed from it.
  let periodAmount = 0
  if (period && periodAccepted) {
    const offerability = getPeriodOfferability(period, bookingDate)
    if (!offerability.offerable) {
      switch (offerability.reason) {
        case 'archived':
          return reject('period_archived')
        case 'inactive':
          return reject('period_inactive')
        case 'out_of_range':
          return reject('period_date_mismatch')
        case 'menu_not_ready':
          return reject('period_menu_not_ready')
      }
    }
    if (period.minPartySize !== null && partySize < period.minPartySize) {
      return reject('period_party_too_small')
    }
    if (period.maxPartySize !== null && partySize > period.maxPartySize) {
      return reject('period_party_too_large')
    }
    periodAmount = periodDepositAmount(period, partySize)
  }

  // 3. The party-size rule, always evaluated.
  const groupAmount =
    partySize >= groupRule.thresholdGuests ? toMoney(partySize * groupRule.perPersonGbp) : 0

  // 4. Larger wins, never stacks. A tie goes to the period.
  if (period && periodAccepted && periodAmount > 0 && periodAmount >= groupAmount) {
    const rateWording =
      period.depositBasis === 'per_head'
        ? `${formatGbp(period.depositAmount)} per guest`
        : `${formatGbp(period.depositAmount)} for the booking`
    const tieNote =
      periodAmount === groupAmount && groupAmount > 0
        ? ' It matches the large-group deposit rather than adding to it.'
        : ''

    return {
      ok: true,
      deposit: {
        required: true,
        amount: periodAmount,
        rule: 'period',
        basis: period.depositBasis,
        rate: period.depositAmount,
        reason: `${period.name} deposit, ${rateWording}.${tieNote}`,
        periodId: period.id,
        periodCode: period.code,
        periodName: period.name,
        refundCutoffDays: period.refundCutoffDays,
        refundPolicy: describeRefundPolicy(period.refundCutoffDays),
      },
    }
  }

  if (groupAmount > 0) {
    const beatsPeriod = periodAmount > 0 ? ' It is larger than the seasonal deposit, which does not also apply.' : ''
    return {
      ok: true,
      deposit: {
        required: true,
        amount: groupAmount,
        rule: 'group',
        basis: 'per_head',
        rate: groupRule.perPersonGbp,
        reason:
          `Parties of ${groupRule.thresholdGuests} or more pay ` +
          `${formatGbp(groupRule.perPersonGbp)} per guest.${beatsPeriod}`,
        periodId: period && periodAccepted ? period.id : null,
        periodCode: period && periodAccepted ? period.code : null,
        periodName: period && periodAccepted ? period.name : null,
        refundCutoffDays: null,
        refundPolicy: null,
      },
    }
  }

  return {
    ok: true,
    deposit: {
      required: false,
      amount: 0,
      rule: 'none',
      basis: null,
      rate: null,
      reason: 'No deposit is due for this booking.',
      periodId: period && periodAccepted ? period.id : null,
      periodCode: period && periodAccepted ? period.code : null,
      periodName: period && periodAccepted ? period.name : null,
      refundCutoffDays: null,
      refundPolicy: null,
    },
  }
}

/**
 * The terms to write onto `table_bookings` at creation, so a payment dispute can be settled from the
 * booking row alone. Nothing here is ever recomputed afterwards: editing or archiving a period must
 * not change a booking already taken.
 */
export type BookingPeriodTermsSnapshot = {
  booking_period_id: string | null
  booking_period_code: string | null
  booking_period_name: string | null
  booking_period_answer: boolean | null
  booking_period_requires_preorder: boolean | null
  deposit_rule: DepositRule
  deposit_basis: DepositBasis | null
  deposit_rate: number | null
  deposit_amount: number
  deposit_refund_cutoff_days: number | null
  deposit_refund_policy: string | null
}

export function buildPeriodTermsSnapshot(
  deposit: ResolvedDeposit,
  period: BookingPeriod | null,
  periodAccepted: boolean,
): BookingPeriodTermsSnapshot {
  return {
    // The guest's answer is recorded even when it was "no", because "they were asked and declined"
    // is exactly the fact a later dispute turns on.
    booking_period_id: period ? period.id : null,
    booking_period_code: period ? period.code : null,
    booking_period_name: period ? period.name : null,
    booking_period_answer: period ? periodAccepted : null,
    booking_period_requires_preorder: period && periodAccepted ? period.requiresPreorder : null,
    deposit_rule: deposit.rule,
    deposit_basis: deposit.basis,
    deposit_rate: deposit.rate,
    deposit_amount: deposit.amount,
    deposit_refund_cutoff_days: deposit.refundCutoffDays,
    deposit_refund_policy: deposit.refundPolicy,
  }
}
