'use server'

// Read-only weekly checklist review action for super admins (Phase 4, oversight).
//   getWeeklyReview -> super_admin only (mirrors the Problems gate in checklists-spotcheck).
// checklist_* tables are deny-all under RLS, so every read uses the service-role admin client.
// This action never mutates: no audit log, no revalidatePath (matches insights/problems).
// The heavy lifting (week maths, cell-state resolution, row assembly) lives in the pure
// helpers at src/lib/checklists/weekly-review.ts. See tasks/checklist-weekly-review-plan.md
// (Task 4) for the full contract and the data facts this respects.

import { checkUserPermission } from './rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getBusinessWeek,
  assembleWeeklyReview,
  type ReviewInstanceInput,
} from '@/lib/checklists/weekly-review'
import type { WeeklyReview, DateHealth } from '@/types/checklists-review'

// ---------------------------------------------------------------------------
// Local helpers (duplicated from checklists-spotcheck rather than edited there,
// so the working spot-check action is never touched).
// ---------------------------------------------------------------------------

const PAGE = 1000

// Least-privilege column list: exactly the ReviewInstanceInput fields the assembler needs.
// `notes` is deliberately never selected (free-text, not required for the grid).
const INSTANCE_COLUMNS =
  'id, template_id, slot, business_date, department, title_snapshot, state, ' +
  'completed_by_employee_id, completed_at, was_late, value_recorded, value_unit, ' +
  'value_breach, skip_reason'

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
  // restrict a screen to super_admin.
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

/** Map a stored generation-run status to the DateHealth union. Unknown/in-flight statuses
 * fall back to 'failed' so an incomplete day never renders its blank cells as clean not-due. */
function toDateHealth(status: string | null): DateHealth {
  switch (status) {
    case 'complete':
      return 'complete'
    case 'running':
      return 'running'
    case 'skipped_closed':
      return 'skipped_closed'
    case 'failed':
      return 'failed'
    default:
      return 'failed'
  }
}

// ---------------------------------------------------------------------------
// Row shapes for the enrichment reads (snake_case straight from the DB).
// ---------------------------------------------------------------------------

interface GenerationRunRow {
  business_date: string
  status: string | null
  started_at: string | null
  finished_at: string | null
}

interface FailedSpotCheckRow {
  instance_id: string
}

interface EmployeeRow {
  employee_id: string
  first_name: string | null
  last_name: string | null
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

export async function getWeeklyReview(
  weekStartIso: string,
  filters?: { department?: string; slot?: string },
): Promise<{ data?: WeeklyReview; error?: string }> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: gate.error }

  const { weekStart, weekDates } = getBusinessWeek(weekStartIso)
  const weekEnd = weekDates[6]
  const db = createAdminClient()
  const warnings: string[] = []

  // 1. Instances for the 7-day range (hard error if this read fails). Least-privilege
  // column selection; optional department filter. Paginated with a stable order so the
  // range-based paging never skips or repeats a row.
  let instances: ReviewInstanceInput[]
  try {
    instances = await fetchAllRows<ReviewInstanceInput>(() => {
      let query = db.from('checklist_task_instances').select(INSTANCE_COLUMNS)
      if (filters?.department) query = query.eq('department', filters.department)
      return query
        .gte('business_date', weekStart)
        .lte('business_date', weekEnd)
        .order('business_date', { ascending: true })
        .order('id', { ascending: true })
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load checklist instances' }
  }

  // 2. Per-date generation health. Every weekDate defaults to 'none'; the LATEST run per
  // date wins. A failure here degrades to a warning rather than sinking the whole report.
  const dateHealth: Record<string, DateHealth> = {}
  for (const date of weekDates) dateHealth[date] = 'none'
  try {
    const runs = (await db
      .from('checklist_generation_runs')
      .select('business_date, status, started_at, finished_at')
      .gte('business_date', weekStart)
      .lte('business_date', weekEnd)
      .order('finished_at', { ascending: false, nullsFirst: false })
      .order('started_at', { ascending: false })) as { data: GenerationRunRow[] | null; error: unknown }
    if (runs.error) throw runs.error
    const seen = new Set<string>()
    for (const run of runs.data ?? []) {
      if (seen.has(run.business_date)) continue
      seen.add(run.business_date)
      if (dateHealth[run.business_date] !== undefined) {
        dateHealth[run.business_date] = toDateHealth(run.status)
      }
    }
  } catch {
    warnings.push('Generation health could not be loaded; blank days may be inaccurate.')
  }

  // 3. Failed spot checks in range -> Set of the flagged instance ids.
  let failedSpotCheckIds = new Set<string>()
  try {
    const spot = (await db
      .from('checklist_spot_checks')
      .select('instance_id')
      .eq('result', 'fail')
      .gte('business_date', weekStart)
      .lte('business_date', weekEnd)) as { data: FailedSpotCheckRow[] | null; error: unknown }
    if (spot.error) throw spot.error
    failedSpotCheckIds = new Set((spot.data ?? []).map((row) => row.instance_id))
  } catch {
    warnings.push('Spot-check results could not be loaded; failures are not flagged.')
  }

  // 4. Employee display names for completers (Unknown fallback, no active-status filter).
  const nameMap: Record<string, string> = {}
  const completerIds = Array.from(
    new Set(
      instances
        .map((instance) => instance.completed_by_employee_id)
        .filter((id): id is string => Boolean(id)),
    ),
  )
  if (completerIds.length > 0) {
    try {
      const employees = (await db
        .from('employees')
        .select('employee_id, first_name, last_name')
        .in('employee_id', completerIds)) as { data: EmployeeRow[] | null; error: unknown }
      if (employees.error) throw employees.error
      for (const employee of employees.data ?? []) {
        const name = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown'
        nameMap[employee.employee_id] = name
      }
    } catch {
      warnings.push('Employee names could not be loaded; completers show as Unknown.')
    }
  }

  // 5. Assemble. `assembledAt` is supplied here at the I/O boundary (the pure helper never
  // reads the clock itself).
  const assembledAt = new Date().toISOString()
  const { rows, departments } = assembleWeeklyReview({
    weekDates,
    instances,
    nameMap,
    failedSpotCheckIds,
    dateHealth,
    assembledAt,
  })

  return {
    data: {
      weekStart,
      weekDates,
      dateHealth,
      departments,
      rows,
      updatedAt: assembledAt,
      warnings,
    },
  }
}
