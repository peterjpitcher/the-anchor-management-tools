import type { CashupSession, UpsertCashupSessionDTO } from '@/types/cashing-up'
import { normalizeCashCountInputs } from './cash-counts'

const SUBMITTED_STATUSES = new Set(['submitted', 'approved', 'locked'])
const SALES_CATEGORIES = ['drinks_sales', 'food_sales', 'other_sales'] as const

function toPence(value: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

function sameRows(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normaliseInputSales(input: UpsertCashupSessionDTO): unknown[] | null {
  if (!input.salesBreakdowns) return []

  const amounts = new Map<string, number>(SALES_CATEGORIES.map(category => [category, 0]))
  for (const row of input.salesBreakdowns) {
    const pence = toPence(row.amount)
    if (!amounts.has(row.salesCategory) || pence === null || pence < 0) return null
    amounts.set(row.salesCategory, (amounts.get(row.salesCategory) ?? 0) + pence)
  }

  return SALES_CATEGORIES.map(category => [category, amounts.get(category)])
}

/**
 * A lost server-action response can leave the browser thinking a successful
 * cash-up was never submitted. Only treat a retry as successful when the
 * persisted record belongs to the same user and every submitted value matches.
 */
export function isMatchingCashupSubmissionRetry(
  session: CashupSession,
  input: UpsertCashupSessionDTO,
  userId: string
): boolean {
  if (
    session.site_id !== input.siteId ||
    session.session_date !== input.sessionDate ||
    session.created_by_user_id !== userId ||
    session.voided_at ||
    !SUBMITTED_STATUSES.has(session.status) ||
    (session.notes ?? '') !== (input.notes ?? '')
  ) {
    return false
  }

  const inputPayments = input.paymentBreakdowns
    .map(row => [
      row.paymentTypeCode,
      row.paymentTypeLabel,
      toPence(row.expectedAmount),
      toPence(row.countedAmount),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  const storedPayments = session.cashup_payment_breakdowns
    .map(row => [
      row.payment_type_code,
      row.payment_type_label,
      toPence(Number(row.expected_amount)),
      toPence(Number(row.counted_amount)),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  if (!sameRows(inputPayments, storedPayments)) return false

  let inputCash: unknown[]
  try {
    inputCash = normalizeCashCountInputs(input.cashCounts)
      .map(row => [toPence(row.denomination), row.quantity, toPence(row.totalAmount)])
      .sort((a, b) => Number(a[0]) - Number(b[0]))
  } catch {
    return false
  }

  const storedCash = session.cashup_cash_counts
    .map(row => [
      toPence(Number(row.denomination)),
      Number(row.quantity),
      toPence(Number(row.total_amount)),
    ])
    .sort((a, b) => Number(a[0]) - Number(b[0]))

  if (!sameRows(inputCash, storedCash)) return false

  const inputSales = normaliseInputSales(input)
  if (!inputSales) return false

  const storedSales = session.cashup_sales_breakdowns
    .map(row => [row.sales_category, toPence(Number(row.amount))])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  return sameRows(inputSales, storedSales)
}
