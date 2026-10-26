/**
 * The scheduled jobs the daily check watches (BK-116, customer bookings review of 24 October
 * 2026): each one writes a `cron_job_runs` row as it runs, through `withCronRun` or its own
 * run record, so the check can see a job that failed, was cut off, or stopped running.
 *
 * vercel.json is the source of truth for when each job runs. `intervalMinutes` restates its
 * schedule so the check knows how long a silence is too long, and
 * tests/guards/cron-max-duration.test.ts fails if the two stop agreeing, if a job here is no
 * longer scheduled, or if its route stops recording under this name.
 */

export type MonitoredCronRecording = 'every_run' | 'hourly' | 'own'

export type MonitoredCronJob = {
  /** The `cron_job_runs.job_name` the route records under. */
  jobName: string
  /** The route, as vercel.json names it (without its query string). */
  path: string
  /** Minutes between scheduled runs, from vercel.json. */
  intervalMinutes: number
  /** The route's maxDuration, in seconds. A run still `running` after this did not finish. */
  maxDurationSeconds: number
  /** How the route records its runs: through withCronRun, or with its own run record. */
  recording: MonitoredCronRecording
  /** What the job does, in the words the alert email uses. */
  label: string
}

export const MONITORED_CRON_JOBS: readonly MonitoredCronJob[] = [
  {
    jobName: 'job-queue',
    path: '/api/jobs/process',
    intervalMinutes: 1,
    maxDurationSeconds: 60,
    recording: 'hourly',
    label: 'Job queue (queued texts, emails and other background work)',
  },
  {
    jobName: 'event-booking-holds',
    path: '/api/cron/event-booking-holds',
    intervalMinutes: 5,
    maxDurationSeconds: 60,
    recording: 'hourly',
    label: 'Event and table booking hold expiry',
  },
  {
    jobName: 'event-waitlist-offers',
    path: '/api/cron/event-waitlist-offers',
    intervalMinutes: 5,
    maxDurationSeconds: 60,
    recording: 'hourly',
    label: 'Event waitlist offers',
  },
  {
    jobName: 'event-paypal-reconciliation',
    path: '/api/cron/event-paypal-reconciliation',
    intervalMinutes: 15,
    maxDurationSeconds: 60,
    recording: 'every_run',
    label: 'Event ticket PayPal check',
  },
  {
    jobName: 'event-payment-reminders',
    path: '/api/cron/event-payment-reminders',
    intervalMinutes: 15,
    maxDurationSeconds: 300,
    recording: 'every_run',
    label: 'Event payment reminders',
  },
  {
    jobName: 'paypal-deposit-reconciliation',
    path: '/api/cron/paypal-deposit-reconciliation',
    intervalMinutes: 15,
    maxDurationSeconds: 60,
    recording: 'every_run',
    label: 'Private hire deposit PayPal check',
  },
  {
    jobName: 'event-guest-engagement',
    path: '/api/cron/event-guest-engagement',
    intervalMinutes: 15,
    maxDurationSeconds: 300,
    recording: 'own',
    label: 'Event and table guest reminders and review asks',
  },
  {
    jobName: 'private-bookings-expire-holds',
    path: '/api/cron/private-bookings-expire-holds',
    intervalMinutes: 1440,
    maxDurationSeconds: 60,
    recording: 'every_run',
    label: 'Private hire hold expiry',
  },
  {
    jobName: 'private-booking-monitor',
    path: '/api/cron/private-booking-monitor',
    intervalMinutes: 1440,
    maxDurationSeconds: 300,
    recording: 'own',
    label: 'Private hire reminders and chasers',
  },
]

/** Slack on top of twice the interval, for Vercel starting a run a little late. */
export const MISSED_RUN_SLACK_MINUTES = 5

/**
 * The longest gap between completed runs before the check calls it a missed run: twice the
 * interval, and never under two hours for a job that records one row an hour.
 */
export function allowedGapMinutes(job: Pick<MonitoredCronJob, 'intervalMinutes' | 'recording'>): number {
  const twice = job.intervalMinutes * 2
  const floor = job.recording === 'hourly' ? 120 : 0
  return Math.max(twice, floor) + MISSED_RUN_SLACK_MINUTES
}
