import { displayName } from '@/lib/employees/display-name'
import { getLeaveTypes } from '@/lib/leave/leave-types'
import { SHIFT_ACCEPTANCE_CUTOFF_DAYS, SHIFT_ACCEPTANCE_WARNING_DAYS_BEFORE_CUTOFF } from '@/lib/rota/acceptance-cutoff'
import type { PublishedShiftSnapshot, RotaPublishShift } from '@/lib/rota/publish-status'
import { getUnfilledShifts, type UnfilledShift } from '@/lib/rota/unfilled-shifts'
import { readinessWeekFromRow, summariseRotaReadiness, type RotaWeekReadiness } from '@/lib/rota/week-readiness'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { hasMinimumHistory } from '../compare'
import { formatDayDate, formatPercent, formatTimeOfDay, joinWithAnd, plural } from '../format'
import { mergeSignals } from '../signals'
import { ROTA } from '../thresholds'
import { addDays, dateRange, daysBetween, isInRange, londonDateOf, mondayOf, rangeInstants } from '../windows'
import type {
  DateRange,
  InsightAction,
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md, section 5.10.
//
// Sources (checked live, 18 Sep 2026):
// - rota_weeks: status draft or published. A week counts as published only with a
//   published_at, because a week marked published without one was never sent to staff.
// - rota_shifts (live) against rota_published_shifts (what staff see), diffed through
//   src/lib/rota/week-readiness.ts for unpublished changes, from today onwards only.
// - Open shifts come from getUnfilledShifts, the same definition the reassign queue, the
//   nav badge and the daily urgent alert use, so the report agrees with the app. It reads
//   live rows, so an open shift in a week not yet published still counts: it is a gap.
// - Acceptance: employee_reliability_events (shift_accepted, shift_auto_accepted) by decision
//   date, backfill rows ignored, one decision per shift and person; rejections from
//   rota_shift_rejections.rejected_at, because a rejected shift is reopened on the rota.
// - Couldn't-work shifts: reliability events of type couldnt_work, by shift date, backfill ignored,
//   counted as the shifts they reopened (metadata.impacted_shift_ids) with each shift's own
//   department. The event's own department is never used: it copies the 'sick' marker row,
//   which markEmployeeCouldntWork always creates as 'bar' (all 10 live events said 'bar'; 5 of
//   the shifts were kitchen). Events that reopened nothing count nothing.
// - Why a shift is open comes from rota_shifts.reassignment_reason, by its prefix only: the text
//   after the prefix is a free-text reason that can hold health details, so it is never shown.
// - Hard to staff counts each shift once: a past shift left open after a rejection or a
//   couldn't-work counts under that cause, not again as unfilled.
// - Leave: leave_requests pending (any dates) and approved leave overlapping the next 14 days.
//
// Names (decision 13): the leave requester is email safe, because the reader decides that
// request. Who rejected a shift and who has shifts awaiting acceptance are page only, in lists.

interface WeekRow {
  id: string
  week_start: string
  status: string | null
  published_at: string | null
}

type LiveShiftRow = RotaPublishShift & { week_id: string }

type PublishedShiftRow = PublishedShiftSnapshot & { week_id: string; acceptance_status: string | null }

interface RejectionRow {
  id: string
  shift_id: string
  employee_id: string
  shift_date: string
  start_time: string | null
  end_time: string | null
  department: string | null
  rejected_at: string
}

interface DecisionEventRow {
  id: string
  event_type: string
  event_at: string
  shift_id: string | null
  employee_id: string
}

interface CouldntWorkRow {
  id: string
  shift_date: string | null
  impacted_shift_count: number | null
  /** Holds only impacted_shift_ids on these rows (checked live, 18 Sep 2026). */
  metadata: { impacted_shift_ids?: unknown } | null
}

interface PastOpenShiftRow {
  id: string
  shift_date: string
  department: string | null
  reassignment_reason: string | null
}

interface ShiftRow {
  id: string
  shift_date: string
  department: string | null
  is_open_shift: boolean
  status: string
}

interface LeaveRow {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  status: string
  leave_type: string | null
  created_at: string
}

interface EmployeeRow {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
}

interface DepartmentRow {
  name: string
  label: string | null
}

type RejectionOutcome = 'since covered' | 'still open' | 'shift since removed' | 'shift cancelled'

const LIVE_SHIFT_COLUMNS =
  'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, reassignment_reason'
const PUBLISHED_SHIFT_COLUMNS =
  'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, acceptance_status'

const UNKNOWN_PERSON = 'a staff member'

// reassignment_reason prefixes written by the app (src/app/actions/rota.ts, the separation RPC).
const COULDNT_WORK_REASON = "Couldn't Work"
const REJECTED_REASON = 'Rejected by staff'
const SEPARATION_REASON = 'Released during employee separation'

function isCouldntWorkReason(reason: string | null | undefined): boolean {
  return Boolean(reason?.startsWith(COULDNT_WORK_REASON))
}

/** The shifts a couldn't-work event reopened, as recorded on the event. */
function impactedShiftIds(row: CouldntWorkRow): string[] {
  const ids = row.metadata?.impacted_shift_ids
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))] : []
}

// ---------------------------------------------------------------------------
// Reads (all through ctx.db, paged with a stable unique order)
// ---------------------------------------------------------------------------

function readWeeks(ctx: SectionContext, fromMonday: string): Promise<WeekRow[]> {
  return fetchAllRows<WeekRow>(
    (from, to) => ctx.db
      .from('rota_weeks')
      .select('id, week_start, status, published_at')
      .gte('week_start', fromMonday)
      .order('week_start')
      .order('id')
      .range(from, to),
    { label: 'insights rota weeks' },
  )
}

function readLiveShifts(ctx: SectionContext, start: string, end: string): Promise<LiveShiftRow[]> {
  return fetchAllRows<LiveShiftRow>(
    (from, to) => ctx.db
      .from('rota_shifts')
      .select(LIVE_SHIFT_COLUMNS)
      .gte('shift_date', start)
      .lte('shift_date', end)
      .order('id')
      .range(from, to),
    { label: 'insights rota shifts' },
  )
}

function readPublishedShifts(ctx: SectionContext, start: string, end: string): Promise<PublishedShiftRow[]> {
  return fetchAllRows<PublishedShiftRow>(
    (from, to) => ctx.db
      .from('rota_published_shifts')
      .select(PUBLISHED_SHIFT_COLUMNS)
      .gte('shift_date', start)
      .lte('shift_date', end)
      .order('id')
      .range(from, to),
    { label: 'insights published rota shifts' },
  )
}

function readRejections(ctx: SectionContext, range: DateRange): Promise<RejectionRow[]> {
  const bounds = rangeInstants(range)
  return fetchAllRows<RejectionRow>(
    (from, to) => ctx.db
      .from('rota_shift_rejections')
      .select('id, shift_id, employee_id, shift_date, start_time, end_time, department, rejected_at')
      .gte('rejected_at', bounds.from)
      .lt('rejected_at', bounds.toExclusive)
      .order('id')
      .range(from, to),
    { label: 'insights shift rejections' },
  )
}

function readDecisionEvents(ctx: SectionContext, range: DateRange): Promise<DecisionEventRow[]> {
  const bounds = rangeInstants(range)
  return fetchAllRows<DecisionEventRow>(
    (from, to) => ctx.db
      .from('employee_reliability_events')
      .select('id, event_type, event_at, shift_id, employee_id')
      .in('event_type', ['shift_accepted', 'shift_auto_accepted'])
      .neq('source', 'backfill')
      .gte('event_at', bounds.from)
      .lt('event_at', bounds.toExclusive)
      .order('id')
      .range(from, to),
    { label: 'insights shift acceptance' },
  )
}

function readCouldntWork(ctx: SectionContext, range: DateRange): Promise<CouldntWorkRow[]> {
  return fetchAllRows<CouldntWorkRow>(
    (from, to) => ctx.db
      .from('employee_reliability_events')
      // Never the note column: it holds the free-text reason. Never department: see the header.
      .select('id, shift_date, impacted_shift_count, metadata')
      .eq('event_type', 'couldnt_work')
      .neq('source', 'backfill')
      .gte('shift_date', range.start)
      .lte('shift_date', range.end)
      .order('id')
      .range(from, to),
    { label: "insights couldn't-work shifts" },
  )
}

/** Past shifts still open after their date: they went unfilled. The reason is read for its prefix only. */
function readPastOpenShifts(ctx: SectionContext, range: DateRange): Promise<PastOpenShiftRow[]> {
  return fetchAllRows<PastOpenShiftRow>(
    (from, to) => ctx.db
      .from('rota_shifts')
      .select('id, shift_date, department, reassignment_reason')
      .eq('is_open_shift', true)
      .eq('status', 'scheduled')
      .gte('shift_date', range.start)
      .lte('shift_date', range.end)
      .order('id')
      .range(from, to),
    { label: 'insights unfilled past shifts' },
  )
}

function readLeave(ctx: SectionContext): Promise<LeaveRow[]> {
  const { today, next14 } = ctx.windows
  return fetchAllRows<LeaveRow>(
    (from, to) => ctx.db
      .from('leave_requests')
      .select('id, employee_id, start_date, end_date, status, leave_type, created_at')
      .or(`status.eq.pending,and(status.eq.approved,start_date.lte.${next14.end},end_date.gte.${today})`)
      .order('id')
      .range(from, to),
    { label: 'insights leave requests' },
  )
}

function readDepartments(ctx: SectionContext): Promise<DepartmentRow[]> {
  return fetchAllRows<DepartmentRow>(
    (from, to) => ctx.db
      .from('departments')
      .select('name, label')
      .order('name')
      .range(from, to),
    { label: 'insights departments' },
  )
}

async function readEmployees(ctx: SectionContext, ids: string[]): Promise<EmployeeRow[]> {
  if (ids.length === 0) return []
  return fetchAllRows<EmployeeRow>(
    (from, to) => ctx.db
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name')
      .in('employee_id', ids)
      .order('employee_id')
      .range(from, to),
    { label: 'insights rota names' },
  )
}

/** Rejected shifts (for their outcome) and reopened couldn't-work shifts (for their department). */
async function readShiftsById(ctx: SectionContext, ids: string[]): Promise<ShiftRow[]> {
  if (ids.length === 0) return []
  return fetchAllRows<ShiftRow>(
    (from, to) => ctx.db
      .from('rota_shifts')
      .select('id, shift_date, department, is_open_shift, status')
      .in('id', ids)
      .order('id')
      .range(from, to),
    { label: 'insights rejected and reopened shifts' },
  )
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  return groups
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Thu 24 Dec", with the year added when the date is in another calendar year. */
function dayText(isoDate: string, today: string): string {
  const base = formatDayDate(isoDate)
  return isoDate.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${isoDate.slice(0, 4)}`
}

function timeRange(start: string | null, end: string | null): string | null {
  const from = formatTimeOfDay(start)
  const to = formatTimeOfDay(end)
  return from && to ? `${from} to ${to}` : null
}

function waitingText(days: number): string {
  if (days <= 0) return 'asked today'
  return `waiting ${plural(days, 'day')}`
}

function startsText(days: number): string {
  if (days === 0) return 'starts today'
  if (days === 1) return 'starts tomorrow'
  if (days > 1) return `starts in ${plural(days, 'day')}`
  return days === -1 ? 'started yesterday' : `started ${plural(-days, 'day')} ago`
}

function laterDate(a: string, b: string): string {
  return a > b ? a : b
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildRotaSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { windows } = ctx
  const today = windows.today
  const currentMonday = mondayOf(today)
  const horizonWeeks = ROTA.publishingHorizonWeeks
  const horizonEnd = addDays(currentMonday, horizonWeeks * 7 - 1)
  // Open shifts are read from today to the 56th day (today is day 1).
  const openHorizonDays = ROTA.openShiftFarDays - 1
  const openHorizonEnd = addDays(today, openHorizonDays)
  // Shifts still awaiting acceptance are watched over the same window staff are warned about
  // (the two-week cutoff plus the warning lead, 16 days), so the warned shifts are the ones listed.
  const acceptanceDays = SHIFT_ACCEPTANCE_CUTOFF_DAYS + SHIFT_ACCEPTANCE_WARNING_DAYS_BEFORE_CUTOFF
  const acceptanceWindow = dateRange(today, addDays(today, acceptanceDays - 1))
  const acceptanceLabel = `Awaiting acceptance, next ${acceptanceDays} days`

  const [weeks, liveShifts, publishedShifts, unfilled, rejections, decisions, couldntWork, pastOpen, leaveRows, departments] =
    await Promise.all([
      readWeeks(ctx, currentMonday),
      readLiveShifts(ctx, today, horizonEnd),
      readPublishedShifts(ctx, today, horizonEnd),
      getUnfilledShifts(ctx.db, today, openHorizonDays),
      readRejections(ctx, windows.last91),
      readDecisionEvents(ctx, windows.last91),
      readCouldntWork(ctx, windows.last91),
      readPastOpenShifts(ctx, windows.last91),
      readLeave(ctx),
      readDepartments(ctx),
    ])

  // A failed read of the open shifts themselves would look exactly like "all covered".
  if (unfilled.failures.some((failure) => failure.step === 'unfilled_shifts')) {
    throw new Error('Open shifts could not be read')
  }
  const rejectionReasonsUnknown = unfilled.failures.some((failure) => failure.step === 'shift_rejections')
  const rejectionNamesUnknown = unfilled.failures.some((failure) => failure.step === 'rejection_employee_names')

  const labelByDepartment = new Map(departments.map((row) => [row.name, row.label?.trim() || row.name]))
  const departmentLabel = (department: string | null | undefined): string =>
    department ? (labelByDepartment.get(department) ?? department) : 'No department'

  const thisWeekRejections = rejections
    .filter((row) => isInRange(londonDateOf(row.rejected_at), windows.thisWeek))
    .sort((a, b) => a.rejected_at.localeCompare(b.rejected_at) || a.id.localeCompare(b.id))
  const pendingLeave = leaveRows
    .filter((row) => row.status === 'pending')
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const approvedLeave = leaveRows
    .filter((row) => row.status === 'approved' && row.start_date <= windows.next14.end && row.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
  const awaitingAcceptance = publishedShifts
    .filter((shift) =>
      isInRange(shift.shift_date, acceptanceWindow)
      && shift.status === 'scheduled'
      && !shift.is_open_shift
      && Boolean(shift.employee_id)
      && shift.acceptance_status === 'pending')
    .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id))

  const nameIds = [...new Set([
    ...pendingLeave.map((row) => row.employee_id),
    ...approvedLeave.map((row) => row.employee_id),
    ...awaitingAcceptance.map((shift) => shift.employee_id as string),
    ...thisWeekRejections.map((row) => row.employee_id),
  ])].sort()

  const [employees, shiftRows, leaveTypes] = await Promise.all([
    readEmployees(ctx, nameIds),
    readShiftsById(ctx, [...new Set([
      ...thisWeekRejections.map((row) => row.shift_id),
      ...couldntWork.flatMap(impactedShiftIds),
    ])].sort()),
    pendingLeave.length || approvedLeave.length ? getLeaveTypes(ctx.db) : Promise.resolve([]),
  ])
  const shiftById = new Map(shiftRows.map((row) => [row.id, row]))

  const nameById = new Map(employees.map((row) => [row.employee_id, displayName(row, UNKNOWN_PERSON)]))
  const personName = (employeeId: string): string => nameById.get(employeeId) ?? UNKNOWN_PERSON
  const leaveLabelByCode = new Map(leaveTypes.map((type) => [type.code, type.label]))
  const leaveLabel = (code: string | null): string => {
    const key = code ?? 'holiday'
    return leaveLabelByCode.get(key) ?? capitalise(key.replace(/_/g, ' '))
  }

  const shiftLink = (shiftId: string, shiftDate: string): string =>
    ctx.link(`/rota?week=${mondayOf(shiftDate)}&shift=${encodeURIComponent(shiftId)}`)
  const weekLink = (weekStart: string): string => ctx.link(`/rota?week=${weekStart}`)
  const leaveLink = (leaveId: string): string => ctx.link(`/rota/leave#leave-${encodeURIComponent(leaveId)}`)
  const weekDue = (weekStart: string): string => laterDate(addDays(weekStart, -1), today)

  const signals: InsightSignal[] = []
  const notes: string[] = []
  const lists: InsightList[] = []

  // ---- Publishing ---------------------------------------------------------------------------
  const weekByStart = new Map(weeks.map((week) => [week.week_start, week]))
  const isDelivered = (week: WeekRow | undefined): boolean => week?.status === 'published' && Boolean(week.published_at)

  const weekStarts = Array.from({ length: horizonWeeks }, (_, index) => addDays(currentMonday, index * 7))
  const liveByWeek = groupBy(liveShifts, (shift) => mondayOf(shift.shift_date))
  const publishedByWeek = groupBy(publishedShifts, (shift) => mondayOf(shift.shift_date))
  const readiness: RotaWeekReadiness[] = summariseRotaReadiness(
    weekStarts.map((weekStart) => ({
      week: readinessWeekFromRow(weekStart, weekByStart.get(weekStart) ?? null),
      liveShifts: liveByWeek.get(weekStart) ?? [],
      publishedShifts: publishedByWeek.get(weekStart) ?? [],
    })),
    horizonWeeks,
  ).byWeek

  // The unbroken run of published weeks from this week onwards.
  let runEnd: string | null = null
  let firstUnpublished = currentMonday
  for (let guard = 0; guard <= weeks.length && isDelivered(weekByStart.get(firstUnpublished)); guard += 1) {
    runEnd = firstUnpublished
    firstUnpublished = addDays(firstUnpublished, 7)
  }
  const publishedToSunday = runEnd ? addDays(runEnd, 6) : null
  const afterRun = weekByStart.get(firstUnpublished)
  const laterWeekPublished = weeks.some((week) => week.week_start > firstUnpublished && isDelivered(week))
  const draftsFromThere = weeks.filter((week) => week.week_start >= firstUnpublished && week.status !== 'published').length

  let afterRunText: string
  if (!afterRun) {
    afterRunText = `nothing is planned from ${formatDayDate(firstUnpublished)}`
  } else if (afterRun.status === 'published') {
    afterRunText = `the week of ${formatDayDate(firstUnpublished)} is marked published but was never sent to staff`
  } else if (laterWeekPublished) {
    afterRunText = `the week of ${formatDayDate(firstUnpublished)} is a draft, though a later week is published`
  } else if (draftsFromThere > 1) {
    afterRunText = `weeks from ${formatDayDate(firstUnpublished)} are drafts`
  } else {
    afterRunText = `the week of ${formatDayDate(firstUnpublished)} is a draft`
  }

  const notPublishedText = (entry: RotaWeekReadiness): string => {
    const week = `The rota for the week of ${formatDayDate(entry.weekStart)}`
    if (entry.state === 'missing') return `${week} has not been started, so staff cannot see it.`
    if (entry.state === 'draft') return `${week} is still a draft, so staff cannot see it.`
    return `${week} is marked published but was never sent to staff.`
  }
  const isNotPublished = (entry: RotaWeekReadiness): boolean =>
    entry.state === 'missing' || entry.state === 'draft' || !weekByStart.get(entry.weekStart)?.published_at

  const weekSignal = (entry: RotaWeekReadiness, rag: 'red' | 'amber'): InsightSignal => ({
    key: `rota.week_not_published.${entry.weekStart}`,
    entity: `rota_week:${entry.weekStart}`,
    rag,
    kind: 'issue',
    text: notPublishedText(entry),
    emailSafe: true,
    action: {
      text: `Publish the rota for the week of ${formatDayDate(entry.weekStart)}`,
      href: weekLink(entry.weekStart),
      target: 'record',
      dueDate: weekDue(entry.weekStart),
      impact: 'staffing',
    },
  })

  // ---- Cover --------------------------------------------------------------------------------
  const nearOpen = unfilled.shifts.filter((shift) => isInRange(shift.date, windows.next14))
  const farOpen = unfilled.shifts.filter((shift) => shift.date > windows.next14.end && shift.date <= openHorizonEnd)
  const plannedNext14 = liveShifts.filter((shift) => isInRange(shift.shift_date, windows.next14) && shift.status === 'scheduled').length
  /** "Fri 9 Oct to Thu 19 Nov": after the next 14 days, up to the 56th day. */
  const laterWindow = `${formatDayDate(addDays(windows.next14.end, 1))} to ${formatDayDate(openHorizonEnd)}`

  const shiftWhen = (shift: UnfilledShift): string => {
    const times = timeRange(shift.startTime, shift.endTime)
    return `${formatDayDate(shift.date)}${times ? `, ${times}` : ''} (${departmentLabel(shift.department)})`
  }
  // The live read runs from today to the end of the 8-week horizon, so it holds every shift in
  // the next 14 days. Only the reason's prefix is used; the text after it is never shown.
  const reasonById = new Map(liveShifts.map((shift) => [shift.id, shift.reassignment_reason ?? null]))
  let reasonNotKnown = false
  let rejectedShown = false
  const openReason = (shift: UnfilledShift): string => {
    const reason = reasonById.get(shift.id) ?? null
    // Couldn't Work reopens a staffed shift; an older rejection of it is no longer why it is open.
    if (isCouldntWorkReason(reason)) return "reopened because the person rostered couldn't work"
    if (reason === SEPARATION_REASON) return 'released when a staff member left'
    if (reason?.startsWith(REJECTED_REASON) || shift.rejectedByName) {
      rejectedShown = true
      return `rejected by ${shift.rejectedByName ?? UNKNOWN_PERSON}`
    }
    if (rejectionReasonsUnknown) {
      reasonNotKnown = true
      return 'reason not known'
    }
    return 'never filled'
  }

  const openSignals: InsightSignal[] = nearOpen.map((shift) => ({
    key: `rota.open_shift.${shift.id}`,
    entity: `shift:${shift.id}`,
    rag: 'red',
    kind: 'issue',
    text: `Open shift on ${shiftWhen(shift)} needs cover.`,
    emailSafe: true,
    action: {
      text: `Find cover for ${shiftWhen(shift)}`,
      href: shiftLink(shift.id, shift.date),
      target: 'record',
      dueDate: shift.date,
      impact: 'staffing',
    },
  }))

  lists.push({
    title: 'Open shifts, next 14 days',
    items: nearOpen.map((shift): InsightListItem => {
      const unpublished = !isDelivered(weekByStart.get(mondayOf(shift.date)))
      const name = shift.templateName ? `, ${shift.templateName}` : ''
      return {
        text: `${shiftWhen(shift)}${name}: ${openReason(shift)}${unpublished ? ' (week not published yet)' : ''}`,
        href: shiftLink(shift.id, shift.date),
        rag: 'red',
      }
    }),
    emptyText: 'All shifts in the next 14 days are covered.',
  })
  if (reasonNotKnown) notes.push('Why some shifts are open could not be read; the open shifts themselves are complete.')
  else if (rejectedShown && (rejectionReasonsUnknown || rejectionNamesUnknown)) notes.push('Who rejected some open shifts could not be read.')

  // ---- Leave --------------------------------------------------------------------------------
  const leaveDates = (row: LeaveRow): string =>
    row.start_date === row.end_date ? dayText(row.start_date, today) : `${dayText(row.start_date, today)} to ${dayText(row.end_date, today)}`

  const leaveSignals: InsightSignal[] = []
  const leaveItems: InsightListItem[] = []
  let urgentLeave = 0
  let oldestWaiting = 0
  for (const row of pendingLeave) {
    const waiting = daysBetween(londonDateOf(row.created_at), today)
    const untilStart = daysBetween(today, row.start_date)
    const urgent = untilStart <= ROTA.leaveRedStartsWithinDays || waiting >= ROTA.leaveRedWaitingDays
    if (urgent) urgentLeave += 1
    oldestWaiting = Math.max(oldestWaiting, waiting)
    const name = personName(row.employee_id)
    const detail = `Leave request from ${name} (${leaveLabel(row.leave_type)}), ${leaveDates(row)}: ${waitingText(waiting)}, ${startsText(untilStart)}.`
    const action: InsightAction = {
      text: `Decide the leave request from ${name} (${leaveDates(row)})`,
      href: leaveLink(row.id),
      target: 'record',
      dueDate: laterDate(row.start_date, today),
      impact: 'staffing',
    }
    leaveSignals.push({
      key: `rota.${urgent ? 'leave_urgent' : 'leave_pending'}.${row.id}`,
      entity: `leave:${row.id}`,
      rag: urgent ? 'red' : 'amber',
      kind: 'issue',
      text: detail,
      emailSafe: true,
      action,
    })
    leaveItems.push({ text: detail, href: leaveLink(row.id), rag: urgent ? 'red' : 'amber' })
  }
  lists.push({ title: 'Leave requests waiting', items: leaveItems, emptyText: 'No leave requests are waiting for a decision.' })
  lists.push({
    title: "Who's off, next 14 days",
    items: approvedLeave.map((row) => ({ text: `${personName(row.employee_id)} (${leaveLabel(row.leave_type)}), ${leaveDates(row)}` })),
    emptyText: 'Nobody has approved leave in the next 14 days.',
  })

  // ---- Acceptance ---------------------------------------------------------------------------
  const recentHistory = hasMinimumHistory(ROTA.decisionsCollectionStart, windows.last28.start)
  const longHistory = hasMinimumHistory(ROTA.decisionsCollectionStart, windows.last91.start)

  const decisionCounts = (range: DateRange): { accepted: number; auto: number; rejected: number; total: number } => {
    const accepted = new Set<string>()
    const auto = new Set<string>()
    for (const event of decisions) {
      if (!isInRange(londonDateOf(event.event_at), range)) continue
      const key = `${event.shift_id ?? event.id}:${event.employee_id}`
      if (event.event_type === 'shift_accepted') accepted.add(key)
      else if (event.event_type === 'shift_auto_accepted') auto.add(key)
    }
    const rejected = rejections.filter((row) => isInRange(londonDateOf(row.rejected_at), range)).length
    return { accepted: accepted.size, auto: auto.size, rejected, total: accepted.size + auto.size + rejected }
  }

  const acceptanceMetrics: InsightMetric[] = []
  if (!recentHistory) {
    notes.push(`Shift acceptance records began on ${dayText(ROTA.decisionsCollectionStart, today)}, so there is not enough history yet for the 4-week acceptance figures.`)
  } else {
    const recent = decisionCounts(windows.last28)
    const long = longHistory ? decisionCounts(windows.last91) : null
    if (recent.total === 0) {
      notes.push('No shift acceptances or rejections were recorded in the last 4 weeks.')
    } else {
      const share = (count: number, total: number): string => formatPercent(count / total)
      const rate = (pick: (counts: NonNullable<typeof long>) => number): string =>
        long && long.total > 0 ? `13-week rate ${share(pick(long), long.total)}` : 'not enough history yet for the 13-week rate'
      acceptanceMetrics.push(
        { label: 'Accepted by staff, last 4 weeks', value: `${share(recent.accepted, recent.total)} (${recent.accepted} of ${recent.total})`, comparison: rate((c) => c.accepted) },
        { label: 'Auto-accepted, last 4 weeks', value: `${share(recent.auto, recent.total)} (${recent.auto} of ${recent.total})`, comparison: rate((c) => c.auto) },
        { label: 'Rejected, last 4 weeks', value: `${share(recent.rejected, recent.total)} (${recent.rejected} of ${recent.total})`, comparison: rate((c) => c.rejected) },
      )
      if (!longHistory) notes.push('Not enough history yet for 13-week acceptance rates.')
    }
  }

  const awaitingByPerson = groupBy(awaitingAcceptance, (shift) => shift.employee_id as string)
  if (awaitingAcceptance.length > 0) {
    lists.push({
      title: acceptanceLabel,
      items: [...awaitingByPerson.entries()]
        .map(([employeeId, shifts]) => ({ name: personName(employeeId), shifts }))
        .sort((a, b) => a.shifts[0].shift_date.localeCompare(b.shifts[0].shift_date) || a.name.localeCompare(b.name))
        .map(({ name, shifts }) => ({ text: `${name}: ${plural(shifts.length, 'shift')}, first ${formatDayDate(shifts[0].shift_date)}` })),
    })
  }

  // ---- Rejections and couldn't-work this week ----------------------------------------------
  const outcomeOf = (row: RejectionRow): RejectionOutcome => {
    const state = shiftById.get(row.shift_id)
    if (!state) return 'shift since removed'
    if (state.status === 'cancelled') return 'shift cancelled'
    return state.is_open_shift ? 'still open' : 'since covered'
  }
  const outcomeCounts = new Map<RejectionOutcome, number>()
  const rejectionItems: InsightListItem[] = thisWeekRejections.map((row) => {
    const outcome = outcomeOf(row)
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1)
    const times = timeRange(row.start_time, row.end_time)
    return {
      text: `${formatDayDate(row.shift_date)}${times ? `, ${times}` : ''} (${departmentLabel(row.department)}): rejected by ${personName(row.employee_id)}, ${outcome}`,
      href: outcome === 'shift since removed' ? undefined : shiftLink(row.shift_id, row.shift_date),
      rag: outcome === 'still open' ? 'red' : undefined,
    }
  })
  if (rejectionItems.length > 0) lists.push({ title: 'Rejections this week', items: rejectionItems })

  // Couldn't-work shifts over 13 weeks, each counted once with the reopened shift's own department.
  const couldntWorkShifts = new Map<string, { date: string; department: string | null }>()
  const untraced = new Set<string>()
  let unlisted = 0
  for (const event of couldntWork) {
    const ids = impactedShiftIds(event)
    unlisted += Math.max(0, (event.impacted_shift_count ?? 0) - ids.length)
    for (const id of ids) {
      const reopened = shiftById.get(id)
      if (!reopened) untraced.add(id)
      else if (isInRange(reopened.shift_date, windows.last91)) {
        couldntWorkShifts.set(id, { date: reopened.shift_date, department: reopened.department })
      }
    }
  }
  // A shift still open with a Couldn't Work reason whose event was never recorded.
  for (const row of pastOpen) {
    if (isCouldntWorkReason(row.reassignment_reason) && !couldntWorkShifts.has(row.id)) {
      couldntWorkShifts.set(row.id, { date: row.shift_date, department: row.department })
    }
  }
  const untracedCount = untraced.size + unlisted
  if (untracedCount > 0) {
    notes.push(`${plural(untracedCount, "couldn't-work shift")} in the last 13 weeks could not be matched to a shift on the rota, so ${untracedCount === 1 ? 'it is' : 'they are'} left out of the couldn't-work figures.`)
  }

  const thisWeekCouldntWork = [...couldntWorkShifts.values()].filter((row) => isInRange(row.date, windows.thisWeek))
  const couldntWorkByDepartment = [...groupBy(thisWeekCouldntWork, (row) => departmentLabel(row.department)).entries()]
    .map(([label, rows]) => ({ label, count: rows.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  // ---- Hard to staff (13 weeks) -------------------------------------------------------------
  const staffingSignals: InsightSignal[] = []
  if (!longHistory) {
    notes.push('Not enough history yet to judge which department is hardest to staff over 13 weeks.')
  } else {
    const tally = new Map<string, { rejections: number; unfilled: number; couldntWork: number }>()
    const bump = (department: string | null, field: 'rejections' | 'unfilled' | 'couldntWork'): void => {
      const key = department ?? ''
      const entry = tally.get(key) ?? { rejections: 0, unfilled: 0, couldntWork: 0 }
      entry[field] += 1
      tally.set(key, entry)
    }
    // Each shift once: a shift left open after a rejection or a couldn't-work is not also unfilled.
    const rejectedShiftIds = new Set(rejections.map((row) => row.shift_id))
    for (const row of rejections) bump(row.department, 'rejections')
    for (const row of pastOpen) {
      if (!couldntWorkShifts.has(row.id) && !rejectedShiftIds.has(row.id)) bump(row.department, 'unfilled')
    }
    for (const row of couldntWorkShifts.values()) bump(row.department, 'couldntWork')
    const rows = [...tally.entries()]
      .map(([department, counts]) => ({ department, counts, total: counts.rejections + counts.unfilled + counts.couldntWork }))
      .sort((a, b) => b.total - a.total || a.department.localeCompare(b.department))
    const total = rows.reduce((sum, row) => sum + row.total, 0)
    for (const row of rows) {
      if (row.total < ROTA.hardToStaffMinimum || row.total / total < ROTA.hardToStaffShare) continue
      const label = departmentLabel(row.department || null)
      staffingSignals.push({
        key: `rota.hard_to_staff.${row.department || 'none'}`,
        entity: `department:${row.department || 'none'}`,
        rag: 'amber',
        kind: 'issue',
        text: `${label} is the hardest department to staff: ${row.total} of ${total} rejections, unfilled shifts and couldn't-work shifts in the last 13 weeks.`,
        emailSafe: true,
        action: {
          text: `Plan more cover for ${label} shifts, which have ${row.total} of ${total} staffing gaps in 13 weeks`,
          href: ctx.link('/rota'),
          target: 'list',
          impact: 'staffing',
        },
      })
    }
    if (rows.length > 0) {
      lists.push({
        title: 'Staffing gaps by department, last 13 weeks',
        items: rows.map((row) => ({
          text: `${departmentLabel(row.department || null)}: ${plural(row.counts.rejections, 'rejection')}, ${plural(row.counts.unfilled, 'unfilled shift')}, ${plural(row.counts.couldntWork, "couldn't-work shift")}`,
        })),
      })
    }
  }

  // ---- Signals, in the section's precedence order ------------------------------------------
  signals.push(...mergeSignals(openSignals, {
    above: 1,
    key: 'rota.open_shifts',
    rag: 'red',
    text: (count) => `${plural(count, 'open shift')} in the next 14 days ${count === 1 ? 'needs' : 'need'} cover.`,
    action: {
      text: `Find cover for ${plural(nearOpen.length, 'open shift')} in the next 14 days`,
      href: ctx.link('/rota/reassign'),
      impact: 'staffing',
    },
  }))
  // This week and next week unpublished are must-dos; the week after is one to watch.
  readiness.slice(0, 2).filter(isNotPublished).forEach((entry) => signals.push(weekSignal(entry, 'red')))
  signals.push(...leaveSignals.filter((signal) => signal.rag === 'red'))
  readiness.slice(2, 3).filter(isNotPublished).forEach((entry) => signals.push(weekSignal(entry, 'amber')))
  for (const entry of readiness) {
    if (isNotPublished(entry) || entry.state !== 'published_stale') continue
    if (entry.unpublishedCount === 0 && entry.removedCount === 0) continue
    const parts: string[] = []
    if (entry.unpublishedCount > 0) parts.push(`${plural(entry.unpublishedCount, 'shift')} added or changed since publishing`)
    if (entry.removedCount > 0) parts.push(`${plural(entry.removedCount, 'deleted shift')} still showing to staff`)
    signals.push({
      key: `rota.unpublished_changes.${entry.weekStart}`,
      entity: `rota_week:${entry.weekStart}`,
      rag: 'amber',
      kind: 'issue',
      text: `The published rota for the week of ${formatDayDate(entry.weekStart)} is out of date: ${joinWithAnd(parts)}.`,
      emailSafe: true,
      action: {
        text: `Republish the rota for the week of ${formatDayDate(entry.weekStart)}`,
        href: weekLink(entry.weekStart),
        target: 'record',
        dueDate: weekDue(entry.weekStart),
        impact: 'staffing',
      },
    })
  }
  signals.push(...leaveSignals.filter((signal) => signal.rag === 'amber'))
  if (farOpen.length > 0) {
    const first = farOpen[0].date
    signals.push({
      key: 'rota.open_shifts_later',
      rag: 'amber',
      kind: 'issue',
      text: `${plural(farOpen.length, 'more open shift')} from ${laterWindow} ${farOpen.length === 1 ? 'needs' : 'need'} cover, the first on ${formatDayDate(first)}.`,
      emailSafe: true,
      action: {
        text: `Find cover for ${plural(farOpen.length, 'open shift')} from ${formatDayDate(first)}`,
        href: ctx.link('/rota/reassign'),
        target: 'list',
        dueDate: first,
        impact: 'staffing',
      },
    })
  }
  signals.push(...staffingSignals)
  if (nearOpen.length === 0 && plannedNext14 > 0) {
    signals.push({
      key: 'rota.all_covered',
      rag: 'green',
      kind: 'win',
      text: 'All shifts in the next 14 days are covered.',
      emailSafe: true,
    })
  }

  // ---- Figures (most important first; the email shows four) --------------------------------
  const rejectionOutcomeText = (['since covered', 'still open', 'shift cancelled', 'shift since removed'] as RejectionOutcome[])
    .filter((outcome) => (outcomeCounts.get(outcome) ?? 0) > 0)
    .map((outcome) => `${outcomeCounts.get(outcome)} ${outcome}`)
    .join(', ')

  const metrics: InsightMetric[] = [
    {
      label: 'Open shifts, next 14 days',
      value: nearOpen.length ? String(nearOpen.length) : 'None',
      comparison: `${farOpen.length ? `plus ${farOpen.length}` : 'none'} from ${laterWindow}`,
    },
    {
      label: 'Rota published to',
      value: publishedToSunday ? formatDayDate(publishedToSunday) : 'Not published',
      comparison: publishedToSunday ? afterRunText : `the week of ${formatDayDate(currentMonday)} is not published`,
    },
    {
      label: 'Leave requests waiting',
      value: pendingLeave.length ? String(pendingLeave.length) : 'None',
      ...(pendingLeave.length
        ? { comparison: urgentLeave ? `${urgentLeave} urgent` : `oldest waiting ${plural(oldestWaiting, 'day')}` }
        : {}),
    },
    {
      label: acceptanceLabel,
      value: awaitingAcceptance.length ? plural(awaitingAcceptance.length, 'shift') : 'None',
      ...(awaitingAcceptance.length ? { comparison: `across ${plural(awaitingByPerson.size, 'person', 'people')}` } : {}),
    },
    ...acceptanceMetrics,
    {
      label: 'Rejections this week',
      value: thisWeekRejections.length ? String(thisWeekRejections.length) : 'None',
      ...(rejectionOutcomeText ? { comparison: rejectionOutcomeText } : {}),
    },
    {
      label: "Couldn't-work shifts this week",
      value: thisWeekCouldntWork.length ? String(thisWeekCouldntWork.length) : 'None',
      ...(couldntWorkByDepartment.length
        ? { comparison: couldntWorkByDepartment.map((entry) => `${entry.label} ${entry.count}`).join(', ') }
        : {}),
    },
  ]

  // ---- Headline -----------------------------------------------------------------------------
  const coverPart = nearOpen.length
    ? `${plural(nearOpen.length, 'open shift')} in the next 14 days`
    : plannedNext14 > 0 ? 'all shifts in the next 14 days covered' : 'no shifts planned in the next 14 days'
  const publishingPart = publishedToSunday ? `rota published to ${formatDayDate(publishedToSunday)}` : "this week's rota not published"
  const leavePart = pendingLeave.length ? `${plural(pendingLeave.length, 'leave request')} waiting` : 'no leave waiting'

  return {
    headline: `${capitalise([coverPart, publishingPart, leavePart].join('; '))}.`,
    metrics,
    lists,
    signals,
    notes,
  }
}

export const rotaSection: SectionDefinition = {
  key: 'rota',
  title: 'Rota, shifts and leave',
  path: '/rota',
  build: buildRotaSection,
}
