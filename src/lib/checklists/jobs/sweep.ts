// src/lib/checklists/jobs/sweep.ts
// The checklist_sweep job (spec 5.6). Two state-guarded, idempotent updates:
//   (a) pending instances past their grace become missed and lock (instant-based).
//   (b) resolved instances (done/skipped/not_applicable) of a business day that has fully
//       ended lock, so their timeliness can no longer change.
// Service-role admin client (checklist_* is deny-all under RLS).

import { createAdminClient } from '@/lib/supabase/admin'
import { businessDateOf } from '@/lib/checklists/business-day'
import { getChecklistSettings } from '@/lib/checklists/settings'

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
  // The sweep cron runs about 04:00-05:00 London, BEFORE the business-day boundary, so a
  // plain "London date of now" would lock the previous business day while its tasks are
  // still completable. The shared helper resolves the day from the London wall clock, so we
  // only lock rows strictly before the current business date. This used to subtract the
  // start hour from the instant, which was wrong on both clock-change mornings.
  const currentBusinessDate = businessDateOf(now, settings.businessDayStartHour)

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
