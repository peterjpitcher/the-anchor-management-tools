/**
 * Shared scheduling rule for OJ Projects recurring charges.
 *
 * Monthly charges bill on every run. Quarterly and annual charges bill on the
 * first billing run after they are created, then every 3 / 12 months from that
 * run. They are deliberately NOT pinned to calendar quarter ends or to
 * December, so a charge added mid-year goes out on the next invoice rather
 * than waiting for an arbitrary calendar date.
 *
 * The anniversary is anchored to the charge's own instance history, so nothing
 * extra has to be stored on the charge itself.
 */

export type RecurringBillingPeriod = {
  period_start: string
  period_end: string
  period_yyyymm: string
}

const FREQUENCY_INTERVAL_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
  yearly: 12,
}

export function getRecurringChargeIntervalMonths(frequency: string | null | undefined): number {
  const key = String(frequency || 'monthly').trim().toLowerCase()
  return FREQUENCY_INTERVAL_MONTHS[key] ?? 1
}

/**
 * Adds whole months to an ISO date, clamping to the last day of the target
 * month (31 Jan + 1 month = 28/29 Feb).
 */
export function addMonthsToIsoDate(isoDate: string, months: number): string {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return isoDate
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const lastDayOfTarget = new Date(Date.UTC(year, monthIndex + months + 1, 0)).getUTCDate()
  const target = new Date(Date.UTC(year, monthIndex + months, Math.min(day, lastDayOfTarget)))
  return target.toISOString().slice(0, 10)
}

/**
 * Returns the period to bill this recurring charge under, or null when the
 * charge is not due in this billing period.
 *
 * `lastChargedPeriodStart` is the period_start of the most recent instance
 * already created for this charge before the current billing period, or null
 * if it has never been charged.
 */
export function getRecurringChargePeriod(
  frequency: string | null | undefined,
  billingPeriod: RecurringBillingPeriod,
  lastChargedPeriodStart?: string | null
): RecurringBillingPeriod | null {
  const intervalMonths = getRecurringChargeIntervalMonths(frequency)
  if (intervalMonths <= 1) return billingPeriod

  // Never charged before, so it goes out on this run.
  if (!lastChargedPeriodStart) return billingPeriod

  const nextDueOnOrAfter = addMonthsToIsoDate(String(lastChargedPeriodStart), intervalMonths)
  return billingPeriod.period_start >= nextDueOnOrAfter ? billingPeriod : null
}

/**
 * The span of service a charge covers, used for invoice line labels.
 * Monthly charges cover the billing period itself; longer frequencies cover
 * the interval starting at the billing period.
 */
export function getRecurringChargeCoverage(
  frequency: string | null | undefined,
  billingPeriod: RecurringBillingPeriod
): { start: string; end: string } {
  const intervalMonths = getRecurringChargeIntervalMonths(frequency)
  if (intervalMonths <= 1) {
    return { start: billingPeriod.period_start, end: billingPeriod.period_end }
  }
  const nextStart = addMonthsToIsoDate(billingPeriod.period_start, intervalMonths)
  const endUtc = new Date(`${nextStart}T00:00:00.000Z`)
  endUtc.setUTCDate(endUtc.getUTCDate() - 1)
  return { start: billingPeriod.period_start, end: endUtc.toISOString().slice(0, 10) }
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatUkDate(isoDate: string): string {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return String(isoDate || '')
  return `${Number(match[3])} ${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`
}

/**
 * Keeps the existing period suffix formats working: 2026-Q1 becomes Q1 2026,
 * a bare year stays as-is, and a month stays as 2026-07.
 */
export function formatRecurringPeriodLabel(periodYyyymm: string | null | undefined): string {
  const raw = String(periodYyyymm || '')
  const quarterly = raw.match(/^(\d{4})-Q(\d)$/)
  if (quarterly) return `Q${quarterly[2]} ${quarterly[1]}`
  if (/^\d{4}$/.test(raw)) return raw
  return raw.match(/^\d{4}-\d{2}/)?.[0] || raw
}

/**
 * A readable span for a charge that covers more than one month, or null when
 * the charge only covers the month it is billed in.
 */
export function formatRecurringCoverageSpan(
  coverageStart: string | null | undefined,
  coverageEnd: string | null | undefined
): string | null {
  const start = String(coverageStart || '')
  const end = String(coverageEnd || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
  if (start.slice(0, 7) === end.slice(0, 7)) return null
  return `${formatUkDate(start)} to ${formatUkDate(end)}`
}

/**
 * Invoice line description for a recurring charge instance.
 *
 * Quarterly and annual charges state the span they cover. Monthly charges keep
 * the existing behaviour: a suffix only when the line is a carry-forward from
 * an earlier month than the one being invoiced.
 */
export function buildRecurringChargeDescription(input: {
  description: string | null | undefined
  periodYyyymm: string | null | undefined
  coverageStart?: string | null
  coverageEnd?: string | null
  currentPeriodYyyymm: string
}): string {
  const base = String(input.description || '')

  const coverage = formatRecurringCoverageSpan(input.coverageStart, input.coverageEnd)
  if (coverage) return `${base} (${coverage})`

  const periodLabel = formatRecurringPeriodLabel(input.periodYyyymm)
  return periodLabel && periodLabel !== input.currentPeriodYyyymm ? `${base} (${periodLabel})` : base
}

/**
 * Builds a lookup of the most recent period_start per recurring charge,
 * ignoring anything from the current billing period onwards so that re-running
 * a period stays idempotent.
 */
export function buildLastChargedPeriodStarts(
  instances: Array<{ recurring_charge_id: string | null; period_start: string | null }> | null | undefined,
  currentPeriodStart: string
): Map<string, string> {
  const latest = new Map<string, string>()
  for (const row of instances || []) {
    const chargeId = row?.recurring_charge_id ? String(row.recurring_charge_id) : ''
    const periodStart = row?.period_start ? String(row.period_start) : ''
    if (!chargeId || !periodStart) continue
    if (periodStart >= currentPeriodStart) continue
    const existing = latest.get(chargeId)
    if (!existing || periodStart > existing) latest.set(chargeId, periodStart)
  }
  return latest
}
