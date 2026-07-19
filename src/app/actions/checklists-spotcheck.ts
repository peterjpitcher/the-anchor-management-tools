'use server'

// Phase 3 (oversight) spot-check and problems actions for the checklists feature.
//   getSpotChecksForToday / recordSpotCheck  -> gated on `checklists:manage` (spec 11)
//   getChecklistProblems                     -> super_admin only (spec 9.4, 12)
// checklist_* tables are deny-all under RLS, so every read/write uses the admin client.
// See tasks/checklists-discovery/spec.md v4 sections 6, 9.4, 11.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { resolveCloser } from '@/lib/checklists/accountability'
import { getPublishedShiftsForDate } from '@/lib/checklists/rota'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpotCheckView {
  id: string
  instanceId: string
  businessDate: string
  drawNumber: number
  taskTitle: string
  checklistName: string
  checkedEmployeeId: string
  checkedEmployeeName: string
  state: 'drawn' | 'recorded'
  result: 'pass' | 'fail' | null
  note: string | null
}

export interface ProblemsData {
  from: string
  to: string
  missesByCloser: { employeeName: string; count: number }[]
  breaches: {
    taskTitle: string
    value: number | null
    unit: string | null
    businessDate: string
    completedByName: string | null
  }[]
  mismatches: { businessDate: string; kind: string; minutes: number }[]
  failedSpotChecks: {
    taskTitle: string
    checkedEmployeeName: string
    businessDate: string
    note: string | null
  }[]
  drawnUnrecorded: { taskTitle: string; businessDate: string }[]
}

const VENUE = 'Venue'

// ---------------------------------------------------------------------------
// Window + pagination + gate helpers
// ---------------------------------------------------------------------------

const MAX_RANGE_DAYS = 92
const DEFAULT_RANGE_DAYS = 30
const PAGE = 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isIso(v: string | undefined): v is string {
  return typeof v === 'string' && ISO_DATE.test(v)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  return Math.round((db - da) / 86_400_000)
}

/** Resolve/clamp the window: default rolling 30 days, hard cap 92 (spec 9.4). */
function resolveWindow(from?: string, to?: string): { from: string; to: string } {
  const toDate = isIso(to) ? to : getTodayIsoDate()
  let fromDate = isIso(from) ? from : addDays(toDate, -(DEFAULT_RANGE_DAYS - 1))
  if (daysBetween(fromDate, toDate) < 0) fromDate = toDate
  if (daysBetween(fromDate, toDate) > MAX_RANGE_DAYS - 1) {
    fromDate = addDays(toDate, -(MAX_RANGE_DAYS - 1))
  }
  return { from: fromDate, to: toDate }
}

// `build` returns a fresh Supabase query builder each call; `any` because the builder's
// chained generic type is not worth reconstructing here (house pattern, see mileage.ts).
async function fetchAllRows<T>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await build().range(offset, offset + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return rows
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

async function requireManage(): Promise<{ userId: string } | { error: string }> {
  const canManage = await checkUserPermission('checklists', 'manage')
  if (!canManage) return { error: 'Insufficient permissions' }
  const { user_id } = await getCurrentUser()
  if (!user_id) return { error: 'Unauthorized' }
  return { userId: user_id }
}

async function requireSuperAdmin(): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }

  // super_admin bypasses permission rows, so an explicit role check is the only way to
  // restrict a screen to super_admin (spec 12).
  const db = createAdminClient()
  const { data, error } = await (db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Array<{ role_name?: string }> | null; error: unknown }>)('get_user_roles', {
    p_user_id: gate.userId,
  })
  if (error) return { error: 'Failed to verify permissions' }
  const isSuper = (data ?? []).some((r) => r.role_name === 'super_admin')
  if (!isSuper) return { error: 'Insufficient permissions' }
  return { ok: true }
}

async function fetchEmployeeNames(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return map
  const { data, error } = await db
    .from('employees')
    .select('employee_id, first_name, last_name')
    .in('employee_id', unique)
  if (error) throw error
  for (const e of data ?? []) {
    const name = [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown'
    map.set(e.employee_id as string, name)
  }
  return map
}

async function fetchInstanceTitles(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return map
  const { data, error } = await db
    .from('checklist_task_instances')
    .select('id, title_snapshot')
    .in('id', unique)
  if (error) throw error
  for (const i of data ?? []) map.set(i.id as string, (i.title_snapshot as string) ?? 'Unknown task')
  return map
}

// ---------------------------------------------------------------------------
// Spot checks (today)
// ---------------------------------------------------------------------------

interface SpotCheckRow {
  id: string
  instance_id: string
  business_date: string
  draw_number: number
  checked_employee_id: string
  state: 'drawn' | 'recorded'
  result: 'pass' | 'fail' | null
  note: string | null
}

export async function getSpotChecksForToday(
  date?: string,
): Promise<{ data?: SpotCheckView[]; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const businessDate = isIso(date) ? date : getTodayIsoDate()
    const settings = await getChecklistSettings()
    const db = createAdminClient()

    // The atomic draw RPC (migration 20260731000300): sticky, race-free, tops up.
    const { data: rows, error: drawError } = await (db.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: SpotCheckRow[] | null; error: unknown }>)('draw_daily_spot_checks', {
      p_business_date: businessDate,
      p_count: settings.spotChecksPerDay,
    })
    if (drawError) throw drawError

    const spotRows = rows ?? []
    if (spotRows.length === 0) return { data: [] }

    // Join instance (title + checklist), checklist (name) and employee (name).
    const instanceIds = spotRows.map((r) => r.instance_id)
    const { data: instances, error: instError } = await db
      .from('checklist_task_instances')
      .select('id, title_snapshot, checklist_id')
      .in('id', instanceIds)
    if (instError) throw instError

    const instanceMap = new Map<string, { title: string; checklistId: string }>()
    const checklistIds = new Set<string>()
    for (const i of instances ?? []) {
      instanceMap.set(i.id as string, {
        title: (i.title_snapshot as string) ?? 'Unknown task',
        checklistId: i.checklist_id as string,
      })
      checklistIds.add(i.checklist_id as string)
    }

    const checklistNameMap = new Map<string, string>()
    if (checklistIds.size > 0) {
      const { data: checklists, error: clError } = await db
        .from('checklists')
        .select('id, name')
        .in('id', Array.from(checklistIds))
      if (clError) throw clError
      for (const c of checklists ?? []) checklistNameMap.set(c.id as string, c.name as string)
    }

    const employeeMap = await fetchEmployeeNames(
      db,
      spotRows.map((r) => r.checked_employee_id),
    )

    const data: SpotCheckView[] = spotRows
      .map((r) => {
        const inst = instanceMap.get(r.instance_id)
        return {
          id: r.id,
          instanceId: r.instance_id,
          businessDate: r.business_date,
          drawNumber: r.draw_number,
          taskTitle: inst?.title ?? 'Unknown task',
          checklistName: inst ? checklistNameMap.get(inst.checklistId) ?? 'Unknown checklist' : 'Unknown checklist',
          checkedEmployeeId: r.checked_employee_id,
          checkedEmployeeName: employeeMap.get(r.checked_employee_id) ?? 'Unknown',
          state: r.state,
          result: r.result,
          note: r.note,
        }
      })
      .sort((a, b) => a.drawNumber - b.drawNumber)

    return { data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load spot checks' }
  }
}

const recordSchema = z.object({
  spotCheckId: z.string().uuid('Invalid spot check id'),
  result: z.enum(['pass', 'fail']),
  note: z.string().max(2000).optional(),
})

export async function recordSpotCheck(input: {
  spotCheckId: string
  result: 'pass' | 'fail'
  note?: string
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const parsed = recordSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    const db = createAdminClient()
    const { data: existing, error: fetchError } = await db
      .from('checklist_spot_checks')
      .select('id, checked_employee_id')
      .eq('id', parsed.data.spotCheckId)
      .single()
    if (fetchError || !existing) return { error: 'Spot check not found' }

    const { error: updateError } = await db
      .from('checklist_spot_checks')
      .update({
        state: 'recorded',
        result: parsed.data.result,
        note: parsed.data.note?.trim() || null,
        checked_by_user_id: gate.userId,
        recorded_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.spotCheckId)
    if (updateError) throw updateError

    // Audit lands on the CHECKED employee's trail (spec 3.5): resource_id is the checked
    // employee (never the acting user), operation_type MUST stay 'update'.
    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: existing.checked_employee_id as string,
      operation_status: 'success',
      additional_info: { source: 'checklist_spot_check', result: parsed.data.result },
    })

    revalidatePath('/checklists/manage')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to record spot check' }
  }
}

// ---------------------------------------------------------------------------
// Problems (super_admin only)
// ---------------------------------------------------------------------------

interface MissedRow {
  business_date: string
  slot: string
}
interface BreachRow {
  title_snapshot: string
  value_recorded: unknown
  value_unit: string | null
  business_date: string
  completed_by_employee_id: string | null
}
interface MismatchRow {
  business_date: string
  kind: string
  mismatch_minutes: number
}
interface FailRow {
  instance_id: string
  business_date: string
  checked_employee_id: string
  note: string | null
}
interface DrawnRow {
  instance_id: string
  business_date: string
}

export async function getChecklistProblems(
  from?: string,
  to?: string,
): Promise<{ data?: ProblemsData; error?: string }> {
  try {
    const gate = await requireSuperAdmin()
    if ('error' in gate) return { error: gate.error }

    const window = resolveWindow(from, to)
    const db = createAdminClient()

    // 1. Missed instances (grouped by the date's closer; floating -> Venue).
    const missed = await fetchAllRows<MissedRow>(() =>
      db
        .from('checklist_task_instances')
        .select('business_date, slot')
        .eq('state', 'missed')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .order('business_date', { ascending: true })
        .order('id', { ascending: true }),
    )

    // slot 'anytime' == floating (spec 4): venue-level, never personal.
    const calendarDates = new Set<string>()
    let venueMisses = 0
    for (const m of missed) {
      if (m.slot === 'anytime') venueMisses += 1
      else calendarDates.add(m.business_date)
    }

    // Resolve each date's closer once (bounded by the 92-day cap).
    const dateCloser = new Map<string, string | null>()
    await Promise.all(
      Array.from(calendarDates).map(async (d) => {
        const shifts = await getPublishedShiftsForDate(d)
        dateCloser.set(d, resolveCloser(shifts))
      }),
    )

    const missesByCloserId = new Map<string, number>()
    for (const m of missed) {
      if (m.slot === 'anytime') continue
      const closerId = dateCloser.get(m.business_date) ?? null
      if (!closerId) {
        venueMisses += 1 // unpublished week / nobody rostered -> venue-level (spec 6)
      } else {
        missesByCloserId.set(closerId, (missesByCloserId.get(closerId) ?? 0) + 1)
      }
    }

    // 2. Value breaches.
    const breachRows = await fetchAllRows<BreachRow>(() =>
      db
        .from('checklist_task_instances')
        .select('title_snapshot, value_recorded, value_unit, business_date, completed_by_employee_id')
        .eq('state', 'done')
        .eq('value_breach', true)
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .order('business_date', { ascending: true })
        .order('id', { ascending: true }),
    )

    // 3. Hours mismatches.
    const mismatchRows = await fetchAllRows<MismatchRow>(() =>
      db
        .from('checklist_hours_mismatches')
        .select('business_date, kind, mismatch_minutes')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .order('business_date', { ascending: true }),
    )

    // 4. Failed spot checks.
    const failRows = await fetchAllRows<FailRow>(() =>
      db
        .from('checklist_spot_checks')
        .select('instance_id, business_date, checked_employee_id, note')
        .eq('result', 'fail')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .order('business_date', { ascending: true }),
    )

    // 5. Drawn-but-unrecorded spot checks (the signal Billy isn't walking the floor).
    const drawnRows = await fetchAllRows<DrawnRow>(() =>
      db
        .from('checklist_spot_checks')
        .select('instance_id, business_date')
        .eq('state', 'drawn')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .order('business_date', { ascending: true }),
    )

    // Resolve every name/title needed in one round per table.
    const employeeIds = [
      ...missesByCloserId.keys(),
      ...breachRows.map((b) => b.completed_by_employee_id).filter((x): x is string => !!x),
      ...failRows.map((f) => f.checked_employee_id),
    ]
    const employeeMap = await fetchEmployeeNames(db, employeeIds)
    const titleMap = await fetchInstanceTitles(db, [
      ...failRows.map((f) => f.instance_id),
      ...drawnRows.map((d) => d.instance_id),
    ])

    const missesByCloser = [
      ...Array.from(missesByCloserId.entries()).map(([employeeId, count]) => ({
        employeeName: employeeMap.get(employeeId) ?? 'Unknown',
        count,
      })),
      ...(venueMisses > 0 ? [{ employeeName: VENUE, count: venueMisses }] : []),
    ].sort((a, b) => b.count - a.count || a.employeeName.localeCompare(b.employeeName))

    const breaches = breachRows.map((b) => ({
      taskTitle: b.title_snapshot,
      value: num(b.value_recorded),
      unit: b.value_unit,
      businessDate: b.business_date,
      completedByName: b.completed_by_employee_id
        ? employeeMap.get(b.completed_by_employee_id) ?? 'Unknown'
        : null,
    }))

    const mismatches = mismatchRows.map((m) => ({
      businessDate: m.business_date,
      kind: m.kind,
      minutes: m.mismatch_minutes,
    }))

    const failedSpotChecks = failRows.map((f) => ({
      taskTitle: titleMap.get(f.instance_id) ?? 'Unknown task',
      checkedEmployeeName: employeeMap.get(f.checked_employee_id) ?? 'Unknown',
      businessDate: f.business_date,
      note: f.note,
    }))

    const drawnUnrecorded = drawnRows.map((d) => ({
      taskTitle: titleMap.get(d.instance_id) ?? 'Unknown task',
      businessDate: d.business_date,
    }))

    return {
      data: {
        from: window.from,
        to: window.to,
        missesByCloser,
        breaches,
        mismatches,
        failedSpotChecks,
        drawnUnrecorded,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load problems' }
  }
}
