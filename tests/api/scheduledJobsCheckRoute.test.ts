import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'
import type { ScheduledJobsReport } from '@/lib/cron/scheduled-jobs-check'

/**
 * The daily scheduled jobs check (BK-116) emails CRON_ALERT_EMAIL only when there is something
 * to look at, and at most once a London day however often it is called.
 */

const { sendEmail, checkScheduledJobs, claims } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  checkScheduledJobs: vi.fn(),
  claims: new Map<string, string>(),
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/cron/alerting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/alerting')>()),
  reportCronFailure: vi.fn(async () => undefined),
}))
vi.mock('@/lib/cron/scheduled-jobs-check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/scheduled-jobs-check')>()),
  checkScheduledJobs,
}))
vi.mock('@/lib/api/idempotency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/idempotency')>()),
  claimIdempotencyKey: vi.fn(async (_db: unknown, key: string) => {
    if (claims.has(key)) return { state: 'in_progress' }
    claims.set(key, 'processing')
    return { state: 'claimed' }
  }),
  persistIdempotencyResponse: vi.fn(async (_db: unknown, key: string) => {
    claims.set(key, 'done')
  }),
  releaseIdempotencyClaim: vi.fn(async (_db: unknown, key: string) => {
    claims.delete(key)
  }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET, maxDuration } from '@/app/api/cron/scheduled-jobs-check/route'

const PROBLEM_REPORT: ScheduledJobsReport = {
  checkedAt: '2026-10-26T07:40:00.000Z',
  windowHours: 24,
  jobs: [
    {
      jobName: 'event-booking-holds',
      label: 'Event and table booking hold expiry',
      intervalMinutes: 5,
      maxDurationSeconds: 60,
      missedRun: { from: '2026-10-26T02:00:00.000Z', until: '2026-10-26T05:30:00.000Z', minutes: 210 },
      failedRuns: 1,
      lastError: 'HTTP 500: Failed to process hold expiry',
      itemFailures: 0,
      unfinishedRuns: 0,
      readError: null,
    },
  ],
  queue: null,
  problemCount: 1,
}

let db: FakeDb
const ORIGINAL_ALERT = process.env.CRON_ALERT_EMAIL

function request(): NextRequest {
  return new NextRequest('https://management.example/api/cron/scheduled-jobs-check', { headers: { authorization: 'Bearer s' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  claims.clear()
  db = createFakeDb()
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
  process.env.CRON_ALERT_EMAIL = 'alerts@example.com'
  checkScheduledJobs.mockResolvedValue(PROBLEM_REPORT)
  sendEmail.mockResolvedValue({ success: true })
})

afterEach(() => {
  process.env.CRON_ALERT_EMAIL = ORIGINAL_ALERT
})

describe('GET /api/cron/scheduled-jobs-check', () => {
  it('has its own time limit', () => {
    expect(maxDuration).toBe(60)
  })

  it('sends nothing on a quiet day', async () => {
    checkScheduledJobs.mockResolvedValue({ ...PROBLEM_REPORT, jobs: [], problemCount: 0 })

    const response = await GET(request())

    expect(await response.json()).toEqual({ success: true, problems: 0, emailed: false })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('emails the alert inbox once a day when something needs a look', async () => {
    const first = await GET(request())
    const second = await GET(request())

    expect(await first.json()).toMatchObject({ emailed: true, problems: 1 })
    expect(await second.json()).toMatchObject({ emailed: false, alert: 'already_sent_today' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [options] = sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }]
    expect(options.to).toBe('alerts@example.com')
    expect(options.subject).toMatch(/^\[CRON CHECK\] 1 scheduled job needs a look - /)
    expect(options.text).toContain('Event and table booking hold expiry (event-booking-holds)')
    // Its own run is recorded too.
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'scheduled-jobs-check', status: 'completed' }),
      expect.objectContaining({ job_name: 'scheduled-jobs-check', status: 'completed' }),
    ])
  })

  it('does not email, and says so, when CRON_ALERT_EMAIL is unset', async () => {
    delete process.env.CRON_ALERT_EMAIL

    const response = await GET(request())

    expect(await response.json()).toMatchObject({ emailed: false, alert: 'not_configured' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('fails the run and frees the day for a retry when the email does not send', async () => {
    sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' } as never)

    const failed = await GET(request())
    const retried = await GET(request())

    expect(failed.status).toBe(502)
    expect(retried.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})
