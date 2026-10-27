import type { RefundResult } from './refunds'

/**
 * What happened to the deposit when staff cancelled a table booking, for the person who did it
 * (BK-114, customer bookings review of 24 October 2026). The cancel routes refunded or failed to
 * refund the deposit and said nothing about it: a refund that did not go through, so the guest is
 * owed money, looked exactly like one that did.
 *
 * The routes send `deposit_refund` beside the booking; the FOH and booking pages show the sentence.
 * Staff-facing only. Kept in its own file so the client pages do not import the refund code.
 */

export type DepositRefundOutcome = {
  state: 'refunded' | 'owed' | 'cash_owed' | 'needs_check' | 'not_due' | 'already_refunded' | 'none'
  amount_pence?: number | null
  cutoff_days?: number | null
}

export function toDepositRefundOutcome(result: RefundResult | null | undefined): DepositRefundOutcome {
  if (!result) return { state: 'none' }
  if (result.refunded) return { state: 'refunded', amount_pence: result.amountPence }
  switch (result.reason) {
    case 'refund_failed':
      return { state: 'owed', amount_pence: result.amountOwedPence ?? null }
    case 'cash_refund_due':
      return { state: 'cash_owed', amount_pence: result.amountOwedPence ?? null }
    case 'terms_unreadable':
      return { state: 'needs_check' }
    case 'zero_tier':
      return { state: 'not_due', cutoff_days: 3 }
    case 'seasonal_cutoff':
      return { state: 'not_due', cutoff_days: result.cutoffDays ?? null }
    case 'already_refunded':
      return { state: 'already_refunded' }
    default:
      return { state: 'none' }
  }
}

const STATES = new Set<DepositRefundOutcome['state']>(['refunded', 'owed', 'cash_owed', 'needs_check', 'not_due', 'already_refunded', 'none'])

export function readDepositRefundOutcome(value: unknown): DepositRefundOutcome | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.state !== 'string' || !STATES.has(record.state as DepositRefundOutcome['state'])) return null
  return {
    state: record.state as DepositRefundOutcome['state'],
    amount_pence: typeof record.amount_pence === 'number' ? record.amount_pence : null,
    cutoff_days: typeof record.cutoff_days === 'number' ? record.cutoff_days : null,
  }
}

function pounds(pence: number | null | undefined): string | null {
  return typeof pence === 'number' && Number.isFinite(pence) ? `£${(pence / 100).toFixed(2)}` : null
}

export function describeDepositRefundForStaff(
  outcome: DepositRefundOutcome | null,
): { tone: 'success' | 'error'; message: string } | null {
  if (!outcome) return null
  switch (outcome.state) {
    case 'refunded': {
      const amount = pounds(outcome.amount_pence)
      return { tone: 'success', message: amount ? `Deposit refund of ${amount} sent to the guest.` : 'Deposit refund sent to the guest.' }
    }
    case 'owed': {
      const amount = pounds(outcome.amount_pence)
      return {
        tone: 'error',
        message: `The deposit refund did not go through, so the guest is owed ${amount ?? 'their deposit'}. Refund it by hand in PayPal. A manager has been emailed.`,
      }
    }
    case 'cash_owed': {
      // BK-041: a cash deposit cannot go back automatically. Hand it back at the bar.
      const amount = pounds(outcome.amount_pence)
      return {
        tone: 'error',
        message: `The deposit was paid in cash, so the guest is owed ${amount ?? 'their deposit'}. Hand it back at the bar and record it with Process Refund (method: cash). A manager has been emailed.`,
      }
    }
    case 'needs_check':
      return {
        tone: 'error',
        message: 'No deposit refund was sent, because the refunds already made could not be read. Check the Refund History and refund what is due. A manager has been emailed.',
      }
    case 'not_due':
      return {
        tone: 'success',
        message: outcome.cutoff_days
          ? `No deposit refund is due: the booking was cancelled inside its ${outcome.cutoff_days}-day refund cutoff.`
          : 'No deposit refund is due for this cancellation.',
      }
    case 'already_refunded':
      return { tone: 'success', message: 'The deposit had already been refunded.' }
    default:
      return null
  }
}
