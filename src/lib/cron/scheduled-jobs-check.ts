import { escapeHtml, redactPii } from '@/lib/cron/alerting'
import { allowedGapMinutes, MONITORED_CRON_JOBS, type MonitoredCronJob } from '@/lib/cron/monitored-jobs'
import { formatDateInLondon, formatTimeInLondon } from '@/lib/dateUtils'
import { STAFF } from '@/lib/brand/palette'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * The daily check that scheduled jobs ran (BK-116, customer bookings review of 24 October 2026).
 *
 * A failure email only goes when a job runs and fails. A job that stops running altogether (a
 * schedule lost in a deploy, a route that no longer builds, a run cut off at its time limit
 * every time) sends nothing, so this looks back over the last 24 hours of `cron_job_runs` for
 * each job in MONITORED_CRON_JOBS and lists:
 *
 *   - a silence longer than twice the job's interval (see allowedGapMinutes);
 *   - runs that failed, with the last error;
 *   - items the job reported it could not handle;
 *   - runs still marked running after their time limit, which it marks failed so the dashboard
 *     counts them;
 *
 * and from the job queue: jobs that failed for good, jobs waiting more than an hour past their
 * time, and jobs stuck mid-run with an expired lease.
 */

type AdminClient = ReturnType<typeof createAdminClient>

export const CHECK_WINDOW_HOURS = 24
const OVERDUE_PENDING_MINUTES = 60
const STALLED_LEASE_MINUTES = 15
const UNFINISHED_GRACE_SECONDS = 120
const ROW_LIMIT = 1000

export const UNFINISHED_RUN_MESSAGE =
  'Did not finish: still marked running after its time limit, so it was most likely cut off. Marked failed by the daily scheduled jobs check.'

export type MissedRun = {
  /** The last completed run before the silence, or null when none was found. */
  from: string | null
  /** When the silence ended, or null when it is still going on. */
  until: string | null
  minutes: number
}

export type JobFinding = {
  jobName: string
  label: string
  intervalMinutes: number
  maxDurationSeconds: number
  missedRun: MissedRun | null
  failedRuns: number
  lastError: string | null
  itemFailures: number
  unfinishedRuns: number
  /** Set when the run records could not be read at all. */
  readError: string | null
}

export type QueueFinding = {
  failedJobs: Array<{ type: string; count: number }>
  overduePending: number
  stalledProcessing: number
  readError: string | null
}

export type ScheduledJobsReport = {
  checkedAt: string
  windowHours: number
  /** Only the jobs with something to report. */
  jobs: JobFinding[]
  /** Null when the queue has nothing to report. */
  queue: QueueFinding | null
  problemCount: number
}

type RunRow = {
  id: string
  status: string
  started_at: string
  finished_at: string | null
  error_message: string | null
  result: unknown
}

function itemFailuresOf(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  const value = (result as Record<string, unknown>).itemFailures
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * The longest silence between completed runs that is longer than the job allows and touches the
 * window. A silence that ended before the window opened was reported the day before.
 *
 * A job that records through withCronRun and has no completed run at all is only called missing
 * once run recording has been on for longer than the job allows (`watchedSinceMs`, the first run
 * any such job recorded). Without that, the first morning after this went live would report every
 * daily job that had not yet had its first run.
 */
export function findMissedRun(
  completedAtMs: number[],
  job: Pick<MonitoredCronJob, 'intervalMinutes' | 'recording'>,
  nowMs: number,
  windowStartMs: number,
  watchedSinceMs: number | null = null,
): MissedRun | null {
  const allowedMs = allowedGapMinutes(job) * 60_000
  const points = [...completedAtMs].sort((a, b) => a - b)

  if (points.length === 0) {
    const tooSoonToTell = job.recording !== 'own' && (watchedSinceMs === null || nowMs - watchedSinceMs <= allowedMs)
    if (tooSoonToTell) return null
    return { from: null, until: null, minutes: Math.round((nowMs - windowStartMs) / 60_000) }
  }

  let worst: MissedRun | null = null
  const consider = (fromMs: number, untilMs: number | null) => {
    const endMs = untilMs ?? nowMs
    if (endMs - fromMs <= allowedMs || endMs <= windowStartMs) return
    const minutes = Math.round((endMs - fromMs) / 60_000)
    if (!worst || minutes > worst.minutes) {
      worst = { from: new Date(fromMs).toISOString(), until: untilMs === null ? null : new Date(untilMs).toISOString(), minutes }
    }
  }

  for (let index = 1; index < points.length; index += 1) consider(points[index - 1], points[index])
  consider(points[points.length - 1], null)
  return worst
}

async function checkJob(supabase: AdminClient, job: MonitoredCronJob, now: Date, watchedSinceMs: number | null): Promise<JobFinding> {
  const nowMs = now.getTime()
  const windowStartMs = nowMs - CHECK_WINDOW_HOURS * 3_600_000
  const lookbackStartMs = windowStartMs - allowedGapMinutes(job) * 60_000
  const finding: JobFinding = {
    jobName: job.jobName,
    label: job.label,
    intervalMinutes: job.intervalMinutes,
    maxDurationSeconds: job.maxDurationSeconds,
    missedRun: null,
    failedRuns: 0,
    lastError: null,
    itemFailures: 0,
    unfinishedRuns: 0,
    readError: null,
  }

  const { data, error } = await supabase
    .from('cron_job_runs')
    .select('id, status, started_at, finished_at, error_message, result')
    .eq('job_name', job.jobName)
    .gte('started_at', new Date(lookbackStartMs).toISOString())
    .order('started_at', { ascending: true })
    .limit(ROW_LIMIT)

  if (error) {
    finding.readError = error.message
    return finding
  }

  const rows = (data ?? []) as RunRow[]
  const completedAt: number[] = []
  const unfinishedIds: string[] = []
  const unfinishedBeforeMs = nowMs - (job.maxDurationSeconds + UNFINISHED_GRACE_SECONDS) * 1000

  for (const row of rows) {
    const startedMs = toMs(row.started_at)
    if (row.status === 'completed') {
      const finishedMs = toMs(row.finished_at) ?? startedMs
      if (finishedMs !== null) completedAt.push(finishedMs)
    }
    if (startedMs === null || startedMs < windowStartMs) continue

    finding.itemFailures += itemFailuresOf(row.result)
    if (row.status === 'failed') {
      finding.failedRuns += 1
      if (row.error_message) finding.lastError = row.error_message
    } else if (row.status === 'running' && startedMs < unfinishedBeforeMs) {
      unfinishedIds.push(row.id)
    }
  }

  if (unfinishedIds.length > 0) {
    finding.unfinishedRuns = unfinishedIds.length
    const { error: markError } = await supabase
      .from('cron_job_runs')
      .update({ status: 'failed', finished_at: now.toISOString(), error_message: UNFINISHED_RUN_MESSAGE })
      .in('id', unfinishedIds)
      .eq('status', 'running')
    if (markError) {
      finding.readError = `Could not mark the unfinished runs failed: ${markError.message}`
    }
  }

  finding.missedRun = findMissedRun(completedAt, job, nowMs, windowStartMs, watchedSinceMs)
  return finding
}

/** When run recording through withCronRun began: the first run any wrapped job recorded. */
async function wrappedRecordingSince(supabase: AdminClient, jobs: readonly MonitoredCronJob[]): Promise<number | null> {
  const names = jobs.filter((job) => job.recording !== 'own').map((job) => job.jobName)
  if (names.length === 0) return null
  const { data, error } = await supabase
    .from('cron_job_runs')
    .select('started_at')
    .in('job_name', names)
    .order('started_at', { ascending: true })
    .limit(1)
  if (error) return null
  return toMs((data as Array<{ started_at: string }> | null)?.[0]?.started_at)
}

async function checkQueue(supabase: AdminClient, now: Date): Promise<QueueFinding> {
  const windowStartIso = new Date(now.getTime() - CHECK_WINDOW_HOURS * 3_600_000).toISOString()
  const finding: QueueFinding = { failedJobs: [], overduePending: 0, stalledProcessing: 0, readError: null }

  const [failed, overdue, stalled] = await Promise.all([
    supabase.from('jobs').select('type').eq('status', 'failed').gte('failed_at', windowStartIso).limit(ROW_LIMIT),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('scheduled_for', new Date(now.getTime() - OVERDUE_PENDING_MINUTES * 60_000).toISOString()),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing')
      .lt('lease_expires_at', new Date(now.getTime() - STALLED_LEASE_MINUTES * 60_000).toISOString()),
  ])

  const problems = [failed.error, overdue.error, stalled.error].filter(Boolean).map((entry) => entry!.message)
  if (problems.length > 0) finding.readError = problems.join('; ')

  const byType = new Map<string, number>()
  for (const row of (failed.data ?? []) as Array<{ type: string | null }>) {
    const type = row.type || 'unknown'
    byType.set(type, (byType.get(type) ?? 0) + 1)
  }
  finding.failedJobs = [...byType.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
  finding.overduePending = overdue.count ?? 0
  finding.stalledProcessing = stalled.count ?? 0
  return finding
}

function jobHasProblem(finding: JobFinding): boolean {
  return Boolean(
    finding.missedRun || finding.failedRuns > 0 || finding.itemFailures > 0 || finding.unfinishedRuns > 0 || finding.readError,
  )
}

function queueHasProblem(finding: QueueFinding): boolean {
  return finding.failedJobs.length > 0 || finding.overduePending > 0 || finding.stalledProcessing > 0 || Boolean(finding.readError)
}

export async function checkScheduledJobs(
  supabase: AdminClient,
  now: Date = new Date(),
  jobs: readonly MonitoredCronJob[] = MONITORED_CRON_JOBS,
): Promise<ScheduledJobsReport> {
  const findings: JobFinding[] = []
  const watchedSinceMs = await wrappedRecordingSince(supabase, jobs).catch(() => null)
  for (const job of jobs) {
    try {
      findings.push(await checkJob(supabase, job, now, watchedSinceMs))
    } catch (error) {
      findings.push({
        jobName: job.jobName,
        label: job.label,
        intervalMinutes: job.intervalMinutes,
        maxDurationSeconds: job.maxDurationSeconds,
        missedRun: null,
        failedRuns: 0,
        lastError: null,
        itemFailures: 0,
        unfinishedRuns: 0,
        readError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  let queue: QueueFinding
  try {
    queue = await checkQueue(supabase, now)
  } catch (error) {
    queue = { failedJobs: [], overduePending: 0, stalledProcessing: 0, readError: error instanceof Error ? error.message : String(error) }
  }

  const jobsWithProblems = findings.filter(jobHasProblem)
  const queueProblem = queueHasProblem(queue)
  return {
    checkedAt: now.toISOString(),
    windowHours: CHECK_WINDOW_HOURS,
    jobs: jobsWithProblems,
    queue: queueProblem ? queue : null,
    problemCount: jobsWithProblems.length + (queueProblem ? 1 : 0),
  }
}

/** "3 hours 30 minutes", "45 minutes", "2 days 1 hour". */
export function describeMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (mins > 0 && days === 0) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' ') : 'under a minute'
}

function describeInterval(intervalMinutes: number): string {
  if (intervalMinutes === 1) return 'every minute'
  if (intervalMinutes === 1440) return 'once a day'
  if (intervalMinutes % 60 === 0) return `every ${describeMinutes(intervalMinutes)}`
  return `every ${intervalMinutes} minutes`
}

/** "Monday 26 October at 04:40", London time, built from parts so Node versions agree. */
function londonTime(iso: string): string {
  const date = new Date(iso)
  return `${formatDateInLondon(date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${formatTimeInLondon(date)}`
}

/** The sentences the email gives one job, in plain English. */
export function describeJobFinding(finding: JobFinding): string[] {
  const lines: string[] = []
  if (finding.missedRun) {
    const { from, until, minutes } = finding.missedRun
    const expected = `it should run ${describeInterval(finding.intervalMinutes)}`
    if (!from) {
      lines.push(`No completed run recorded in the last ${CHECK_WINDOW_HOURS} hours (${expected}).`)
    } else if (!until) {
      lines.push(`No completed run since ${londonTime(from)}, ${describeMinutes(minutes)} ago (${expected}).`)
    } else {
      lines.push(`No completed run from ${londonTime(from)} to ${londonTime(until)}, ${describeMinutes(minutes)} (${expected}).`)
    }
  }
  if (finding.failedRuns > 0) {
    const error = finding.lastError ? ` Last error: ${redactPii(finding.lastError).slice(0, 300)}` : ''
    lines.push(`Failed ${finding.failedRuns} time${finding.failedRuns === 1 ? '' : 's'}.${error}`)
  }
  if (finding.unfinishedRuns > 0) {
    lines.push(
      `${finding.unfinishedRuns} run${finding.unfinishedRuns === 1 ? '' : 's'} did not finish within the ${finding.maxDurationSeconds}-second time limit (now marked failed).`,
    )
  }
  if (finding.itemFailures > 0) {
    lines.push(`${finding.itemFailures} item${finding.itemFailures === 1 ? '' : 's'} the job could not handle (its own count).`)
  }
  if (finding.readError) {
    lines.push(`The check could not read this job's run records: ${redactPii(finding.readError).slice(0, 300)}`)
  }
  return lines
}

export function describeQueueFinding(finding: QueueFinding): string[] {
  const lines: string[] = []
  if (finding.failedJobs.length > 0) {
    const total = finding.failedJobs.reduce((sum, entry) => sum + entry.count, 0)
    const types = finding.failedJobs.map((entry) => `${entry.type} ${entry.count}`).join(', ')
    lines.push(`${total} queued job${total === 1 ? '' : 's'} failed for good (${types}).`)
  }
  if (finding.overduePending > 0) {
    lines.push(
      `${finding.overduePending} queued job${finding.overduePending === 1 ? ' is' : 's are'} waiting more than an hour past ${finding.overduePending === 1 ? 'its' : 'their'} time, so the queue may not be draining.`,
    )
  }
  if (finding.stalledProcessing > 0) {
    lines.push(
      `${finding.stalledProcessing} queued job${finding.stalledProcessing === 1 ? ' is' : 's are'} stuck mid-run with an expired lease.`,
    )
  }
  if (finding.readError) {
    lines.push(`The check could not read the job queue: ${redactPii(finding.readError).slice(0, 300)}`)
  }
  return lines
}

export type ScheduledJobsCheckEmail = { subject: string; html: string; text: string }

export function buildScheduledJobsCheckEmail(report: ScheduledJobsReport, environment: string): ScheduledJobsCheckEmail {
  const count = report.problemCount
  const subject = `[CRON CHECK] ${count} scheduled job${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} a look - ${environment}`
  const intro = `The daily check of scheduled jobs looked at the ${report.windowHours} hours to ${londonTime(report.checkedAt)} and found the following.`

  const sections: Array<{ title: string; lines: string[] }> = report.jobs.map((finding) => ({
    title: `${finding.label} (${finding.jobName})`,
    lines: describeJobFinding(finding),
  }))
  if (report.queue) {
    sections.push({ title: 'Job queue: the jobs it holds', lines: describeQueueFinding(report.queue) })
  }

  const footer =
    'A failed run also sends its own [CRON FAILURE] email at the time, at most one an hour per job. Every run is recorded in cron_job_runs, and the dashboard shows the failed count. Nothing here was sent to a customer.'

  const text = [intro, '', ...sections.flatMap((section) => [section.title, ...section.lines.map((line) => `- ${line}`), '']), footer].join('\n')

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:${STAFF.danger};">Scheduled jobs need a look</h2>
      <p style="font-size:14px;line-height:1.5;">${escapeHtml(intro)}</p>
      ${sections
        .map(
          (section) => `
      <h3 style="font-size:15px;margin:16px 0 4px;">${escapeHtml(section.title)}</h3>
      <ul style="font-size:14px;line-height:1.5;margin:0;padding-left:20px;">
        ${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n        ')}
      </ul>`,
        )
        .join('')}
      <p style="font-size:13px;line-height:1.5;color:${STAFF.textMuted};margin-top:16px;">${escapeHtml(footer)}</p>
    </div>`.trim()

  return { subject, html, text }
}
