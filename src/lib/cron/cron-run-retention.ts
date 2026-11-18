/**
 * Deletes old `cron_job_runs` rows for three log-only jobs (page load performance spec, D3,
 * approved by the owner on 18 November 2026).
 *
 * The rule, and only this rule: rows older than 90 days whose `job_name` is on the allowlist
 * below, and never a row with status `running` (a live lock), whatever its age.
 *
 * It is an allowlist, never the whole table, because some jobs keep a row as a lasting record:
 * `oj-projects-billing-pass` keeps one row per billed month and reads it back to decide whether
 * that month was billed, and `manager-weekly-report` and `invoice-reminders` read their own
 * earlier rows. Before adding a job here, read every reader of its rows. Readers of the three
 * listed jobs (checked 18 November 2026): the two crons' lock checks read only `running` rows
 * and the current time bucket's `run_key`; the daily scheduled jobs check reads the last 24
 * hours; the dashboard reads failed runs from the last 24 hours. `sunday-preorder` has no writer
 * or reader left in the app (its last row is from 22 May 2026).
 *
 * Batches of 5,000 so the first run (about 43,000 rows) never holds a long lock. PostgREST
 * cannot DELETE with a LIMIT, so each batch selects ids (in 1,000-row pages, the API's row cap)
 * and deletes by id in chunks small enough for a request URL. Every delete repeats the
 * allowlist, status and age filters, so a row that changed in between is never removed.
 */
import { shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export const CRON_RUN_RETENTION_DAYS = 90
export const CRON_RUN_RETENTION_JOB_NAMES = [
  'event-guest-engagement',
  'parking-notifications',
  'sunday-preorder',
] as const
export const CRON_RUN_RETENTION_BATCH_SIZE = 5000

/** Supabase returns at most 1,000 rows a request, without an error, so a batch is read in pages. */
const SELECT_PAGE_SIZE = 1000
/** About 3.7 KB of ids in the query string: well inside the gateway's URL limit. */
const DELETE_CHUNK_SIZE = 100

export interface CronRunRetentionResult {
  deleted: number
  /** False when the run stopped at its deadline with rows still to delete; the next run carries on. */
  complete: boolean
  cutoff: string
}

/** The start of the London day 90 calendar days before `now`'s London date. Older rows go. */
export function cronRunRetentionCutoff(now: Date = new Date()): Date {
  const cutoffDate = shiftIsoDate(toLocalIsoDate(now), -CRON_RUN_RETENTION_DAYS)
  const cutoff = cutoffDate ? whenLondonClockReaches(cutoffDate, '00:00') : null
  if (!cutoff) {
    throw new Error(`Could not work out the cron run retention cutoff from ${now.toISOString()}`)
  }
  return cutoff
}

async function selectBatch(supabase: AdminClient, cutoffIso: string): Promise<string[]> {
  const ids: string[] = []
  while (ids.length < CRON_RUN_RETENTION_BATCH_SIZE) {
    const from = ids.length
    const to = Math.min(from + SELECT_PAGE_SIZE, CRON_RUN_RETENTION_BATCH_SIZE) - 1
    const { data, error } = await supabase
      .from('cron_job_runs')
      .select('id')
      .in('job_name', [...CRON_RUN_RETENTION_JOB_NAMES])
      .neq('status', 'running')
      .lt('created_at', cutoffIso)
      .order('id', { ascending: true })
      .range(from, to)
    if (error) {
      throw new Error(`Could not read old cron run records: ${error.message}`)
    }
    const page = (data ?? []) as Array<{ id: string }>
    ids.push(...page.map((row) => row.id))
    if (page.length < to - from + 1) break
  }
  return ids
}

async function deleteChunk(supabase: AdminClient, ids: string[], cutoffIso: string): Promise<number> {
  const { error, count } = await supabase
    .from('cron_job_runs')
    .delete({ count: 'exact' })
    .in('id', ids)
    .in('job_name', [...CRON_RUN_RETENTION_JOB_NAMES])
    .neq('status', 'running')
    .lt('created_at', cutoffIso)
  if (error) {
    throw new Error(`Could not delete old cron run records: ${error.message}`)
  }
  return count ?? 0
}

/**
 * Deletes every allowlisted, non-running `cron_job_runs` row older than the cutoff, batch by
 * batch, until a batch finds nothing. Throws on any read or delete failure so the cron run is
 * seen to fail. Stops cleanly between requests once `deadlineMs` (epoch ms) has passed and
 * reports `complete: false`.
 */
export async function deleteOldCronJobRuns(
  supabase: AdminClient,
  options: { now?: Date; deadlineMs?: number } = {},
): Promise<CronRunRetentionResult> {
  const cutoffIso = cronRunRetentionCutoff(options.now ?? new Date()).toISOString()
  const pastDeadline = (): boolean => options.deadlineMs !== undefined && Date.now() >= options.deadlineMs
  let deleted = 0

  for (;;) {
    if (pastDeadline()) return { deleted, complete: false, cutoff: cutoffIso }

    const ids = await selectBatch(supabase, cutoffIso)
    if (ids.length === 0) return { deleted, complete: true, cutoff: cutoffIso }

    let deletedThisBatch = 0
    for (let start = 0; start < ids.length; start += DELETE_CHUNK_SIZE) {
      if (pastDeadline()) return { deleted, complete: false, cutoff: cutoffIso }
      const removed = await deleteChunk(supabase, ids.slice(start, start + DELETE_CHUNK_SIZE), cutoffIso)
      deletedThisBatch += removed
      deleted += removed
    }

    if (deletedThisBatch === 0) {
      // Rows were found but none went: looping again would find the same rows for ever.
      throw new Error(`Found ${ids.length} old cron run records but deleted none of them`)
    }
    if (ids.length < CRON_RUN_RETENTION_BATCH_SIZE) return { deleted, complete: true, cutoff: cutoffIso }
  }
}
