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
 *   5. The kill switch, `booking_period_deposits_enabled`, suppresses rule 3 and rule 3 only. Switch
 *      it off at 7pm on a Friday and no seasonal money is asked for anywhere, while a party of 12
 *      still pays the long-standing large-group deposit. The guest's answer is still recorded,
 *      because "they said yes to Christmas dinner and we chose not to take a deposit" is a fact the
 *      kitchen needs and a later dispute turns on.
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
import {
  formatGbp,
  getPeriodOfferability,
  type BookingPeriod,
  type DepositBasis,
  type PeriodUnavailableReason,
} from './periods'

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
  /**
   * The `booking_period_deposits_enabled` kill switch, as read from the database by the caller.
   * `false` means no SEASONAL deposit is asked for. The party-size rule is deliberately untouched
   * by it: switching seasonal collection off must not stop a party of 12 paying the deposit they
   * have always paid.
   */
  collectPeriodDeposits?: boolean
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

/**
 * The three period faults that are refused whatever the guest answered, mapped from the shared
 * offerability rule. `menu_not_ready` is deliberately absent: it belongs to the seasonal offer, so
 * it is only a fault for a guest who accepted one.
 */
const UNCONDITIONAL_REJECTIONS: Record<
  Exclude<PeriodUnavailableReason, 'menu_not_ready'>,
  DepositRejectionCode
> = {
  archived: 'period_archived',
  inactive: 'period_inactive',
  out_of_range: 'period_date_mismatch',
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
  const {
    partySize,
    bookingDate,
    period = null,
    periodAccepted = false,
    depositWaived = false,
    collectPeriodDeposits = true,
  } = input
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
  //
  // The checks run in exactly the order `resolve_table_booking_deposit` runs them, and the split is
  // the same: a period that was SUPPLIED at all is checked for archived, inactive and out-of-range
  // whatever the guest answered, because a caller handing over a stale id has a bug that must
  // surface rather than silently resolve to "no deposit". The party limits and the menu are checked
  // only when the guest accepted, because they describe the seasonal offer and a guest who declined
  // it is booking the normal menu at normal terms.
  let periodAmount = 0
  if (period) {
    const offerability = getPeriodOfferability(period, bookingDate)

    // `getPeriodOfferability` checks the menu last, so anything other than `menu_not_ready` here
    // means one of the three unconditional checks failed.
    if (!offerability.offerable && offerability.reason !== 'menu_not_ready') {
      return reject(UNCONDITIONAL_REJECTIONS[offerability.reason])
    }

    if (periodAccepted) {
      if (period.minPartySize !== null && partySize < period.minPartySize) {
        return reject('period_party_too_small')
      }
      if (period.maxPartySize !== null && partySize > period.maxPartySize) {
        return reject('period_party_too_large')
      }
      if (!offerability.offerable) {
        return reject('period_menu_not_ready')
      }
      if (collectPeriodDeposits) {
        periodAmount = periodDepositAmount(period, partySize)
      }
    }
  }

  // Carried onto whichever deposit wins below. A deposit taken on a booking where the guest
  // accepted the seasonal offer is governed by that period's refund promise, even when the
  // party-size rule produced the larger number. Dropping the terms there would leave the guest
  // holding a promise the booking row cannot evidence.
  const acceptedPeriod = period && periodAccepted ? period : null

  // 3. The party-size rule, always evaluated.
  const groupAmount =
    partySize >= groupRule.thresholdGuests ? toMoney(partySize * groupRule.perPersonGbp) : 0

  // 4. Larger wins, never stacks. A tie goes to the period.
  if (acceptedPeriod && periodAmount > 0 && periodAmount >= groupAmount) {
    const rateWording =
      acceptedPeriod.depositBasis === 'per_head'
        ? `${formatGbp(acceptedPeriod.depositAmount)} per guest`
        : `${formatGbp(acceptedPeriod.depositAmount)} for the booking`
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
        basis: acceptedPeriod.depositBasis,
        rate: acceptedPeriod.depositAmount,
        reason: `${acceptedPeriod.name} deposit, ${rateWording}.${tieNote}`,
        periodId: acceptedPeriod.id,
        periodCode: acceptedPeriod.code,
        periodName: acceptedPeriod.name,
        refundCutoffDays: acceptedPeriod.refundCutoffDays,
        refundPolicy: describeRefundPolicy(acceptedPeriod.refundCutoffDays),
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
        periodId: acceptedPeriod ? acceptedPeriod.id : null,
        periodCode: acceptedPeriod ? acceptedPeriod.code : null,
        periodName: acceptedPeriod ? acceptedPeriod.name : null,
        refundCutoffDays: acceptedPeriod ? acceptedPeriod.refundCutoffDays : null,
        refundPolicy: acceptedPeriod ? describeRefundPolicy(acceptedPeriod.refundCutoffDays) : null,
      },
    }
  }

  // No deposit at all, so there is no refund promise to carry. The period fields still record that
  // a seasonal offer was accepted, which is what tells the kitchen to expect a festive pre-order.
  const suppressed = Boolean(acceptedPeriod) && !collectPeriodDeposits
  return {
    ok: true,
    deposit: {
      required: false,
      amount: 0,
      rule: 'none',
      basis: null,
      rate: null,
      reason: suppressed
        ? 'No deposit is being taken: seasonal deposit collection is switched off in Settings.'
        : 'No deposit is due for this booking.',
      periodId: acceptedPeriod ? acceptedPeriod.id : null,
      periodCode: acceptedPeriod ? acceptedPeriod.code : null,
      periodName: acceptedPeriod ? acceptedPeriod.name : null,
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
