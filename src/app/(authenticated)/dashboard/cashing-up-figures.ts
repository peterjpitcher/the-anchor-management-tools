import { getISOWeek } from 'date-fns'
import { getIsoWeekday, shiftIsoDate } from '@/lib/dateUtils'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * The dashboard's cashing-up card: this week's takings so far, last week's, the same ISO week last
 * year, this week's target to the last completed day, and the last 14 days for the chart.
 *
 * Two stages: the site, then one parallel batch. Every sessions figure except last year's comes
 * from a single read of the last 14 days, because this week (Monday to today) and last week
 * (the Monday to Sunday before it) always fall inside today minus 13 days to today. Dates are
 * London calendar dates handled as YYYY-MM-DD strings (dateUtils), never a Date's local clock.
 *
 * Moved out of dashboard-data.ts on 18 November 2026 (page load performance, spec section 5.4):
 * it was four serial stages and six queries. The figures are pinned to the old code by
 * tests/app/dashboardCashingUpFigures.test.ts.
 */

type AdminClient = ReturnType<typeof createAdminClient>

export type CashingUpFigures = {
  thisWeekTotal: number
  thisWeekTarget: number
  lastWeekTotal: number
  lastYearTotal: number
  sessionsSubmittedCount: number
  completedThrough: string | null
  dailySessions: Array<{ date: string; amount: number; target: number }>
}

type SessionRow = { total_counted_amount: number | string | null; session_date: string; status: string | null }
type TargetRow = { day_of_week: number; effective_from: string; target_amount: number }

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function shift(isoDate: string, days: number): string {
  const shifted = shiftIsoDate(isoDate, days)
  if (!shifted) throw new Error(`Invalid cashing-up date ${isoDate}`)
  return shifted
}

/** 0 = Sunday to 6 = Saturday, the convention cashup_targets.day_of_week uses. */
function dayOfWeek(isoDate: string): number {
  const isoWeekday = getIsoWeekday(isoDate)
  if (isoWeekday === null) throw new Error(`Invalid cashing-up date ${isoDate}`)
  return isoWeekday % 7
}

/** The Monday of the week holding this date. */
function mondayOf(isoDate: string): string {
  return shift(isoDate, -(((dayOfWeek(isoDate) + 6) % 7)))
}

/** ISO week number of a calendar date; noon local time so the host zone cannot move the day. */
function isoWeekNumber(isoDate: string): number {
  return getISOWeek(new Date(`${isoDate}T12:00:00`))
}

function sumAmounts(rows: Array<{ total_counted_amount: number | string | null }>): number {
  return rows.reduce((sum, row) => sum + Number(row.total_counted_amount || 0), 0)
}

/** The ranges the card reads, from today's London date alone. */
export function cashingUpRanges(todayIso: string): {
  weekStart: string
  lastWeekStart: string
  lastWeekEnd: string
  lastYearStart: string
  lastYearEnd: string
  fourteenDaysAgo: string
} {
  const weekStart = mondayOf(todayIso)
  const lastWeekStart = shift(weekStart, -7)
  // Same ISO week number last year, so weekdays line up. As before: the seed is 1 June of the
  // calendar year before this week's Monday, moved by whole weeks to that week number.
  const seed = `${Number(weekStart.slice(0, 4)) - 1}-06-01`
  const lastYearStart = shift(mondayOf(seed), (isoWeekNumber(weekStart) - isoWeekNumber(seed)) * 7)
  return {
    weekStart,
    lastWeekStart,
    lastWeekEnd: shift(lastWeekStart, 6),
    lastYearStart,
    lastYearEnd: shift(lastYearStart, 6),
    fourteenDaysAgo: shift(todayIso, -13),
  }
}

/** Null when there is no site, as before: the card then shows its zero figures. */
export async function loadCashingUpFigures(supabase: AdminClient, todayIso: string): Promise<CashingUpFigures | null> {
  const { data: site } = await supabase.from('sites').select('id').limit(1).single()
  if (!site) return null

  const { weekStart, lastWeekStart, lastWeekEnd, lastYearStart, lastYearEnd, fourteenDaysAgo } = cashingUpRanges(todayIso)

  const [recentRes, lastYearRes, targetsRes] = await Promise.all([
    supabase.from('cashup_sessions')
      .select('total_counted_amount, session_date, status')
      .eq('site_id', site.id)
      // A voided cash-up stays on record but is out of every total (BK-219).
      .is('voided_at', null)
      .gte('session_date', fourteenDaysAgo)
      .lte('session_date', todayIso)
      .order('session_date', { ascending: true }),
    supabase.from('cashup_sessions')
      .select('total_counted_amount')
      .eq('site_id', site.id)
      .is('voided_at', null)
      .gte('session_date', lastYearStart)
      .lte('session_date', lastYearEnd),
    supabase.from('cashup_targets')
      .select('day_of_week, effective_from, target_amount')
      .eq('site_id', site.id)
      .order('effective_from', { ascending: false }),
  ])

  const recent = (recentRes.data ?? []) as SessionRow[]
  const targets = (targetsRes.data ?? []) as TargetRow[]
  // Latest target in force on a date: targets are newest first.
  const targetFor = (isoDate: string) =>
    targets.find((target) => target.day_of_week === dayOfWeek(isoDate) && target.effective_from <= isoDate)

  const thisWeek = recent.filter((session) => session.session_date >= weekStart)
  const lastWeek = recent.filter((session) => session.session_date >= lastWeekStart && session.session_date <= lastWeekEnd)

  // The latest completed (not draft) cash-up this week sets how far "this week" runs.
  const lastCompletedIso = thisWeek
    .filter((session) => session.status && session.status !== 'draft')
    .reduce<string | null>((latest, session) => (latest === null || session.session_date > latest ? session.session_date : latest), null)
  const thisWeekEnd = lastCompletedIso ?? shift(weekStart, -1)
  const thisWeekCompleted = thisWeek.filter((session) => session.session_date <= thisWeekEnd)

  let thisWeekTarget = 0
  if (lastCompletedIso) {
    for (let day = weekStart; day <= thisWeekEnd; day = shift(day, 1)) {
      const target = targetFor(day)
      if (target) thisWeekTarget += target.target_amount
    }
  }

  return {
    thisWeekTotal: sumAmounts(thisWeekCompleted),
    thisWeekTarget,
    lastWeekTotal: sumAmounts(lastWeek),
    lastYearTotal: sumAmounts((lastYearRes.data ?? []) as SessionRow[]),
    // A NULL status counts here, as it always has; the SQL `neq('status', 'draft')` the chart
    // used to read through excluded NULL, so the chart filter below keeps that too.
    sessionsSubmittedCount: thisWeekCompleted.filter((session) => session.status !== 'draft').length,
    completedThrough: lastCompletedIso ? WEEKDAY_NAMES[dayOfWeek(lastCompletedIso)] : null,
    dailySessions: recent
      .filter((session) => session.session_date && session.status !== null && session.status !== 'draft')
      .map((session) => {
        const target = targetFor(session.session_date)
        return {
          date: session.session_date,
          amount: Number(session.total_counted_amount || 0),
          target: target ? Number(target.target_amount) : 0,
        }
      }),
  }
}
