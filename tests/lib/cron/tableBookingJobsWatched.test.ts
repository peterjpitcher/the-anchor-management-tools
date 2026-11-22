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
// 07:40 in the pub on Tuesday 1 December 2026, when the daily check runs, after the date these
// jobs are watched from.
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

  it('does not call them missing on the morning after the release that added them', async () => {
    // Released on the afternoon of Monday 23 November. By the next morning's check the three
    // frequent jobs have run since the release; the three daily ones have not been due yet. Run
    // recording began long ago for the jobs already on the list (the job queue stands for them),
    // so only each new job's own monitoredFrom holds the alert back.
    const releaseMorning = whenLondonClockReaches('2026-11-24', '07:40') as Date
    const minutesBefore = (minutes: number) => new Date(releaseMorning.getTime() - minutes * MINUTE).toISOString()
    const ranAt = (jobName: string, minutes: number) => ({
      ...completedRun(jobName, 0),
      run_key: `run:${minutesBefore(minutes)}`,
      started_at: minutesBefore(minutes),
      finished_at: minutesBefore(minutes),
    })
    const hourlySince = (jobName: string, hours: number) => Array.from({ length: hours }, (_, index) => ranAt(jobName, 20 + index * 60))

    const jobQueue = MONITORED_CRON_JOBS.find((job) => job.jobName === 'job-queue')!
    const db = createFakeDb({
      cron_job_runs: [
        ...hourlySince('job-queue', 30 * 24),
        ...hourlySince('table-booking-deposit-timeout', 16),
        ...hourlySince('table-booking-paypal-reconciliation', 16),
        ...hourlySince('table-booking-watch', 16),
      ],
      jobs: [],
    })

    const report = await checkScheduledJobs(db.client as never, releaseMorning, [jobQueue, ...jobs])
    expect(report.jobs).toEqual([])

    // The same morning without their monitoredFrom would have reported the three daily jobs.
    const undated = jobs.map(({ monitoredFrom: _monitoredFrom, ...job }) => job)
    const withoutDates = await checkScheduledJobs(db.client as never, releaseMorning, [jobQueue, ...undated])
    expect(withoutDates.jobs.map((finding) => finding.jobName).sort()).toEqual(['preorder-reminders', 'preorder-reports', 'table-booking-confirm'])
  })
})
