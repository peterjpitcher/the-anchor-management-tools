import { describe, expect, it } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'
import type { MonitoredCronJob } from '@/lib/cron/monitored-jobs'
import {
  UNFINISHED_RUN_MESSAGE,
  buildScheduledJobsCheckEmail,
  checkScheduledJobs,
  describeMinutes,
  findMissedRun,
} from '@/lib/cron/scheduled-jobs-check'

/**
 * BK-116: a job that stops running sends no failure email, so a daily check reads the run
 * records and says which jobs went quiet, failed, were cut off or reported items they could not
 * handle, and what the job queue is holding. These tests seed run records and check the report
 * and the email built from it.
 */

const NOW = new Date('2026-10-26T07:40:00.000Z')
const MINUTE = 60_000

const QUARTER_HOURLY: MonitoredCronJob = {
  jobName: 'quarter-job',
  path: '/api/cron/quarter-job',
  intervalMinutes: 15,
  maxDurationSeconds: 60,
  recording: 'every_run',
  label: 'Quarter-hour job',
}

const FIVE_MINUTE: MonitoredCronJob = {
  jobName: 'busy-job',
  path: '/api/cron/busy-job',
  intervalMinutes: 5,
  maxDurationSeconds: 60,
  recording: 'hourly',
  label: 'Busy job',
}

const DAILY: MonitoredCronJob = {
  jobName: 'daily-job',
  path: '/api/cron/daily-job',
  intervalMinutes: 1440,
  maxDurationSeconds: 300,
  recording: 'every_run',
  label: 'Daily job',
}

function iso(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString()
}

let nextId = 0
function run(jobName: string, minutesAgo: number, status = 'completed', extra: Record<string, unknown> = {}) {
  nextId += 1
  return {
    id: `run-${nextId}`,
    job_name: jobName,
    run_key: `run:${iso(minutesAgo * MINUTE)}`,
    status,
    started_at: iso(minutesAgo * MINUTE),
    finished_at: status === 'running' ? null : iso(minutesAgo * MINUTE - 5_000),
    error_message: null,
    result: { itemFailures: 0 },
    ...extra,
  }
}

/** A completed run every `step` minutes from `fromMinutesAgo` back to `toMinutesAgo`. */
function steady(jobName: string, step: number, fromMinutesAgo: number, toMinutesAgo: number) {
  const rows = []
  for (let minutes = fromMinutesAgo; minutes <= toMinutesAgo; minutes += step) rows.push(run(jobName, minutes))
  return rows
}

describe('checkScheduledJobs', () => {
  it('reports nothing when every job ran on time and the queue is clear', async () => {
    const db = createFakeDb({
      cron_job_runs: [...steady('quarter-job', 15, 2, 26 * 60), ...steady('busy-job', 60, 10, 26 * 60), run('daily-job', 100)],
      jobs: [{ id: 'j1', type: 'send_sms', status: 'completed', failed_at: null }],
    })

    const report = await checkScheduledJobs(db.client as never, NOW, [QUARTER_HOURLY, FIVE_MINUTE, DAILY])

    expect(report.problemCount).toBe(0)
    expect(report.jobs).toEqual([])
    expect(report.queue).toBeNull()
  })

  it('finds a silence inside the window and one that is still going on', async () => {
    const db = createFakeDb({
      cron_job_runs: [
        // Quarter-hour job: ran until 3 hours ago, then nothing.
        ...steady('quarter-job', 15, 180, 26 * 60),
        // Hourly-recorded job: a 4-hour hole from 10 to 6 hours ago, then back.
        ...steady('busy-job', 60, 0, 6 * 60),
        ...steady('busy-job', 60, 10 * 60, 26 * 60),
      ],
    })

    const report = await checkScheduledJobs(db.client as never, NOW, [QUARTER_HOURLY, FIVE_MINUTE])
    const quarter = report.jobs.find((job) => job.jobName === 'quarter-job')
    const busy = report.jobs.find((job) => job.jobName === 'busy-job')

    expect(quarter?.missedRun).toMatchObject({ until: null })
    expect(quarter?.missedRun?.minutes).toBe(180)
    expect(busy?.missedRun).toMatchObject({ minutes: 240 })
    expect(busy?.missedRun?.until).not.toBeNull()
    expect(report.problemCount).toBe(2)
  })

  it('does not report a silence that ended before the window opened', () => {
    const nowMs = NOW.getTime()
    const windowStart = nowMs - 24 * 60 * MINUTE
    const points = [nowMs - 30 * 60 * MINUTE, nowMs - 25 * 60 * MINUTE]
    for (let minutes = 24 * 60 + 10; minutes >= 0; minutes -= 15) points.push(nowMs - minutes * MINUTE)

    expect(findMissedRun(points, QUARTER_HOURLY, nowMs, windowStart)).toBeNull()
  })

  it('reports a job with no completed run at all', async () => {
    const db = createFakeDb({ cron_job_runs: [] })
    const report = await checkScheduledJobs(db.client as never, NOW, [DAILY])
    expect(report.jobs[0].missedRun).toMatchObject({ from: null, until: null })
  })

  it('counts failed runs, the last error and the items jobs could not handle', async () => {
    const db = createFakeDb({
      cron_job_runs: [
        ...steady('quarter-job', 15, 0, 26 * 60).map((row, index) =>
          index === 3 ? { ...row, result: { itemFailures: 2 } } : row,
        ),
        run('quarter-job', 50, 'failed', { error_message: 'HTTP 500: Failed to load payments' }),
        run('quarter-job', 20, 'failed', { error_message: 'HTTP 500: call 07700 900123 about it' }),
        // Outside the window: not counted.
        run('quarter-job', 25 * 60, 'failed', { error_message: 'old' }),
      ],
    })

    const report = await checkScheduledJobs(db.client as never, NOW, [QUARTER_HOURLY])

    expect(report.jobs[0]).toMatchObject({ failedRuns: 2, itemFailures: 2, lastError: 'HTTP 500: call 07700 900123 about it', missedRun: null })
  })

  it('marks a run left running past its time limit as failed, and counts it', async () => {
    const stuck = run('daily-job', 30, 'running')
    const recent = run('daily-job', 0.5, 'running')
    const db = createFakeDb({ cron_job_runs: [run('daily-job', 24 * 60 + 30), stuck, recent] })

    const report = await checkScheduledJobs(db.client as never, NOW, [DAILY])

    expect(report.jobs[0].unfinishedRuns).toBe(1)
    const rows = db.rows('cron_job_runs')
    expect(rows.find((row) => row.id === stuck.id)).toMatchObject({ status: 'failed', error_message: UNFINISHED_RUN_MESSAGE })
    expect(rows.find((row) => row.id === recent.id)).toMatchObject({ status: 'running' })
  })

  it('reports queued jobs that failed, are overdue or are stuck', async () => {
    const db = createFakeDb({
      cron_job_runs: steady('quarter-job', 15, 2, 26 * 60),
      jobs: [
        { id: 'a', type: 'send_sms', status: 'failed', failed_at: iso(60 * MINUTE) },
        { id: 'b', type: 'send_sms', status: 'failed', failed_at: iso(120 * MINUTE) },
        { id: 'c', type: 'checklist_sweep', status: 'failed', failed_at: iso(30 * MINUTE) },
        { id: 'd', type: 'send_sms', status: 'failed', failed_at: iso(30 * 60 * MINUTE) },
        { id: 'e', type: 'send_email', status: 'pending', scheduled_for: iso(90 * MINUTE) },
        { id: 'f', type: 'send_email', status: 'pending', scheduled_for: iso(10 * MINUTE) },
        { id: 'g', type: 'send_email', status: 'processing', lease_expires_at: iso(40 * MINUTE) },
      ],
    })

    const report = await checkScheduledJobs(db.client as never, NOW, [QUARTER_HOURLY])

    expect(report.queue).toEqual({
      failedJobs: [
        { type: 'send_sms', count: 2 },
        { type: 'checklist_sweep', count: 1 },
      ],
      overduePending: 1,
      stalledProcessing: 1,
      readError: null,
    })
    expect(report.problemCount).toBe(1)
  })

  it('reports a job whose records cannot be read rather than passing it', async () => {
    const db = createFakeDb({ cron_job_runs: [] })
    db.failNext({ table: 'cron_job_runs', operation: 'select', message: 'permission denied', times: 1 })
    const report = await checkScheduledJobs(db.client as never, NOW, [QUARTER_HOURLY])
    expect(report.jobs[0].readError).toBe('permission denied')
  })
})

describe('buildScheduledJobsCheckEmail', () => {
  it('renders a fixture report in plain English with no undefined, NaN or Invalid Date, and escapes and redacts', async () => {
    const db = createFakeDb({
      cron_job_runs: [
        ...steady('quarter-job', 15, 180, 26 * 60),
        run('quarter-job', 200, 'failed', { error_message: '<script>x</script> call 07700 900123 or a@b.com' }),
        ...steady('busy-job', 60, 0, 6 * 60),
        ...steady('busy-job', 60, 10 * 60, 26 * 60),
        run('daily-job', 24 * 60 + 30),
        run('daily-job', 30, 'running'),
        run('daily-job', 20, 'completed', { result: { itemFailures: 1 } }),
      ],
      jobs: [{ id: 'a', type: 'send_sms', status: 'failed', failed_at: iso(60 * MINUTE) }],
    })
    const report = await checkScheduledJobs(db.client as never, NOW, [QUARTER_HOURLY, FIVE_MINUTE, DAILY])
    const email = buildScheduledJobsCheckEmail(report, 'production')

    expect(email.subject).toBe('[CRON CHECK] 4 scheduled jobs need a look - production')
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/undefined|NaN|Invalid Date|null/)
      expect(part).not.toContain(String.fromCharCode(8212))
      expect(part).not.toContain('07700 900123')
      expect(part).not.toContain('a@b.com')
    }
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.text).toContain('Quarter-hour job (quarter-job)')
    expect(email.text).toContain('No completed run since Monday 26 October at 04:4')
    expect(email.text).toContain('3 hours ago (it should run every 15 minutes).')
    expect(email.text).toContain('Busy job (busy-job)')
    expect(email.text).toContain('4 hours (it should run every 5 minutes)')
    expect(email.text).toContain('1 run did not finish within the 300-second time limit (now marked failed).')
    expect(email.text).toContain('1 item the job could not handle (its own count).')
    expect(email.text).toContain('1 queued job failed for good (send_sms 1).')
  })

  it('describes durations in words', () => {
    expect(describeMinutes(0)).toBe('under a minute')
    expect(describeMinutes(1)).toBe('1 minute')
    expect(describeMinutes(45)).toBe('45 minutes')
    expect(describeMinutes(210)).toBe('3 hours 30 minutes')
    expect(describeMinutes(60 * 25)).toBe('1 day 1 hour')
  })
})
