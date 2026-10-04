import { isValidIsoDate } from '@/lib/dateUtils'
import { getRecurringChargeCoverage, type RecurringBillingPeriod } from './recurring-periods'
import { roundMoney } from './utils'

export interface FinalRecurringCoverage {
  start: string
  end: string
  amountExVat: number
  fullDays: number
  billableDays: number
  isProrated: boolean
}

function inclusiveCalendarDays(start: string, end: string): number {
  // UTC midnight measures calendar days without London daylight saving changes.
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1
}

/** The end date is the final billable day. Existing invoice snapshots are separate. */
export function getFinalRecurringCoverage(
  frequency: string | null | undefined,
  billingPeriod: RecurringBillingPeriod,
  amountExVat: number,
  endDate?: string | null,
): FinalRecurringCoverage | null {
  if (!isValidIsoDate(billingPeriod.period_start) || !isValidIsoDate(billingPeriod.period_end)
    || billingPeriod.period_end < billingPeriod.period_start) {
    throw new Error('Invalid recurring billing period')
  }
  if (!Number.isFinite(amountExVat) || amountExVat < 0) {
    throw new Error('Recurring charge amount must be a finite non-negative number')
  }
  if (endDate != null && !isValidIsoDate(endDate)) {
    throw new Error('Invalid recurring charge end date')
  }

  const coverage = getRecurringChargeCoverage(frequency, billingPeriod)
  if (!isValidIsoDate(coverage.start) || !isValidIsoDate(coverage.end) || coverage.end < coverage.start) {
    throw new Error('Invalid recurring coverage period')
  }
  if (endDate != null && endDate < coverage.start) return null

  const end = endDate != null && endDate < coverage.end ? endDate : coverage.end
  const fullDays = inclusiveCalendarDays(coverage.start, coverage.end)
  const billableDays = inclusiveCalendarDays(coverage.start, end)
  return {
    start: coverage.start,
    end,
    amountExVat: roundMoney(amountExVat * billableDays / fullDays),
    fullDays,
    billableDays,
    isProrated: billableDays < fullDays,
  }
}
