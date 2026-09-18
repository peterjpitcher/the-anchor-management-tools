import { scoreTimeliness } from '@/lib/checklists/scoring'
import { coalesceTradingWindow } from '@/lib/checklists/trading-window'
import type { HoursRow, ScoredInstance } from '@/lib/checklists/types'
import { whenLondonClockReaches } from '@/lib/dateUtils'
import { disambiguatedNames } from '@/lib/employees/display-name'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { hasMinimumHistory } from '../compare'
import { formatCount, formatDateWithYear, formatDayDate, formatPercent, joinWithAnd, plural } from '../format'
import { mergeSignals } from '../signals'
import { CHECKLISTS, COLLECTION_STARTS } from '../thresholds'
import { addDays, dateRange, datesIn, isInRange, londonDateOf } from '../windows'
import type {
  DateRange,
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md, section 5.11.
//
// Scope: checklist_task_instances by business_date (the checklist trading date, used as
// stored). Only locked instances count, and only on settled days. The overnight sweep locks
// a day at about 05:00 London the next morning. A day is settled when every instance is
// either locked or an any-time check still inside its grace period (pending, grace_until
// after the report instant): those can still be done, so they are ignored (spec: pending
// tasks are ignored) rather than holding back the whole day. Live, 18 Sep 2026: at 06:00 on
// three of the last five Fridays, one or two any-time checks from Wednesday or Thursday were
// still open. Any other unlocked instance means the sweep has not judged the day yet, so the
// whole day waits: counting a half-locked day showed false low completion on the checklist
// insights screen (src/app/actions/checklists-insights.ts), which leaves such days out too.
//
// A day left out is never silent. Before the sweep is due it only reads "not locked yet".
// Once a check on it is past the time the sweep should have locked it (05:30 London on the
// first morning after the day ends or its grace runs out), the sweep has failed or run late:
// that is an amber issue, the on-track win is held back whenever any day is left out, and
// figures for a week with no day counted read "Not judged yet", never a false 0. Live: the
// lock ran a day late until 15 Aug 2026, leaving 42 to 51 Thursday checks unlocked at 06:00
// on four Fridays; since then every check has locked by 05:07.
//
// Completion = done / (done + missed); skipped and not applicable are excluded, pending is
// ignored. "Late" is was_late (completed after the grace deadline), the same rule the
// on-time score in src/lib/checklists/scoring.ts uses (live: identical on every done row).
//
// Names (spec decision 13): per-person figures and repeat missers name staff whose
// performance is being judged, so they appear on the page only, in lists and in signals
// marked emailSafe false. The email gets counts. Every action text is name-free.
//
// Accountable person = accountable_employee_id, set at generation from whoever the rota
// had on shift in that department when the check fell due. Misses without one are
// "unassigned". Any-time checks never have one (live, 18 Sep 2026), so their misses are
// always unassigned; a timed check is unassigned only when nobody was on the rota.

const INSTANCE_COLUMNS = 'id, business_date, slot, department, title_snapshot, state, locked_at, was_late, completed_by_employee_id, completed_at, grace_until, accountable_employee_id, value_breach, value_recorded, value_unit, value_min, value_max'

interface InstanceRow {
  id: string
  business_date: string
  slot: string
  department: string
  title_snapshot: string
  state: string
  locked_at: string | null
  was_late: boolean | null
  completed_by_employee_id: string | null
  completed_at: string | null
  grace_until: string
  accountable_employee_id: string | null
  value_breach: boolean | null
  value_recorded: number | string | null
  value_unit: string | null
  value_min: number | string | null
  value_max: number | string | null
}

interface SpotCheckRow {
  id: string
  business_date: string
  state: string
}

interface ExpectationRow {
  business_date: string
  expected: number | null
}

interface EmployeeRow {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
}

interface SpecialHoursRow extends HoursRow {
  date: string
}

interface Tally {
  done: number
  missed: number
  late: number
}

interface Person {
  id: string
  done: number
  late: number
  missed: number
  missedThisWeek: number
  scored: ScoredInstance[]
}

type DayKind = 'settled' | 'unsettled' | 'empty_open' | 'closed'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function tallyOf(rows: InstanceRow[]): Tally {
  const tally: Tally = { done: 0, missed: 0, late: 0 }
  for (const row of rows) {
    if (row.state === 'done') {
      tally.done += 1
      if (row.was_late) tally.late += 1
    } else if (row.state === 'missed') {
      tally.missed += 1
    }
  }
  return tally
}

function completionOf(tally: Tally): number | null {
  const denominator = tally.done + tally.missed
  return denominator === 0 ? null : tally.done / denominator
}

function lateShareOf(done: number, late: number): number | null {
  return done === 0 ? null : late / done
}

/**
 * "96.5%", or "97%" when whole. Truncated rather than rounded, so 89.96% reads 89.9% and
 * never appears to meet a 90% line it missed.
 */
function percent(ratio: number): string {
  const truncated = Math.floor(ratio * 1000 + 1e-9) / 1000
  const text = formatPercent(truncated, 1)
  return text.endsWith('.0%') ? `${text.slice(0, -3)}%` : text
}

function slotLabel(slot: string): string {
  if (slot === 'open') return 'opening'
  if (slot === 'close') return 'closing'
  if (slot === 'anytime') return 'any time'
  const match = /^(\d{1,2}):(\d{2})/.exec(slot)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : slot
}

function capitalise(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text
}

function placeOf(row: Pick<InstanceRow, 'department' | 'slot'>): string {
  return `${row.department}, ${slotLabel(row.slot)}`
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function unitSuffix(unit: string | null): string {
  const clean = unit?.trim()
  if (!clean) return ''
  if (clean === 'degC') return '°C'
  return /^[%°]/.test(clean) ? clean : ` ${clean}`
}

function reading(value: number | string | null, unit: string | null): string | null {
  const number = toNumber(value)
  return number === null ? null : `${number}${unitSuffix(unit)}`
}

function allowedRange(row: InstanceRow): string {
  const min = reading(row.value_min, row.value_unit)
  const max = reading(row.value_max, row.value_unit)
  if (min && max) return `outside ${min} to ${max}`
  if (max) return `above the ${max} limit`
  if (min) return `below the ${min} limit`
  return 'outside its range'
}

function staffCount(n: number): string {
  return n === 1 ? '1 member of staff' : `${n} staff`
}

function londonInstantMs(date: string, time: string): number {
  const instant = whenLondonClockReaches(date, time)
  if (!instant) throw new Error(`Invalid checklist date ${date}`)
  return instant.getTime()
}

/**
 * When the overnight sweep should have locked this unlocked check by. A done, skipped or not
 * applicable check locks at the first sweep after its business day ends (05:00 London the
 * next morning); a pending one becomes missed at the first sweep after its grace runs out.
 * The sweep runs from 05:00 London, so either is due by 05:30 on the first morning at or
 * after that point.
 */
function sweepDeadlineMs(row: InstanceRow): number {
  const readyAt = row.state === 'pending'
    ? Date.parse(row.grace_until)
    : londonInstantMs(addDays(row.business_date, 1), CHECKLISTS.sweepRunsAt)
  let morning = londonDateOf(new Date(readyAt))
  if (readyAt > londonInstantMs(morning, CHECKLISTS.sweepRunsAt)) morning = addDays(morning, 1)
  return londonInstantMs(morning, CHECKLISTS.sweepLockedBy)
}

/** "Mon 21 Sep" or "Mon 21 Sep and Tue 22 Sep", or "3 days" when there are more. */
function daysText(dates: string[]): string {
  return dates.length <= 2 ? joinWithAnd(dates.map(formatDayDate)) : plural(dates.length, 'day')
}

function ragForRate(rate: number | null): Rag | undefined {
  if (rate === null) return undefined
  if (rate < CHECKLISTS.redBelow) return 'red'
  if (rate < CHECKLISTS.amberBelow) return 'amber'
  return undefined
}

// ---------------------------------------------------------------------------
// Reads (all through ctx.db, read only)
// ---------------------------------------------------------------------------

function readInstances(ctx: SectionContext, range: DateRange): Promise<InstanceRow[]> {
  return fetchAllRows<InstanceRow>(
    (from, to) => ctx.db
      .from('checklist_task_instances')
      .select(INSTANCE_COLUMNS)
      .gte('business_date', range.start)
      .lte('business_date', range.end)
      .order('business_date')
      .order('id')
      .range(from, to),
    { label: 'insights checklist instances' },
  )
}

function readSpotChecks(ctx: SectionContext, range: DateRange): Promise<SpotCheckRow[]> {
  return fetchAllRows<SpotCheckRow>(
    (from, to) => ctx.db
      .from('checklist_spot_checks')
      .select('id, business_date, state')
      .gte('business_date', range.start)
      .lte('business_date', range.end)
      .order('id')
      .range(from, to),
    { label: 'insights checklist spot checks' },
  )
}

function readExpectations(ctx: SectionContext, range: DateRange): Promise<ExpectationRow[]> {
  return fetchAllRows<ExpectationRow>(
    (from, to) => ctx.db
      .from('checklist_spot_check_expectations')
      .select('business_date, expected')
      .gte('business_date', range.start)
      .lte('business_date', range.end)
      .order('business_date')
      .range(from, to),
    { label: 'insights checklist spot check expectations' },
  )
}

async function readNames(ctx: SectionContext, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (ids.length === 0) return names
  const rows = await fetchAllRows<EmployeeRow>(
    (from, to) => ctx.db
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name')
      .in('employee_id', ids)
      .order('employee_id')
      .range(from, to),
    { label: 'insights checklist staff names' },
  )
  for (const { employee, name } of disambiguatedNames(rows)) names.set(employee.employee_id, name)
  return names
}

/**
 * Which of these dates the venue was closed, from special hours over the effective business
 * hours (the checklist engine's own resolver). Only asked for days with no checklist records
 * at all, which is rare. If the hours cannot be read the days are treated as open, so the
 * gap is still shown rather than hidden.
 */
async function closedDates(ctx: SectionContext, dates: string[]): Promise<Set<string>> {
  const closed = new Set<string>()
  if (dates.length === 0) return closed
  try {
    const special = await fetchAllRows<SpecialHoursRow>(
      (from, to) => ctx.db
        .from('special_hours')
        .select('date, opens, closes, is_closed')
        .in('date', dates)
        .order('date')
        .range(from, to),
      { label: 'insights checklist special hours' },
    )
    const specialByDate = new Map(special.map((row) => [row.date, row]))
    const results = await Promise.all(dates.map(async (date) => {
      const { data, error } = await ctx.db.rpc('business_hours_for_date', { p_date: date })
      if (error) throw new Error('business hours could not be read')
      const business = ((data ?? []) as HoursRow[])[0] ?? null
      const window = coalesceTradingWindow(specialByDate.get(date) ?? null, business)
      return { date, closed: 'isClosed' in window && window.isClosed }
    }))
    for (const result of results) if (result.closed) closed.add(result.date)
  } catch {
    return new Set()
  }
  return closed
}

// ---------------------------------------------------------------------------
// Headline: the one-line answer to "are the checks being done properly,
// consistently and by the right people?" Counts only, never names.
// ---------------------------------------------------------------------------

interface HeadlineFacts {
  rate: number | null
  missed: number
  lateShare: number | null
  repeatCount: number
  breaches: number
  spotNotRecorded: number
  unassigned: number
  settledDays: number
  /** Days not locked yet, before the sweep was due to lock them. */
  waitingDates: string[]
  /** Days the sweep should have locked by now and has not. */
  overdueDates: string[]
  openEmptyDates: string[]
}

function headlineFor(f: HeadlineFacts): string {
  if (f.rate === null) {
    if (f.overdueDates.length > 0) return `Checks for ${daysText(f.overdueDates)} were not locked overnight, so completion cannot be judged.`
    if (f.settledDays > 0) return 'No checks counted this week: every check was skipped.'
    if (f.openEmptyDates.length > 0) return 'No checklist records this week, so completion cannot be judged.'
    if (f.waitingDates.length > 0) return 'This week\'s checks are not locked yet, so completion cannot be judged.'
    return 'The venue was closed all week, so no checks were due.'
  }
  const pct = percent(f.rate)
  const issues: string[] = []
  if (f.rate < CHECKLISTS.redBelow) issues.push(`only ${pct} done (${f.missed} missed)`)
  else if (f.rate < CHECKLISTS.amberBelow) issues.push(`${pct} done, below ${percent(CHECKLISTS.amberBelow)}`)
  if (f.repeatCount > 0) issues.push(`${staffCount(f.repeatCount)} repeatedly missed checks`)
  if (f.lateShare !== null && f.lateShare > CHECKLISTS.lateShareAmber) issues.push(`${percent(f.lateShare)} done late`)
  if (f.breaches > 0) issues.push(`${plural(f.breaches, 'reading')} out of range`)
  if (f.spotNotRecorded > 0) issues.push(`${plural(f.spotNotRecorded, 'spot check')} not recorded`)
  if (f.unassigned >= CHECKLISTS.unassignedMissesAmber) issues.push(`${plural(f.unassigned, 'miss', 'misses')} with no one accountable`)
  if (f.overdueDates.length > 0) issues.push(`${daysText(f.overdueDates)} not locked overnight`)
  if (f.openEmptyDates.length > 0) issues.push(`no records for ${daysText(f.openEmptyDates)}`)
  if (f.waitingDates.length > 0) issues.push(`${daysText(f.waitingDates)} not locked yet`)

  if (issues.length === 0) {
    return `Checks are on track: ${pct} done this week, ${percent(f.lateShare ?? 0)} late, and no repeat missers.`
  }
  if (f.rate < CHECKLISTS.redBelow) return `Checks are not being done properly: ${joinWithAnd(issues)}.`
  if (f.rate < CHECKLISTS.amberBelow) return `Checks are slipping: ${joinWithAnd(issues)}.`
  return `Checks are mostly on track at ${pct} done, but ${joinWithAnd(issues)}.`
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildChecklistsSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { windows } = ctx
  const thisWeek = windows.thisWeek
  const fourWeeks = windows.last28
  // Index 0 is this week; the last entry is the oldest of the weeks shown.
  const weeks: DateRange[] = Array.from({ length: CHECKLISTS.weeksShown }, (_, index) =>
    dateRange(addDays(thisWeek.start, -7 * index), addDays(thisWeek.end, -7 * index)))
  const fetchRange = dateRange(weeks[weeks.length - 1].start, thisWeek.end)

  const [instances, spotChecks, expectations] = await Promise.all([
    readInstances(ctx, fetchRange),
    readSpotChecks(ctx, thisWeek),
    readExpectations(ctx, thisWeek),
  ])

  // Settled days: every instance locked, or pending and still inside its grace period (in
  // practice an any-time check). Only locked rows are counted; pending rows never are.
  const nowMs = ctx.now.getTime()
  const isStillOpen = (row: InstanceRow): boolean =>
    row.locked_at === null && row.state === 'pending' && Date.parse(row.grace_until) > nowMs
  const byDate = new Map<string, InstanceRow[]>()
  for (const row of instances) {
    const list = byDate.get(row.business_date) ?? []
    list.push(row)
    byDate.set(row.business_date, list)
  }
  const settledDates = new Set<string>()
  for (const [date, rows] of byDate) {
    const judged = rows.every((row) => row.locked_at !== null || isStillOpen(row))
    if (judged && rows.some((row) => row.locked_at !== null)) settledDates.add(date)
  }
  const settledRows = instances.filter((row) => settledDates.has(row.business_date) && row.locked_at !== null)
  const rowsIn = (range: DateRange): InstanceRow[] => settledRows.filter((row) => isInRange(row.business_date, range))

  // This week's days: settled, not locked yet, closed, or open with no records at all.
  const weekDates = datesIn(thisWeek)
  const emptyDates = weekDates.filter((date) => !byDate.has(date))
  const closed = await closedDates(ctx, emptyDates)
  const dayKinds = new Map<string, DayKind>(weekDates.map((date) => {
    if (settledDates.has(date)) return [date, 'settled']
    if (byDate.has(date)) return [date, 'unsettled']
    return [date, closed.has(date) ? 'closed' : 'empty_open']
  }))
  const datesOfKind = (kind: DayKind): string[] => weekDates.filter((date) => dayKinds.get(date) === kind)
  const openEmptyDates = datesOfKind('empty_open')
  const unsettledDates = datesOfKind('unsettled')
  const settledThisWeek = datesOfKind('settled')
  // Checks the sweep should have locked by now and has not: the sweep failed or ran late.
  const overdueRows = instances.filter((row) =>
    isInRange(row.business_date, thisWeek) && row.locked_at === null && !isStillOpen(row) && sweepDeadlineMs(row) <= nowMs)
  const overdueDateSet = new Set(overdueRows.map((row) => row.business_date))
  const overdueDates = unsettledDates.filter((date) => overdueDateSet.has(date))
  const waitingDates = unsettledDates.filter((date) => !overdueDateSet.has(date))
  const daysLeftOut = unsettledDates.length + openEmptyDates.length

  // This week.
  const weekRows = rowsIn(thisWeek)
  const week = tallyOf(weekRows)
  const rate = completionOf(week)
  const lateShare = lateShareOf(week.done, week.late)
  const weekMisses = weekRows
    .filter((row) => row.state === 'missed')
    .sort((a, b) => a.business_date.localeCompare(b.business_date) || a.title_snapshot.localeCompare(b.title_snapshot) || a.id.localeCompare(b.id))
  const unassignedMisses = weekMisses.filter((row) => !row.accountable_employee_id)
  const unassigned = unassignedMisses.length
  const unassignedAnyTime = unassignedMisses.filter((row) => row.slot === 'anytime').length
  // Checks on counted days that can still be done: left out until they lock.
  const stillOpen = instances.filter((row) =>
    isInRange(row.business_date, thisWeek) && settledDates.has(row.business_date) && isStillOpen(row))
  const breaches = weekRows
    .filter((row) => row.state === 'done' && row.value_breach)
    .sort((a, b) => a.business_date.localeCompare(b.business_date) || a.id.localeCompare(b.id))

  // Spot checks on settled days only: an unsettled day's draw can still be recorded.
  const settledSpotChecks = spotChecks.filter((row) => settledDates.has(row.business_date))
  const spotDrawn = settledSpotChecks.length
  const spotRecorded = settledSpotChecks.filter((row) => row.state === 'recorded').length
  const spotNotRecorded = spotDrawn - spotRecorded
  const spotExpected = expectations
    .filter((row) => settledDates.has(row.business_date))
    .reduce((sum, row) => sum + (row.expected ?? 0), 0)

  // People over 4 weeks.
  const fourWeekRows = rowsIn(fourWeeks)
  const people = new Map<string, Person>()
  const personFor = (id: string): Person => {
    const existing = people.get(id)
    if (existing) return existing
    const created: Person = { id, done: 0, late: 0, missed: 0, missedThisWeek: 0, scored: [] }
    people.set(id, created)
    return created
  }
  for (const row of fourWeekRows) {
    if (row.state === 'done' && row.completed_by_employee_id) {
      const person = personFor(row.completed_by_employee_id)
      person.done += 1
      if (row.was_late) person.late += 1
      if (row.completed_at) {
        person.scored.push({ completedAt: new Date(row.completed_at), graceUntil: new Date(row.grace_until) })
      }
    } else if (row.state === 'missed' && row.accountable_employee_id) {
      const person = personFor(row.accountable_employee_id)
      person.missed += 1
      if (isInRange(row.business_date, thisWeek)) person.missedThisWeek += 1
    }
  }
  const names = await readNames(ctx, [...people.keys()].sort())
  const nameOf = (id: string): string => names.get(id) ?? 'Unknown member of staff'
  const byName = (a: Person, b: Person): number => nameOf(a.id).localeCompare(nameOf(b.id)) || a.id.localeCompare(b.id)

  const repeatMissers = [...people.values()]
    .filter((person) => person.missedThisWeek >= CHECKLISTS.repeatMissesThisWeek || person.missed >= CHECKLISTS.repeatMissesFourWeeks)
    .sort((a, b) => b.missedThisWeek - a.missedThisWeek || b.missed - a.missed || byName(a, b))

  // Links.
  const insightsLink = (range: DateRange): string => ctx.link(`/checklists/manage/insights?from=${range.start}&to=${range.end}`)
  const problemsLink = (range: DateRange): string => ctx.link(`/checklists/manage/problems?from=${range.start}&to=${range.end}`)
  const dayLink = (date: string): string => ctx.link(`/checklists/${date}`)

  // -------------------------------------------------------------------------
  // Signals, in the spec's precedence order.
  // -------------------------------------------------------------------------
  const signals: InsightSignal[] = []
  const missedAction = {
    text: `Find out why ${plural(week.missed, 'check was', 'checks were')} missed this week`,
    href: problemsLink(thisWeek),
    target: 'list' as const,
    impact: 'safety' as const,
  }

  if (rate !== null && rate < CHECKLISTS.redBelow) {
    signals.push({
      key: 'checklists.completion.low',
      rag: 'red',
      kind: 'issue',
      text: `Only ${percent(rate)} of checks were done this week: ${plural(week.missed, 'check')} missed.`,
      emailSafe: true,
      action: missedAction,
    })
  }

  if (repeatMissers.length > 0) {
    const count = repeatMissers.length
    signals.push({
      key: 'checklists.repeat_missers',
      rag: 'red',
      kind: 'issue',
      text: `${staffCount(count)} repeatedly missed checks: ${CHECKLISTS.repeatMissesThisWeek} or more this week, or ${CHECKLISTS.repeatMissesFourWeeks} or more in 4 weeks.`,
      emailSafe: true,
      action: {
        text: count === 1
          ? 'Talk to the member of staff who keeps missing checks'
          : `Talk to the ${count} staff who keep missing checks`,
        href: problemsLink(fourWeeks),
        target: 'list',
        impact: 'staffing',
      },
    })
    // The named detail, for the page only.
    for (const person of repeatMissers) {
      signals.push({
        key: `checklists.repeat_misser.${person.id}`,
        entity: `employee:${person.id}`,
        rag: 'red',
        kind: 'issue',
        text: `${nameOf(person.id)} missed ${plural(person.missedThisWeek, 'check')} this week and ${person.missed} in 4 weeks while on shift.`,
        emailSafe: false,
      })
    }
  }

  if (rate !== null && rate >= CHECKLISTS.redBelow && rate < CHECKLISTS.amberBelow) {
    signals.push({
      key: 'checklists.completion.watch',
      rag: 'amber',
      kind: 'issue',
      text: `${percent(rate)} of checks were done this week, below ${percent(CHECKLISTS.amberBelow)}: ${plural(week.missed, 'check')} missed.`,
      emailSafe: true,
      action: missedAction,
    })
  }

  if (lateShare !== null && lateShare > CHECKLISTS.lateShareAmber) {
    signals.push({
      key: 'checklists.late',
      rag: 'amber',
      kind: 'issue',
      text: `${percent(lateShare)} of checks were done late this week (${week.late} of ${week.done}).`,
      emailSafe: true,
      action: {
        text: 'Remind the team to complete checks before they fall overdue',
        href: insightsLink(thisWeek),
        target: 'list',
        impact: 'staffing',
      },
    })
  }

  if (breaches.length > 0) {
    const breachSignals: InsightSignal[] = breaches.map((row) => {
      const value = reading(row.value_recorded, row.value_unit) ?? 'a value'
      const day = formatDayDate(row.business_date)
      return {
        key: `checklists.breach.${row.id}`,
        entity: `checklist_instance:${row.id}`,
        rag: 'amber',
        kind: 'issue',
        text: `${row.title_snapshot} read ${value} on ${day}, ${allowedRange(row)}.`,
        emailSafe: true,
        action: {
          text: `Check the ${row.title_snapshot} reading from ${day} (${value})`,
          href: dayLink(row.business_date),
          target: 'list',
          impact: 'safety',
        },
      }
    })
    signals.push(...mergeSignals(breachSignals, {
      above: CHECKLISTS.mergeBreachesAbove,
      key: 'checklists.breaches',
      rag: 'amber',
      text: (count) => `${plural(count, 'reading')} ${count === 1 ? 'was' : 'were'} out of range this week.`,
      action: {
        text: `Follow up ${breaches.length} out-of-range readings`,
        href: problemsLink(thisWeek),
        impact: 'safety',
      },
    }))
  }

  if (spotNotRecorded > 0) {
    signals.push({
      key: 'checklists.spot_checks',
      rag: 'amber',
      kind: 'issue',
      text: `${plural(spotNotRecorded, 'spot check')} drawn this week ${spotNotRecorded === 1 ? 'was' : 'were'} not recorded.`,
      emailSafe: true,
      action: {
        text: 'Record spot checks on the day they are drawn',
        href: ctx.link('/checklists/manage/spot-checks'),
        target: 'list',
        impact: 'housekeeping',
      },
    })
  }

  if (unassigned >= CHECKLISTS.unassignedMissesAmber) {
    const unrostered = unassigned - unassignedAnyTime
    const why = unrostered === 0
      ? 'all any-time checks, which are not assigned to anyone'
      : unassignedAnyTime === 0
        ? 'nobody was on the rota when they fell due'
        : `${unassignedAnyTime} any-time ${unassignedAnyTime === 1 ? 'check' : 'checks'} and ${unrostered} with nobody on the rota`
    signals.push({
      key: 'checklists.unassigned',
      rag: 'amber',
      kind: 'issue',
      text: `${unassigned} missed checks this week had no accountable person: ${why}.`,
      emailSafe: true,
      action: {
        text: 'Agree who picks up checks with no accountable person',
        href: problemsLink(thisWeek),
        target: 'list',
        impact: 'housekeeping',
      },
    })
  }

  // Not a spec row: a day the overnight sweep should have locked and has not is left out of
  // every figure, so it must not pass as green (workspace rule: failures fail visibly).
  if (overdueDates.length > 0) {
    const many = overdueDates.length > 1
    signals.push({
      key: 'checklists.not_locked',
      rag: 'amber',
      kind: 'issue',
      text: `${plural(overdueRows.length, 'check')} from ${joinWithAnd(overdueDates.map(formatDayDate))} ${overdueRows.length === 1 ? 'was' : 'were'} not locked overnight as expected, so ${many ? 'those days are' : 'that day is'} left out of this week's figures.`,
      emailSafe: true,
      action: {
        text: `Have the overnight checklist lock checked: ${plural(overdueDates.length, 'day')} not locked`,
        href: ctx.link('/checklists/manage'),
        target: 'list',
        impact: 'housekeeping',
      },
    })
  }

  // Not a spec row: a week with no records at all while the venue was open must not read
  // as green, because nothing shows the checks were done (spec 1, "incomplete").
  if (settledThisWeek.length === 0 && unsettledDates.length === 0 && openEmptyDates.length > 0) {
    signals.push({
      key: 'checklists.no_records',
      rag: 'amber',
      kind: 'issue',
      text: 'No checklist records this week while the venue was open.',
      emailSafe: true,
      action: {
        text: 'Check the daily checklists are being created',
        href: ctx.link('/checklists/manage'),
        target: 'list',
        impact: 'safety',
      },
    })
  }

  // The win speaks for the whole week, so it waits while any day is left out.
  const hasIssue = signals.some((signal) => signal.kind === 'issue')
  if (rate !== null && rate >= CHECKLISTS.amberBelow && !hasIssue && daysLeftOut === 0) {
    signals.push({
      key: 'checklists.on_track',
      rag: 'green',
      kind: 'win',
      text: `${percent(rate)} of checks were done this week, ${percent(lateShare ?? 0)} late, with no repeat missers.`,
      emailSafe: true,
    })
  }

  // -------------------------------------------------------------------------
  // Metrics (email shows the first four).
  // -------------------------------------------------------------------------
  const lastWeekTally = tallyOf(rowsIn(windows.lastWeek))
  const previousTally = tallyOf(rowsIn(windows.previous4Weeks))
  const lastWeekKnown = hasMinimumHistory(COLLECTION_STARTS.checklists, windows.lastWeek.start)
  const previousKnown = hasMinimumHistory(COLLECTION_STARTS.checklists, windows.previous4Weeks.start)

  const completionComparison = (): string => {
    const parts: string[] = []
    const lastRate = completionOf(lastWeekTally)
    const previousRate = completionOf(previousTally)
    if (lastWeekKnown && lastRate !== null) parts.push(`last week ${percent(lastRate)}`)
    if (previousKnown && previousRate !== null) parts.push(`previous 4 weeks ${percent(previousRate)}`)
    if (parts.length) return parts.join(', ')
    return lastWeekKnown || previousKnown ? 'no earlier records to compare' : 'not enough history yet'
  }

  // With no day of this week counted, completion, missed and late are unknown, not zero.
  const uncounted: string | null = rate !== null
    ? null
    : unsettledDates.length > 0
      ? 'Not judged yet'
      : settledThisWeek.length === 0 && openEmptyDates.length > 0 ? 'No records' : null

  const weekRow = [...weeks].reverse().map((range) => {
    if (range.start === thisWeek.start && uncounted === 'Not judged yet') return 'not judged yet'
    const value = completionOf(tallyOf(rowsIn(range)))
    return value === null ? 'none' : percent(value)
  })

  const metrics: InsightMetric[] = [
    { label: 'Completion', value: rate === null ? uncounted ?? 'None due' : percent(rate), comparison: completionComparison() },
    { label: 'Missed', value: uncounted ?? formatCount(week.missed), comparison: lastWeekKnown ? `last week ${formatCount(lastWeekTally.missed)}` : 'not enough history yet' },
    uncounted
      ? { label: 'Done late', value: uncounted }
      : {
        label: 'Done late',
        value: formatCount(week.late),
        comparison: lateShare === null ? 'no checks done' : `${percent(lateShare)} of checks done`,
      },
    {
      label: `Completion, last ${CHECKLISTS.weeksShown} weeks`,
      value: weekRow.join(', '),
      comparison: `oldest first, weeks ending ${formatDayDate(weeks[weeks.length - 1].end)} to ${formatDayDate(thisWeek.end)}`,
    },
    { label: 'Readings out of range', value: formatCount(breaches.length) },
    {
      label: 'Staff repeatedly missing checks',
      value: formatCount(repeatMissers.length),
      comparison: `${CHECKLISTS.repeatMissesThisWeek} or more this week, or ${CHECKLISTS.repeatMissesFourWeeks} or more in 4 weeks`,
    },
    { label: 'Misses with no accountable person', value: formatCount(unassigned) },
    {
      label: 'Spot checks recorded',
      value: `${formatCount(spotRecorded)} of ${formatCount(spotDrawn)} drawn`,
      ...(spotExpected > 0 ? { comparison: `${formatCount(spotExpected)} expected` } : {}),
    },
  ]

  // -------------------------------------------------------------------------
  // Lists (page only).
  // -------------------------------------------------------------------------
  const dayItems: InsightListItem[] = weekDates.map((date) => {
    const day = formatDayDate(date)
    const kind = dayKinds.get(date)
    if (kind === 'closed') return { text: `${day}: closed` }
    if (kind === 'empty_open') return { text: `${day}: no checklist records`, href: dayLink(date), rag: 'amber' }
    if (kind === 'unsettled') {
      return overdueDateSet.has(date)
        ? { text: `${day}: not locked overnight`, href: dayLink(date), rag: 'amber' }
        : { text: `${day}: not locked yet`, href: dayLink(date) }
    }
    const tally = tallyOf(rowsIn(dateRange(date, date)))
    const dayRate = completionOf(tally)
    const openCount = stillOpen.filter((row) => row.business_date === date).length
    const summary = `${tally.done} done, ${tally.missed} missed, ${tally.late} late${openCount > 0 ? `, ${openCount} still open` : ''}`
    const item: InsightListItem = {
      text: dayRate === null ? `${day}: no checks counted` : `${day}: ${percent(dayRate)} (${summary})`,
      href: dayLink(date),
    }
    const rag = ragForRate(dayRate)
    return rag ? { ...item, rag } : item
  })

  const missItems: InsightListItem[] = weekMisses.map((row) => ({
    text: `${formatDayDate(row.business_date)}: ${row.title_snapshot} (${placeOf(row)}), ${row.accountable_employee_id ? nameOf(row.accountable_employee_id) : 'unassigned'}`,
    href: dayLink(row.business_date),
  }))

  const breachItems: InsightListItem[] = breaches.map((row) => ({
    text: `${formatDayDate(row.business_date)}: ${row.title_snapshot} read ${reading(row.value_recorded, row.value_unit) ?? 'a value'}, ${allowedRange(row)}`,
    href: dayLink(row.business_date),
    rag: 'amber',
  }))

  const fourWeekMisses = fourWeekRows.filter((row) => row.state === 'missed')
  const byTask = new Map<string, { count: number; places: Set<string> }>()
  const byPlace = new Map<string, { department: string; slot: string; count: number }>()
  for (const row of fourWeekMisses) {
    const task = byTask.get(row.title_snapshot) ?? { count: 0, places: new Set<string>() }
    task.count += 1
    task.places.add(placeOf(row))
    byTask.set(row.title_snapshot, task)
    const placeKey = `${row.department}|${row.slot}`
    const place = byPlace.get(placeKey) ?? { department: row.department, slot: row.slot, count: 0 }
    place.count += 1
    byPlace.set(placeKey, place)
  }
  const mostMissedItems: InsightListItem[] = [...byTask.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, CHECKLISTS.mostMissedShown)
    .map(([title, task]) => ({
      text: `${title} (${[...task.places].sort().join('; ')}): ${plural(task.count, 'miss', 'misses')}`,
      href: problemsLink(fourWeeks),
    }))
  const placeItems: InsightListItem[] = [...byPlace.values()]
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department) || a.slot.localeCompare(b.slot))
    .map((place) => ({ text: `${capitalise(place.department)}, ${slotLabel(place.slot)}: ${plural(place.count, 'miss', 'misses')}` }))

  const lateShareFor = (person: Person): number => lateShareOf(person.done, person.late) ?? 0
  const ranked = [...people.values()]
    .filter((person) => person.done >= CHECKLISTS.rankingMinimumCompletions)
    .sort((a, b) => lateShareFor(a) - lateShareFor(b) || b.done - a.done || byName(a, b))
  const rankLine = (person: Person): string =>
    `${nameOf(person.id)}, ${percent(lateShareFor(person))} late over ${plural(person.done, 'check')}`
  const rankingItems: InsightListItem[] = ranked.length === 0
    ? []
    : ranked.length === 1
      ? [{ text: `Only one person has ${CHECKLISTS.rankingMinimumCompletions} or more checks: ${rankLine(ranked[0])}` }]
      : [
        { text: `Highest: ${rankLine(ranked[0])}`, rag: 'green' },
        { text: `Lowest: ${rankLine(ranked[ranked.length - 1])}` },
      ]

  const peopleItems: InsightListItem[] = [...people.values()]
    .sort((a, b) => b.done - a.done || byName(a, b))
    .map((person) => {
      const missed = person.missed > 0 ? `, ${person.missed} missed while on shift` : ''
      if (person.done === 0) return { text: `${nameOf(person.id)}: no checks done${missed}` }
      const score = scoreTimeliness(person.scored).score
      const scoreText = score === null ? 'too few checks for an on-time score' : `on-time score ${score.toFixed(1)} out of 10`
      return {
        text: `${nameOf(person.id)}: ${plural(person.done, 'check')} done, ${percent(lateShareFor(person))} late${missed}, ${scoreText}`,
        href: insightsLink(fourWeeks),
      }
    })

  const lists: InsightList[] = [
    { title: 'This week by day', items: dayItems },
    { title: 'Missed this week', items: missItems, emptyText: 'Nothing was missed this week.' },
    { title: 'Readings out of range this week', items: breachItems, emptyText: 'No readings out of range this week.' },
    { title: 'Most-missed tasks, last 4 weeks', items: mostMissedItems, emptyText: 'Nothing was missed in the last 4 weeks.' },
    { title: 'Misses by department and time, last 4 weeks', items: placeItems },
    {
      title: `Highest and lowest on-time, last 4 weeks (${CHECKLISTS.rankingMinimumCompletions} or more checks)`,
      items: rankingItems,
      emptyText: `Nobody has ${CHECKLISTS.rankingMinimumCompletions} or more checks in the last 4 weeks.`,
    },
    { title: 'Staff, last 4 weeks', items: peopleItems },
  ]

  // -------------------------------------------------------------------------
  // Notes (email safe).
  // -------------------------------------------------------------------------
  const notes: string[] = []
  if (openEmptyDates.length === thisWeek.days) {
    notes.push('No checklist records for any day this week.')
  } else if (openEmptyDates.length > 0) {
    const covers = settledThisWeek.length > 0 ? `, so this week's completion covers ${plural(settledThisWeek.length, 'day')}` : ''
    notes.push(`No checklist records for ${joinWithAnd(openEmptyDates.map(formatDayDate))}${covers}.`)
  }
  if (overdueDates.length > 0) {
    const many = overdueDates.length > 1
    notes.push(`Checks for ${joinWithAnd(overdueDates.map(formatDayDate))} should have locked overnight and have not, so ${many ? 'those days are' : 'that day is'} left out.`)
  }
  if (waitingDates.length > 0) {
    const many = waitingDates.length > 1
    notes.push(`Checks for ${joinWithAnd(waitingDates.map(formatDayDate))} are not locked yet, so ${many ? 'those days are' : 'that day is'} left out.`)
  }
  if (stillOpen.length > 0) {
    const openDays = [...new Set(stillOpen.map((row) => row.business_date))].sort().map(formatDayDate)
    const many = stillOpen.length > 1
    notes.push(`${plural(stillOpen.length, 'check')} from ${joinWithAnd(openDays)} can still be done, so ${many ? 'they are' : 'it is'} not counted yet.`)
  }
  if (!hasMinimumHistory(COLLECTION_STARTS.checklists, fourWeeks.start)) {
    notes.push(`Checklist records begin on ${formatDateWithYear(COLLECTION_STARTS.checklists)}, so the 4-week figures cover a shorter period.`)
  }

  return {
    headline: headlineFor({
      rate,
      missed: week.missed,
      lateShare,
      repeatCount: repeatMissers.length,
      breaches: breaches.length,
      spotNotRecorded,
      unassigned,
      settledDays: settledThisWeek.length,
      waitingDates,
      overdueDates,
      openEmptyDates,
    }),
    metrics,
    lists,
    signals,
    notes,
  }
}

export const checklistsSection: SectionDefinition = {
  key: 'checklists',
  title: 'Checklists',
  path: '/checklists/manage/insights',
  build: buildChecklistsSection,
}
