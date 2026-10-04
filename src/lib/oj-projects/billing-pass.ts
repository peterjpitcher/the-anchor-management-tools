/**
 * When the monthly Orange Jelly billing pass runs, and when it stops.
 *
 * PURE: no database, no clock, no environment. The billing cron
 * (src/app/api/cron/oj-projects-billing/route.ts) passes in today's London date and the
 * month's pass record, and does what this says.
 *
 * The job used to bill on the 1st of the month whatever the day, at 01:05 UTC, so invoices
 * landed in the small hours of a Sunday. It also ran exactly once: a run cut short after one
 * client left the rest unbilled until the following month, and nothing said so. Now
 * (spec R4, tasks/spec-2026-10-04-invoice-issuing-and-chasing.md):
 *
 *   - the job is scheduled every weekday at 09:05 UTC
 *   - the pass for last month starts on the first WEEKDAY of the month
 *   - one record per billed month says whether that pass has finished (a `cron_job_runs` row,
 *     see billing-pass-record.ts). Until it says finished, every weekday run up to the 7th
 *     carries on with the same pass
 *   - once it is finished, nothing more is billed that month
 *   - a pass still unfinished on the 8th is given up on, with one alert
 *
 * Carrying on is safe because the route allows one billing run per client per month: a client
 * whose run is already 'sent' is skipped, so only the clients the earlier run never reached, or
 * left failed or half done, are billed.
 *
 * All dates are London calendar dates (YYYY-MM-DD). Bank holidays are not treated as
 * non-working days, as elsewhere in the invoice jobs.
 */
import { getIsoWeekday, shiftIsoDate } from '@/lib/dateUtils'

/** `cron_job_runs.job_name` for the pass record. Its `run_key` is the billed month, 'YYYY-MM'. */
export const BILLING_PASS_JOB_NAME = 'oj-projects-billing-pass'

/** The last day of the month on which an unfinished pass is still carried on. */
export const BILLING_PASS_LAST_DAY = 7

/**
 * The first billed month that has a pass record: October 2026, billed in November 2026.
 *
 * September 2026 was billed on 1 October under the old rule and left no record. Without this
 * line the first scheduled run after go-live would read "no record" as "not finished": in the
 * first week of October it would re-open September's pass and could send invoices nobody
 * expected, and after that it would raise a false "did not finish" alert. Earlier months are
 * left exactly as the old rule left them. A run with `force` is not affected.
 */
export const FIRST_BILLED_MONTH_WITH_PASS_RECORD = '2026-10'

type BillingPassDecision =
  | { action: 'run'; reason: 'forced' | 'pass_open' }
  | {
      action: 'skip'
      reason:
        | 'invalid_date'
        | 'before_pass_records'
        | 'pass_completed'
        | 'pass_abandoned'
        | 'before_first_weekday'
        | 'not_a_weekday'
    }
  | { action: 'alert_unfinished'; reason: 'window_closed' }

/**
 * The first Monday to Friday of the month `isoDate` falls in: the 1st, or the Monday after
 * when the 1st is a Saturday or a Sunday. Null for a date that cannot be read.
 */
export function firstWeekdayOfMonth(isoDate: string): string | null {
  const first = `${String(isoDate).slice(0, 7)}-01`
  const weekday = getIsoWeekday(first)
  if (weekday === null) return null
  return shiftIsoDate(first, weekday === 6 ? 2 : weekday === 7 ? 1 : 0)
}

export function decideBillingPass(input: {
  /** Today in London, YYYY-MM-DD. */
  todayIso: string
  /** The month being billed (last month), 'YYYY-MM'. Also the pass record's key. */
  billedMonth: string
  /** `?force=true`: skips every check here, as it always has. The preview screen uses it. */
  force: boolean
  /** The pass record for `billedMonth`, or null when the pass has not started. */
  record: { status: string } | null
}): BillingPassDecision {
  if (input.force) return { action: 'run', reason: 'forced' }

  const weekday = getIsoWeekday(input.todayIso)
  const firstWeekday = firstWeekdayOfMonth(input.todayIso)
  // Fail closed: a date we cannot read is never a reason to raise invoices.
  if (weekday === null || firstWeekday === null) return { action: 'skip', reason: 'invalid_date' }

  if (input.billedMonth < FIRST_BILLED_MONTH_WITH_PASS_RECORD) {
    return { action: 'skip', reason: 'before_pass_records' }
  }

  if (input.record?.status === 'completed') return { action: 'skip', reason: 'pass_completed' }
  // 'failed' is written only when the pass was given up on, after the alert. It is how the
  // record remembers that the alert went, so it is raised once and not every weekday after.
  if (input.record?.status === 'failed') return { action: 'skip', reason: 'pass_abandoned' }

  // The 1st, or the 1st and 2nd, at a weekend: the pass has not started yet.
  if (input.todayIso < firstWeekday) return { action: 'skip', reason: 'before_first_weekday' }
  if (weekday > 5) return { action: 'skip', reason: 'not_a_weekday' }

  const dayOfMonth = Number(input.todayIso.slice(8, 10))
  if (dayOfMonth > BILLING_PASS_LAST_DAY) return { action: 'alert_unfinished', reason: 'window_closed' }

  return { action: 'run', reason: 'pass_open' }
}
