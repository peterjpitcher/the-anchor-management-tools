import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MONITORED_CRON_JOBS } from '@/lib/cron/monitored-jobs'

/**
 * Scheduled jobs carry their own time limit and their run records stay watchable (BK-212 and
 * BK-116, customer bookings review of 24 October 2026).
 *
 * Nine crons set no maxDuration and ran on the project's 15-second default, which the daily
 * private hire monitor already came within 6 seconds of; a run cut off there skips that day's
 * reminders with no alert. vercel.json is the source of truth for what is scheduled, so every
 * route it schedules must export a maxDuration.
 *
 * The daily scheduled jobs check judges silence by each job's interval. Its list restates the
 * interval, so this also fails if a watched job is no longer scheduled, if its schedule changed
 * without the list, or if its route stopped recording under the name the check reads.
 */

const ROOT = process.cwd()

type VercelCron = { path: string; schedule: string }
const crons = (JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { crons: VercelCron[] }).crons

function routeFile(path: string): string {
  return join(ROOT, 'src/app', path.split('?')[0], 'route.ts')
}

/** Minutes between runs for the schedule shapes vercel.json uses; null for anything else. */
function intervalMinutes(schedule: string): number | null {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = schedule.trim().split(/\s+/)
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null
  if (hour === '*') {
    if (minute === '*') return 1
    const every = /^\*\/(\d+)$/.exec(minute)
    if (every) return Number(every[1])
    if (/^\d+$/.test(minute)) return 60
    return null
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return 1440
  return null
}

describe('scheduled cron routes', () => {
  it('every route vercel.json schedules exists and exports its own maxDuration', () => {
    const missing: string[] = []
    for (const cron of crons) {
      const file = routeFile(cron.path)
      if (!existsSync(file)) {
        missing.push(`${cron.path}: no route file`)
        continue
      }
      if (!/^export const maxDuration = \d+/m.test(readFileSync(file, 'utf8'))) {
        missing.push(`${cron.path}: no maxDuration`)
      }
    }
    expect(missing).toEqual([])
  })

  it('reads the schedules this guard depends on', () => {
    expect(intervalMinutes('* * * * *')).toBe(1)
    expect(intervalMinutes('*/15 * * * *')).toBe(15)
    expect(intervalMinutes('50 * * * *')).toBe(60)
    expect(intervalMinutes('0 9 * * *')).toBe(1440)
    expect(intervalMinutes('0 9 * * 1-5')).toBeNull()
  })
})

describe('jobs the daily scheduled jobs check watches', () => {
  it.each(MONITORED_CRON_JOBS.map((job) => [job.jobName, job] as const))('%s matches vercel.json and its route', (_name, job) => {
    const scheduled = crons.find((cron) => cron.path.split('?')[0] === job.path)
    expect(scheduled, `${job.path} is not scheduled in vercel.json`).toBeDefined()
    expect(intervalMinutes(scheduled!.schedule)).toBe(job.intervalMinutes)

    const source = readFileSync(routeFile(job.path), 'utf8')
    const declared = /^export const maxDuration = (\d+)/m.exec(source)
    expect(Number(declared?.[1])).toBe(job.maxDurationSeconds)

    if (job.recording === 'own') {
      expect(source).toContain(`const JOB_NAME = '${job.jobName}'`)
      expect(source).toContain("from('cron_job_runs')")
    } else {
      const named = source.includes(`const JOB_NAME = '${job.jobName}'`) ? `(?:'${job.jobName}'|JOB_NAME)` : `'${job.jobName}'`
      const wrapped = new RegExp(`withCronRun\\(\\s*${named}[\\s\\S]{0,200}?recording: '${job.recording}'`)
      expect(source).toMatch(wrapped)
    }
  })
})
