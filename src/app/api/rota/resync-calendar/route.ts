import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getOAuth2Client } from '@/lib/google-calendar'
import type { RotaShiftRow } from '@/lib/google-calendar-rota'

export const dynamic = 'force-dynamic'
export const maxDuration = 800

/** Simple bounded-concurrency runner — processes items with at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let idx = 0

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

const SYNC_LOCK_KEY = 'rota_sync_lock'
const LOCK_STALE_MS = 10 * 60 * 1000 // 10 minutes

export async function POST(_req: NextRequest): Promise<NextResponse> {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const canPublish = await checkUserPermission('rota', 'publish')
  if (!canPublish) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const admin = createAdminClient()

  // -- Concurrency guard: prevent overlapping syncs -------------------------
  const { data: lockRow } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', SYNC_LOCK_KEY)
    .single()

  if (lockRow?.value) {
    const lockValue = lockRow.value as { in_progress?: boolean; started_at?: string }
    if (lockValue.in_progress && lockValue.started_at) {
      const elapsed = Date.now() - new Date(lockValue.started_at).getTime()
      if (elapsed < LOCK_STALE_MS) {
        return NextResponse.json(
          { error: 'Calendar sync already in progress' },
          { status: 409 }
        )
      }
      // Lock is stale (>10 min) — treat as crashed and proceed
    }
  }

  // Acquire lock
  await admin.from('system_settings').upsert(
    { key: SYNC_LOCK_KEY, value: { in_progress: true, started_at: new Date().toISOString() } },
    { onConflict: 'key' }
  )

  try {
    const { data: weeks, error } = await admin
      .from('rota_weeks')
      .select('id, week_start')
      .eq('status', 'published')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const weekIds = (weeks ?? []).map(w => w.id)

    if (weekIds.length === 0) {
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'update',
        resource_type: 'rota_calendar_sync',
        operation_status: 'success',
        additional_info: { weeksSynced: 0 },
      })
      return NextResponse.json({
        success: true,
        weeksSynced: 0,
        totalCreated: 0,
        totalUpdated: 0,
        totalFailed: 0,
        errors: [],
      })
    }

    // -- Fetch ALL shifts for all published weeks in a single query ----------
    const { data: allShifts } = await admin
      .from('rota_published_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
      .in('week_id', weekIds)

    const shiftsByWeek = new Map<string, RotaShiftRow[]>()
    for (const shift of (allShifts ?? []) as RotaShiftRow[]) {
      const arr = shiftsByWeek.get(shift.week_id) ?? []
      arr.push(shift)
      shiftsByWeek.set(shift.week_id, arr)
    }

    const weekStartMap = new Map<string, string>()
    for (const w of weeks ?? []) {
      weekStartMap.set(w.id, w.week_start as string)
    }

    // -- Fetch ALL employee names once --------------------------------------
    const employeeIds = [...new Set(
      (allShifts ?? []).filter(s => s.employee_id).map(s => s.employee_id!)
    )]

    const employeeNames = new Map<string, string>()
    if (employeeIds.length > 0) {
      const { data: employees } = await admin
        .from('employees')
        .select('employee_id, first_name, last_name')
        .in('employee_id', employeeIds)

      for (const e of employees ?? []) {
        employeeNames.set(
          e.employee_id,
          [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown'
        )
      }
    }

    // -- Create OAuth client once -------------------------------------------
    const auth = await getOAuth2Client()

    const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota')

    let weeksSynced = 0
    let totalCreated = 0
    let totalUpdated = 0
    let totalFailed = 0
    const errors: string[] = []

    // -- Process weeks with bounded concurrency (2 at a time) ----------------
    // Reduced from 3 to 2 to stay within Google Calendar API rate limits.
    // Each week uses 5-shift batches with 500ms pause (see google-calendar-rota.ts).
    await mapWithConcurrency(weekIds, 2, async (weekId) => {
      const shifts = shiftsByWeek.get(weekId) ?? []
      try {
        const result = await syncRotaWeekToCalendar(weekId, shifts, {
          employeeNames,
          auth,
          weekStart: weekStartMap.get(weekId),
        })
        weeksSynced++
        totalCreated += result.created
        totalUpdated += result.updated
        totalFailed += result.failed
      } catch (err: unknown) {
        console.error('[RotaCalendar] resync failed for week', weekId, err)
        errors.push(`Week ${weekId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    })

    // -- Audit log ----------------------------------------------------------
    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'rota_calendar_sync',
      operation_status: errors.length > 0 ? 'failure' : 'success',
      additional_info: { weeksSynced, totalCreated, totalUpdated, totalFailed, errorCount: errors.length },
    })

    return NextResponse.json({
      success: true,
      weeksSynced,
      totalCreated,
      totalUpdated,
      totalFailed,
      errors,
    })
  } finally {
    // -- Release lock -------------------------------------------------------
    await admin.from('system_settings').upsert(
      { key: SYNC_LOCK_KEY, value: { in_progress: false, started_at: null } },
      { onConflict: 'key' }
    )
  }
}
