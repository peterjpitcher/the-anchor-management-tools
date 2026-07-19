// src/lib/checklists/jobs/retention.ts
// checklist_retention_purge job (decision 27: keep records 24 months). Deletes checklist
// data whose business date is strictly older than the cutoff. Ships dark and, since no row
// can reach 24 months old before mid-2028, is a no-op until then. Deletes children before
// parents (checklist_spot_checks references checklist_task_instances with no cascade).
import { subMonths } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'

const RETENTION_MONTHS = 24
const TZ = 'Europe/London'

export async function runRetentionPurge(): Promise<Record<string, unknown>> {
  const db = createAdminClient()
  const cutoff = formatInTimeZone(subMonths(new Date(), RETENTION_MONTHS), TZ, 'yyyy-MM-dd')

  // Spot checks first (they reference instances), then instances, then the standalone
  // per-date tables. Old delivered/failed outbox rows are pruned by created_at.
  const outcomes: Record<string, unknown> = { cutoff }

  const spot = await db
    .from('checklist_spot_checks')
    .delete({ count: 'exact' })
    .lt('business_date', cutoff)
  if (spot.error) throw spot.error
  outcomes.spotChecks = spot.count ?? 0

  const instances = await db
    .from('checklist_task_instances')
    .delete({ count: 'exact' })
    .lt('business_date', cutoff)
  if (instances.error) throw instances.error
  outcomes.instances = instances.count ?? 0

  const expectations = await db
    .from('checklist_spot_check_expectations')
    .delete({ count: 'exact' })
    .lt('business_date', cutoff)
  if (expectations.error) throw expectations.error
  outcomes.expectations = expectations.count ?? 0

  const mismatches = await db
    .from('checklist_hours_mismatches')
    .delete({ count: 'exact' })
    .lt('business_date', cutoff)
  if (mismatches.error) throw mismatches.error
  outcomes.mismatches = mismatches.count ?? 0

  const runs = await db
    .from('checklist_generation_runs')
    .delete({ count: 'exact' })
    .lt('business_date', cutoff)
  if (runs.error) throw runs.error
  outcomes.generationRuns = runs.count ?? 0

  const cutoffTs = subMonths(new Date(), RETENTION_MONTHS).toISOString()
  const outbox = await db
    .from('checklist_email_outbox')
    .delete({ count: 'exact' })
    .in('status', ['sent', 'failed'])
    .lt('created_at', cutoffTs)
  if (outbox.error) throw outbox.error
  outcomes.outbox = outbox.count ?? 0

  return outcomes
}
