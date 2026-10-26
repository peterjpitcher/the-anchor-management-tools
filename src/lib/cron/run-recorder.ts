import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Records every run of a scheduled job and tells a person when one fails (BK-116, customer
 * bookings review of 24 October 2026).
 *
 * Six booking crons and the job queue used to fail with a log line and nothing else, and only
 * two booking crons wrote a run record, so the dashboard's "failed crons" count could not see
 * the rest and nothing noticed a job that had stopped running. Wrapping a route's handler in
 * `withCronRun` gives it:
 *
 *   - a `cron_job_runs` row for each run (or, for the jobs that run every few minutes, one row an
 *     hour plus one per failure, so the table does not gain 1,440 rows a day for the job queue);
 *   - a `[CRON FAILURE]` email to CRON_ALERT_EMAIL when the run throws or answers with an error
 *     status, at most once an hour per job (owner decision D17: failed scheduled jobs go to that
 *     inbox), with the run's own counts attached;
 *   - the per-item failure count the route reports (a booking it could not reconcile, say) kept
 *     on the run record, where the daily check (scheduled-jobs-check) adds it up.
 *
 * Recording never changes what the route answers: a database or email problem here is logged
 * and the route's own response goes back as it was. Requests that fail the cron secret are
 * passed straight to the handler (which refuses them) and leave no row, so nobody can fill the
 * table from outside.
 */

export type CronRunRecording = 'every_run' | 'hourly'

export type CronRunOptions = {
  /**
   * `every_run`: a row when the run starts, finished when it ends, so a run cut off at its time
   * limit stays visible as `running`. `hourly`: for jobs that run every few minutes, one
   * completed row per clock hour (the latest clean run in it), plus a row for each run that
   * failed or reported items it could not handle.
   */
  recording: CronRunRecording
  /** Items the run could not handle, read from its JSON answer. Zero when not given. */
  itemFailures?: (body: Record<string, unknown>) => number
}

/** One failure email per job in this many minutes. Every failed run is still recorded. */
export const CRON_FAILURE_ALERT_WINDOW_MINUTES = 60

const SUMMARY_MAX_KEYS = 25

type AdminClient = ReturnType<typeof createAdminClient>

export function hourlyRunKey(at: Date): string {
  return `hour:${at.toISOString().slice(0, 13)}`
}

export function everyRunKey(at: Date): string {
  return `run:${at.toISOString()}`
}

export function failedRunKey(at: Date): string {
  return `failed:${at.toISOString()}`
}

/**
 * The counts a route answered with: top-level numbers and true/false values only, so ids,
 * lists and free text never reach the run record or the alert.
 */
export function summariseRunBody(body: unknown): Record<string, number | boolean> {
  const summary: Record<string, number | boolean> = {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return summary
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (Object.keys(summary).length >= SUMMARY_MAX_KEYS) break
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue
    if (typeof value === 'boolean') summary[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) summary[key] = value
  }
  return summary
}

function countItemFailures(options: CronRunOptions, body: Record<string, unknown> | null): number {
  if (!options.itemFailures || !body) return 0
  try {
    const count = options.itemFailures(body)
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  } catch {
    return 0
  }
}

async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await response.clone().json()) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function describeFailure(thrown: unknown, body: Record<string, unknown> | null, status: number): string {
  if (thrown instanceof Error && thrown.message) return thrown.message
  if (thrown !== null && thrown !== undefined) return String(thrown)
  const bodyError = body?.error
  if (typeof bodyError === 'string' && bodyError.trim()) return `HTTP ${status}: ${bodyError.trim()}`
  return `HTTP ${status}`
}

function adminClientOrNull(jobName: string): AdminClient | null {
  try {
    return createAdminClient()
  } catch (error) {
    logger.error('Cron run recorder: could not create the admin client', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { jobName },
    })
    return null
  }
}

async function insertRunningRow(supabase: AdminClient | null, jobName: string, startedAt: Date): Promise<string | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('cron_job_runs')
      .insert({ job_name: jobName, run_key: everyRunKey(startedAt), status: 'running', started_at: startedAt.toISOString() })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id?: string } | null)?.id ?? null
  } catch (error) {
    logger.error('Cron run recorder: could not record the start of a run', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { jobName },
    })
    return null
  }
}

type RunOutcome = {
  status: 'completed' | 'failed'
  startedAt: Date
  errorMessage: string | null
  result: Record<string, unknown>
}

/** Writes the finished run and returns the id of its row, when there is one. */
async function recordOutcome(
  supabase: AdminClient | null,
  jobName: string,
  options: CronRunOptions,
  runningRowId: string | null,
  outcome: RunOutcome,
): Promise<string | null> {
  if (!supabase) return null
  const finishedAt = new Date().toISOString()
  const fields = {
    status: outcome.status,
    finished_at: finishedAt,
    error_message: outcome.errorMessage ? outcome.errorMessage.slice(0, 2000) : null,
    result: outcome.result,
  }

  try {
    if (runningRowId) {
      const { error } = await supabase.from('cron_job_runs').update(fields).eq('id', runningRowId)
      if (error) throw new Error(error.message)
      return runningRowId
    }

    if (options.recording === 'hourly' && outcome.status === 'completed' && !(Number(outcome.result.itemFailures) > 0)) {
      // The latest clean run in the hour replaces the one before it. A run that reported items it
      // could not handle keeps a row of its own below, so the daily check can add them up.
      const { error } = await supabase
        .from('cron_job_runs')
        .upsert(
          { job_name: jobName, run_key: hourlyRunKey(outcome.startedAt), started_at: outcome.startedAt.toISOString(), ...fields },
          { onConflict: 'job_name,run_key' },
        )
      if (error) throw new Error(error.message)
      return null
    }

    const runKey = outcome.status === 'failed' ? failedRunKey(outcome.startedAt) : everyRunKey(outcome.startedAt)
    const { data, error } = await supabase
      .from('cron_job_runs')
      .insert({ job_name: jobName, run_key: runKey, started_at: outcome.startedAt.toISOString(), ...fields })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id?: string } | null)?.id ?? null
  } catch (error) {
    logger.error('Cron run recorder: could not record the end of a run', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { jobName, status: outcome.status },
    })
    return null
  }
}

/**
 * True when this job already failed in the last hour, in which case that failure was emailed and
 * this one is only recorded. When the check itself cannot be made, the email goes anyway: a
 * duplicate is a smaller problem than a failure nobody hears about.
 */
async function failedRecentlyBefore(
  supabase: AdminClient | null,
  jobName: string,
  currentRowId: string | null,
  now: Date,
): Promise<boolean> {
  if (!supabase) return false
  try {
    let query = supabase
      .from('cron_job_runs')
      .select('id', { count: 'exact', head: true })
      .eq('job_name', jobName)
      .eq('status', 'failed')
      .gte('started_at', new Date(now.getTime() - CRON_FAILURE_ALERT_WINDOW_MINUTES * 60_000).toISOString())
    if (currentRowId) query = query.neq('id', currentRowId)
    const { count, error } = await query
    if (error) throw new Error(error.message)
    return (count ?? 0) > 0
  } catch (error) {
    logger.error('Cron run recorder: could not check for an earlier failure; alerting anyway', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { jobName },
    })
    return false
  }
}

export function withCronRun<Req extends Request>(
  jobName: string,
  handler: (request: Req) => Promise<Response>,
  options: CronRunOptions,
): (request: Req) => Promise<Response> {
  return async function recordedCronRun(request: Req): Promise<Response> {
    if (!authorizeCronRequest(request).authorized) {
      return handler(request)
    }

    const startedAt = new Date()
    const supabase = adminClientOrNull(jobName)
    const runningRowId = options.recording === 'every_run' ? await insertRunningRow(supabase, jobName, startedAt) : null

    let response: Response
    let thrown: unknown = null
    try {
      response = await handler(request)
    } catch (error) {
      thrown = error ?? new Error('The job threw without an error')
      logger.error(`Cron ${jobName} threw`, {
        error: error instanceof Error ? error : new Error(String(error)),
      })
      response = NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }

    try {
      const body = await readJsonBody(response)
      const itemFailures = countItemFailures(options, body)
      const result: Record<string, unknown> = {
        ...summariseRunBody(body),
        httpStatus: response.status,
        durationMs: Date.now() - startedAt.getTime(),
        itemFailures,
      }
      const failed = thrown !== null || response.status >= 400
      const errorMessage = failed ? describeFailure(thrown, body, response.status) : null

      const rowId = await recordOutcome(supabase, jobName, options, runningRowId, {
        status: failed ? 'failed' : 'completed',
        startedAt,
        errorMessage,
        result,
      })

      if (failed && !(await failedRecentlyBefore(supabase, jobName, rowId, startedAt))) {
        await reportCronFailure(jobName, thrown ?? new Error(errorMessage ?? 'Unknown failure'), {
          ...result,
          note: `Any further failure of this job in the next ${CRON_FAILURE_ALERT_WINDOW_MINUTES} minutes is recorded but not emailed. The daily scheduled jobs check lists them all.`,
        })
      }
    } catch (error) {
      logger.error('Cron run recorder failed after the run', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { jobName },
      })
    }

    return response
  }
}
