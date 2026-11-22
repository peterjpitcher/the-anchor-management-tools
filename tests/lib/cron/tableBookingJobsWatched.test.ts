import { describe, expect, it } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'
import { MONITORED_CRON_JOBS } from '@/lib/cron/monitored-jobs'
import { checkScheduledJobs } from '@/lib/cron/scheduled-jobs-check'
import { whenLondonClockReaches } from '@/lib/dateUtils'

/**
 * The five table booking jobs and the table booking watch are on the daily scheduled jobs check
 * (owner decisions, 22 November 2026). Before this they recorded no runs, so one that stopped
 * running sent nothing. These tests run the real check over the real list entries: a job that ran
 * on time is not reported and one that went quiet is.
 */

const TABLE_BOOKING_JOB_NAMES = [
  'table-booking-deposit-timeout',
  'table-booking-paypal-reconciliation',
  'table-booking-confirm',
  'preorder-reminders',
  'preorder-reports',
  'table-booking-watch',
]

const MINUTE = 60_000
// 07:40 in the pub on Tuesday 1 December 2026, when the daily check runs, a week after these
// jobs joined the list.
const NOW = whenLondonClockReaches('2026-12-01', '07:40') as Date

const jobs = MONITORED_CRON_JOBS.filter((job) => TABLE_BOOKING_JOB_NAMES.includes(job.jobName))

let nextId = 0
function completedRun(jobName: string, minutesAgo: number) {
  nextId += 1
  const startedAt = new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString()
  return {
    id: `run-${nextId}`,
    job_name: jobName,
    run_key: `run:${startedAt}`,
    status: 'completed',
    started_at: startedAt,
    finished_at: startedAt,
    error_message: null,
    result: { itemFailures: 0 },
  }
}

/** Completed runs at the job's own interval, from `fromMinutesAgo` back over the last three days. */
function onTime(jobName: string, fromMinutesAgo: number) {
  const job = jobs.find((entry) => entry.jobName === jobName)!
  // A five-minute job keeps one row an hour; the rest keep one per run.
  const step = job.recording === 'hourly' ? 60 : job.intervalMinutes
  const rows = []
  for (let minutes = fromMinutesAgo; minutes <= 3 * 1440; minutes += step) rows.push(completedRun(jobName, minutes))
  return rows
}

describe('the table booking jobs on the daily scheduled jobs check', () => {
  it('lists all five jobs and the watch', () => {
    expect(jobs.map((job) => job.jobName).sort()).toEqual([...TABLE_BOOKING_JOB_NAMES].sort())
  })

  it('reports none of them when each ran on time', async () => {
    const db = createFakeDb({
      cron_job_runs: TABLE_BOOKING_JOB_NAMES.flatMap((name) => onTime(name, 20)),
      jobs: [],
    })
    const report = await checkScheduledJobs(db.client as never, NOW, jobs)
    expect(report.jobs).toEqual([])
    expect(report.problemCount).toBe(0)
  })

  it.each(TABLE_BOOKING_JOB_NAMES)('flags %s when it stops running, and not the ones that ran', async (stopped) => {
    const db = createFakeDb({
      cron_job_runs: TABLE_BOOKING_JOB_NAMES.flatMap((name) =>
        // The stopped job last ran just over two days ago; the rest are on time.
        name === stopped ? [completedRun(name, 2 * 1440 + 30)] : onTime(name, 20),
      ),
      jobs: [],
    })
    const report = await checkScheduledJobs(db.client as never, NOW, jobs)
    expect(report.jobs.map((finding) => finding.jobName)).toEqual([stopped])
    // Still going on. A daily job's last run is in view; a more frequent job's is further back
    // than the check reads, so it is reported as no completed run at all.
    expect(report.jobs[0].missedRun).toMatchObject({ until: null })
    expect(report.jobs[0].missedRun!.minutes).toBeGreaterThanOrEqual(1440)
  })

  it('flags one that has never recorded a run, once its first two days on the list have passed', async () => {
    const db = createFakeDb({
      cron_job_runs: TABLE_BOOKING_JOB_NAMES.filter((name) => name !== 'table-booking-confirm').flatMap((name) => onTime(name, 20)),
      jobs: [],
    })
    const report = await checkScheduledJobs(db.client as never, NOW, jobs)
    expect(report.jobs.map((finding) => finding.jobName)).toEqual(['table-booking-confirm'])
    expect(report.jobs[0].missedRun).toMatchObject({ from: null })
  })

  it('does not call them missing on the morning after they join the list', async () => {
    const releaseMorning = whenLondonClockReaches('2026-11-24', '07:40') as Date
    const db = createFakeDb({
      // Recording began long ago for the jobs already watched; these six have no runs yet.
      cron_job_runs: [{ ...completedRun('job-queue', 0), started_at: '2026-10-26T00:00:00.000Z' }],
      jobs: [],
    })
    const report = await checkScheduledJobs(db.client as never, releaseMorning, jobs)
    expect(report.jobs).toEqual([])
  })
})
