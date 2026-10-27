import type { SupabaseClient } from '@supabase/supabase-js'
import { getLocalIsoDateDaysAgo, whenLondonClockReaches } from '@/lib/dateUtils'

/**
 * How long finished background jobs are kept (BK-214, customer bookings review of 24 October 2026;
 * owner decision D36: clear job history older than 90 days).
 *
 * Nothing ever cleared the jobs table. Its payloads hold phone numbers and message text, and on
 * 26 October 2026 it held 4,479 rows, 2,188 of them finished more than 90 days earlier (1,021
 * failed reminders of a job type retired in 2025). Only finished jobs are touched: completed,
 * failed and cancelled. Pending and processing jobs are never deleted, whatever their age.
 *
 * The job ships SWITCHED OFF, like the other retention jobs. JOB_HISTORY_RETENTION decides what it
 * does:
 *   unset or 'dry_run'  counts what it would delete and changes nothing (the default)
 *   'delete'            deletes it
 *   'off'               does not run at all
 * The owner switches it to 'delete' after seeing a dry run.
 */
export const JOB_HISTORY_RETENTION_DAYS = 90

export const FINISHED_JOB_STATUSES = ['completed', 'failed', 'cancelled'] as const

/** Ids are deleted in batches so one run stays inside the cron's time limit and URL limits. */
const DELETE_BATCH_SIZE = 500
/** At most this many batches a run (25,000 rows); anything left over goes the next week. */
const MAX_DELETE_BATCHES = 50

export type JobHistoryRetentionMode = 'off' | 'dry_run' | 'delete'

export function resolveJobHistoryRetentionMode(
  value: string | undefined = process.env.JOB_HISTORY_RETENTION,
): JobHistoryRetentionMode {
  const normalised = (value ?? '').trim().toLowerCase()
  if (normalised === 'delete') return 'delete'
  if (normalised === 'off') return 'off'
  return 'dry_run'
}

export type JobHistoryRetentionResult = {
  mode: JobHistoryRetentionMode
  /** Jobs created before this instant (London midnight, 90 days ago) are due. */
  cutoffIso: string | null
  /** Finished jobs older than the cutoff when the run started. */
  due: number
  deleted: number
}

/** The London midnight that starts the day 90 days ago, as an instant. */
export function jobHistoryCutoffIso(): string {
  const cutoffDate = getLocalIsoDateDaysAgo(JOB_HISTORY_RETENTION_DAYS)
  const cutoff = whenLondonClockReaches(cutoffDate, '00:00')
  if (!cutoff) {
    throw new Error(`Could not work out the job history cutoff for ${cutoffDate}`)
  }
  return cutoff.toISOString()
}

// Typed loosely on purpose: the generated Database type is not threaded through the cron.
type JobsClient = SupabaseClient<any, 'public', any>

export async function runJobHistoryRetention(
  db: JobsClient,
  options: { mode: JobHistoryRetentionMode },
): Promise<JobHistoryRetentionResult> {
  if (options.mode === 'off') {
    return { mode: 'off', cutoffIso: null, due: 0, deleted: 0 }
  }

  const cutoffIso = jobHistoryCutoffIso()

  const { count, error: countError } = await db
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', [...FINISHED_JOB_STATUSES])
    .lt('created_at', cutoffIso)

  if (countError) {
    throw new Error(`Could not count old job history: ${countError.message}`)
  }

  const due = count ?? 0
  if (options.mode === 'dry_run' || due === 0) {
    return { mode: options.mode, cutoffIso, due, deleted: 0 }
  }

  let deleted = 0
  for (let batch = 0; batch < MAX_DELETE_BATCHES; batch++) {
    const { data: rows, error: readError } = await db
      .from('jobs')
      .select('id')
      .in('status', [...FINISHED_JOB_STATUSES])
      .lt('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .limit(DELETE_BATCH_SIZE)

    if (readError) {
      throw new Error(`Could not read old job history: ${readError.message}`)
    }

    const ids = ((rows ?? []) as Array<{ id: string }>).map((row) => row.id)
    if (ids.length === 0) break

    // The status and age are checked again on the delete, so a job retried between the read and
    // the delete (put back to pending) is never removed.
    const { data: removed, error: deleteError } = await db
      .from('jobs')
      .delete()
      .in('id', ids)
      .in('status', [...FINISHED_JOB_STATUSES])
      .lt('created_at', cutoffIso)
      .select('id')

    if (deleteError) {
      throw new Error(`Could not delete old job history: ${deleteError.message}`)
    }

    deleted += (removed ?? []).length
    if (ids.length < DELETE_BATCH_SIZE) break
  }

  return { mode: 'delete', cutoffIso, due, deleted }
}
