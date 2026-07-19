'use server'

// Phase 3 (oversight) insights actions for the checklists feature. Super_admin only:
// every metric is individual-attributable, so it is gated on `checklists:manage` AND an
// explicit super_admin role check (super_admin short-circuits permission rows, so this is
// how the screen is restricted, spec section 12).
//
// Metrics are computed over LOCKED business days only (locked_at is not null) inside the
// [from,to] window (default rolling 30 days, max 92). Every read is paginated because a
// 92-day window (~5,300 instance rows) exceeds Supabase's 1000-row cap (spec 7, 9.4).

import { checkUserPermission } from './rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { scoreTimeliness } from '@/lib/checklists/scoring'
import type { ScoredInstance, Band } from '@/lib/checklists/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonTimeliness {
  employeeId: string
  name: string
  score: number | null
  count: number
  band: Band | null
}

export interface InsightsData {
  from: string
  to: string
  venueCompletionRate: number | null
  lateRate: number | null
  perPerson: PersonTimeliness[]
  byDayPart: {
    open: number | null
    service: number | null
    close: number | null
    floating: number | null
  }
  spotCheckRecorded: number
  spotCheckExpected: number
  spotCheckPassRate: number | null
}

// ---------------------------------------------------------------------------
// Window + pagination helpers
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

/**
 * Page through a query in 1000-row batches until a short page (asserts completeness).
 * `build` returns a fresh Supabase query builder each call; `any` because the builder's
 * chained generic type is not worth reconstructing here (house pattern, see mileage.ts).
 */
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

async function requireSuperAdmin(): Promise<{ ok: true } | { error: string }> {
  const canManage = await checkUserPermission('checklists', 'manage')
  if (!canManage) return { error: 'Insufficient permissions' }
  const { user_id } = await getCurrentUser()
  if (!user_id) return { error: 'Unauthorized' }

  // super_admin bypasses permission rows, so an explicit role check is the only way to
  // restrict a screen to super_admin (spec 12). Same mechanism as PermissionService.
  const db = createAdminClient()
  const { data, error } = await (db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Array<{ role_name?: string }> | null; error: unknown }>)('get_user_roles', {
    p_user_id: user_id,
  })
  if (error) return { error: 'Failed to verify permissions' }
  const isSuper = (data ?? []).some((r) => r.role_name === 'super_admin')
  if (!isSuper) return { error: 'Insufficient permissions' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Day-part bucketing
// ---------------------------------------------------------------------------

type DayPart = 'open' | 'service' | 'close' | 'floating'

function bucketOf(slot: string): DayPart {
  if (slot === 'open') return 'open'
  if (slot === 'close') return 'close'
  if (slot === 'anytime') return 'floating'
  return 'service' // an HH:MM slot (every/at_times)
}

function rate(done: number, missed: number): number | null {
  const denom = done + missed
  return denom === 0 ? null : done / denom
}

// ---------------------------------------------------------------------------
// Main action
// ---------------------------------------------------------------------------

interface InstanceRow {
  business_date: string
  slot: string
  state: string
  was_late: boolean
  completed_by_employee_id: string | null
  completed_at: string | null
  grace_until: string
}

interface ExpectationRow {
  business_date: string
  expected: number
}

interface SpotRow {
  business_date: string
  state: string
  result: string | null
}

export async function getChecklistInsights(
  from?: string,
  to?: string,
): Promise<{ data?: InsightsData; error?: string }> {
  try {
    const gate = await requireSuperAdmin()
    if ('error' in gate) return { error: gate.error }

    const window = resolveWindow(from, to)
    const db = createAdminClient()

    // Locked instances in the window (locked_at not null => a settled business day).
    const instances = await fetchAllRows<InstanceRow>(() =>
      db
        .from('checklist_task_instances')
        .select('business_date, slot, state, was_late, completed_by_employee_id, completed_at, grace_until')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .not('locked_at', 'is', null)
        .order('business_date', { ascending: true })
        .order('id', { ascending: true }),
    )

    // A day is only "settled" when EVERY instance for it is locked. The sweep locks a day's
    // misses ~24h before its dones, so a day with only its misses locked would read near-0%
    // completion until the next morning. Exclude any date that still has an unlocked instance
    // so metrics never change after they first appear (spec 7 "locked days only").
    const unsettled = await fetchAllRows<{ business_date: string }>(() =>
      db
        .from('checklist_task_instances')
        .select('business_date')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .is('locked_at', null)
        .order('business_date', { ascending: true })
        .order('id', { ascending: true }),
    )
    const unsettledDates = new Set(unsettled.map((r) => r.business_date))
    const settledDates = new Set(
      instances.map((i) => i.business_date).filter((d) => !unsettledDates.has(d)),
    )

    // Venue completion + late rate.
    let doneCount = 0
    let missedCount = 0
    let doneLate = 0
    const perBucket: Record<DayPart, { done: number; missed: number }> = {
      open: { done: 0, missed: 0 },
      service: { done: 0, missed: 0 },
      close: { done: 0, missed: 0 },
      floating: { done: 0, missed: 0 },
    }
    // Group completed instances by completer for timeliness scoring.
    const byPerson = new Map<string, ScoredInstance[]>()

    for (const inst of instances) {
      if (unsettledDates.has(inst.business_date)) continue // skip partially-settled days
      const bucket = bucketOf(inst.slot)
      if (inst.state === 'done') {
        doneCount += 1
        perBucket[bucket].done += 1
        if (inst.was_late) doneLate += 1
        if (inst.completed_by_employee_id && inst.completed_at) {
          const list = byPerson.get(inst.completed_by_employee_id) ?? []
          list.push({
            completedAt: new Date(inst.completed_at),
            graceUntil: new Date(inst.grace_until),
          })
          byPerson.set(inst.completed_by_employee_id, list)
        }
      } else if (inst.state === 'missed') {
        missedCount += 1
        perBucket[bucket].missed += 1
      }
      // skipped / not_applicable excluded from every denominator (spec 9.4).
    }

    // Resolve completer names (leavers included: never hard-deleted, still reportable).
    const employeeIds = Array.from(byPerson.keys())
    const nameMap = await fetchEmployeeNames(db, employeeIds)

    const perPerson: PersonTimeliness[] = employeeIds
      .map((employeeId) => {
        const scored = scoreTimeliness(byPerson.get(employeeId) ?? [])
        return {
          employeeId,
          name: nameMap.get(employeeId) ?? 'Unknown',
          score: scored.score,
          count: scored.count,
          band: scored.band,
        }
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.count - a.count || a.name.localeCompare(b.name))

    // Spot checks over the same locked business days.
    const expectations = await fetchAllRows<ExpectationRow>(() =>
      db
        .from('checklist_spot_check_expectations')
        .select('business_date, expected')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .order('business_date', { ascending: true }),
    )
    const spotChecks = await fetchAllRows<SpotRow>(() =>
      db
        .from('checklist_spot_checks')
        .select('business_date, state, result')
        .gte('business_date', window.from)
        .lte('business_date', window.to)
        .order('business_date', { ascending: true })
        .order('draw_number', { ascending: true }),
    )

    const spotCheckExpected = expectations
      .filter((e) => settledDates.has(e.business_date))
      .reduce((sum, e) => sum + (e.expected ?? 0), 0)

    let spotCheckRecorded = 0
    let spotCheckPass = 0
    for (const sc of spotChecks) {
      if (!settledDates.has(sc.business_date)) continue
      if (sc.state === 'recorded') {
        spotCheckRecorded += 1
        if (sc.result === 'pass') spotCheckPass += 1
      }
    }

    return {
      data: {
        from: window.from,
        to: window.to,
        venueCompletionRate: rate(doneCount, missedCount),
        lateRate: doneCount === 0 ? null : doneLate / doneCount,
        perPerson,
        byDayPart: {
          open: rate(perBucket.open.done, perBucket.open.missed),
          service: rate(perBucket.service.done, perBucket.service.missed),
          close: rate(perBucket.close.done, perBucket.close.missed),
          floating: rate(perBucket.floating.done, perBucket.floating.missed),
        },
        spotCheckRecorded,
        spotCheckExpected,
        spotCheckPassRate: spotCheckRecorded === 0 ? null : spotCheckPass / spotCheckRecorded,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load insights' }
  }
}

// ---------------------------------------------------------------------------
// Employee name lookup (shared shape with problems)
// ---------------------------------------------------------------------------

async function fetchEmployeeNames(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  const { data, error } = await db
    .from('employees')
    .select('employee_id, first_name, last_name')
    .in('employee_id', ids)
  if (error) throw error
  for (const e of data ?? []) {
    const name = [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown'
    map.set(e.employee_id as string, name)
  }
  return map
}
