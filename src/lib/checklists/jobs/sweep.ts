// src/lib/checklists/jobs/sweep.ts
// The checklist_sweep job (spec 5.6). Two state-guarded, idempotent updates:
//   (a) pending instances past their grace become missed and lock (instant-based).
//   (b) resolved instances (done/skipped/not_applicable) of a business day that has fully
//       ended lock, so their timeliness can no longer change.
// Service-role admin client (checklist_* is deny-all under RLS).

import { formatInTimeZone } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'

const TZ = 'Europe/London'

export async function runSweep(): Promise<Record<string, unknown>> {
  const db = createAdminClient()
  const settings = await getChecklistSettings()
  const now = new Date()
  const nowIso = now.toISOString()

  // (a) Pending past grace -> missed (+lock). Instant-based on grace_until, correct as-is.
  const { data: missedRows, error: missedErr } = await db
    .from('checklist_task_instances')
    .update({ state: 'missed', locked_at: nowIso })
    .eq('state', 'pending')
    .lt('grace_until', nowIso)
    .select('id')
  if (missedErr) throw missedErr

  // (b) Lock resolved rows of business days that have fully ended.
  //
  // The current business date is the London calendar date of (now - businessDayStartHour
  // hours). The sweep cron runs about 04:00-05:00 London, BEFORE the 06:00 business-day
  // boundary, so a plain "London date of now" would lock the previous business day while its
  // tasks are still completable. Shifting back by the start hour keeps a day open until it has
  // truly ended, and we only lock rows strictly before the current business date.
  const shifted = new Date(now.getTime() - settings.businessDayStartHour * 60 * 60 * 1000)
  const currentBusinessDate = formatInTimeZone(shifted, TZ, 'yyyy-MM-dd')

  const { data: lockedRows, error: lockedErr } = await db
    .from('checklist_task_instances')
    .update({ locked_at: nowIso })
    .in('state', ['done', 'skipped', 'not_applicable'])
    .is('locked_at', null)
    .lt('business_date', currentBusinessDate)
    .select('id')
  if (lockedErr) throw lockedErr

  return {
    missed: missedRows?.length ?? 0,
    locked: lockedRows?.length ?? 0,
    currentBusinessDate,
  }
}
