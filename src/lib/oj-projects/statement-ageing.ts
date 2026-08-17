/**
 * Receivables ageing for a client statement.
 *
 * Pure on purpose: no Supabase, no rendering. The statement action supplies each
 * invoice's remaining balance and this decides which bucket it falls in, so the
 * rule can be tested directly rather than inferred from a PDF.
 *
 * **Aged by days overdue, not days since the invoice date.** Every client is on
 * 7-day terms, so invoice-date ageing is actively misleading: on 2026-08-17
 * INV-003W9 was 16 days old and 9 days past due, and invoice-date ageing would
 * have reported it as current. A statement that calls a late invoice current is
 * worse than no statement.
 *
 * Buckets are measured as at the statement's period end, never "today". The
 * ledger already stops at the period end, so using the generation date would
 * make the two halves of the same document disagree, and regenerating an old
 * statement would silently produce different figures each time.
 */

import { roundMoney } from '@/lib/oj-projects/utils'

export type AgeingBucketKey =
  | 'not_yet_due'
  | 'overdue_1_30'
  | 'overdue_31_60'
  | 'overdue_61_90'
  | 'overdue_90_plus'

export interface AgeingBucket {
  key: AgeingBucketKey
  label: string
  amount: number
}

export interface StatementAgeing {
  /** The date the ageing was measured at. Always the statement's period end. */
  asAt: string
  buckets: AgeingBucket[]
  /** Sum of the buckets. Money the client owes. */
  receivablesTotal: number
  /**
   * Unapplied credit, as a positive number. An overpaid invoice belongs here
   * rather than as a negative bucket, so the buckets stay readable as debt.
   */
  creditTotal: number
  /**
   * `receivablesTotal - creditTotal`. Must equal the statement's closing
   * balance; the statement prints this so a mismatch is visible rather than
   * silent.
   */
  netTotal: number
}

/** One invoice's position as at the ageing date. */
export interface AgeingInvoice {
  dueDate: string
  /** Total less payments and credit notes dated on or before the ageing date. Negative means overpaid. */
  remaining: number
}

const BUCKET_LABELS: Record<AgeingBucketKey, string> = {
  not_yet_due: 'Not yet due',
  overdue_1_30: '1 to 30 days',
  overdue_31_60: '31 to 60 days',
  overdue_61_90: '61 to 90 days',
  overdue_90_plus: 'Over 90 days',
}

const BUCKET_ORDER: AgeingBucketKey[] = [
  'not_yet_due',
  'overdue_1_30',
  'overdue_31_60',
  'overdue_61_90',
  'overdue_90_plus',
]

function parseIsoDateUtc(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!match) return null
  const [, y, m, d] = match
  const stamp = Date.UTC(Number(y), Number(m) - 1, Number(d))
  return Number.isFinite(stamp) ? stamp : null
}

/**
 * Whole calendar days between the due date and the ageing date. Zero or less
 * means the invoice is not yet due.
 */
export function daysOverdue(dueDate: string, asAt: string): number {
  const due = parseIsoDateUtc(dueDate)
  const at = parseIsoDateUtc(asAt)
  // An unparseable due date is treated as not yet due rather than dropped, so a
  // bad row cannot quietly vanish from a total that has to reconcile.
  if (due === null || at === null) return 0
  return Math.round((at - due) / 86_400_000)
}

export function bucketForDaysOverdue(days: number): AgeingBucketKey {
  if (days <= 0) return 'not_yet_due'
  if (days <= 30) return 'overdue_1_30'
  if (days <= 60) return 'overdue_31_60'
  if (days <= 90) return 'overdue_61_90'
  return 'overdue_90_plus'
}

/**
 * Buckets each invoice's remaining balance by how overdue it is.
 *
 * Every balance is rounded before it is summed, so the columns add up to the
 * total exactly rather than drifting by a penny on a long statement.
 */
export function buildStatementAgeing(invoices: AgeingInvoice[], asAt: string): StatementAgeing {
  const totals = new Map<AgeingBucketKey, number>(BUCKET_ORDER.map((key) => [key, 0]))
  let creditTotal = 0

  for (const invoice of invoices) {
    const remaining = roundMoney(Number(invoice.remaining) || 0)
    if (remaining === 0) continue

    if (remaining < 0) {
      // Overpaid. Kept out of the buckets so they read purely as debt.
      creditTotal = roundMoney(creditTotal + Math.abs(remaining))
      continue
    }

    const key = bucketForDaysOverdue(daysOverdue(invoice.dueDate, asAt))
    totals.set(key, roundMoney((totals.get(key) ?? 0) + remaining))
  }

  const buckets = BUCKET_ORDER.map((key) => ({
    key,
    label: BUCKET_LABELS[key],
    amount: totals.get(key) ?? 0,
  }))

  const receivablesTotal = roundMoney(buckets.reduce((acc, bucket) => acc + bucket.amount, 0))

  return {
    asAt,
    buckets,
    receivablesTotal,
    creditTotal,
    netTotal: roundMoney(receivablesTotal - creditTotal),
  }
}
