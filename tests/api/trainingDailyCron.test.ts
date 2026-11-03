import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'
import type { TrainingDailyRun } from '@/lib/training/daily-job'

/**
 * The training daily cron and the signing reminders cron (staff training build, contract 5.6 and
 * 5.7): both refuse a request without the cron secret, record every run through withCronRun,
 * answer 207 with a count when items failed, and alert when a run fails as a whole.
 */

const { reportCronFailure, runTrainingDaily, runSigningReminders } = vi.hoisted(() => ({
  reportCronFailure: vi.fn(async () => true),
  runTrainingDaily: vi.fn(),
  runSigningReminders: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/alerting')>()),
  reportCronFailure,
}))
vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn((request: Request) =>
    request.headers.get('authorization') === 'Bearer secret'
      ? { authorized: true }
      : { authorized: false, reason: 'Unauthorized' }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/training/daily-job', () => ({ runTrainingDaily }))
vi.mock('@/lib/signing/reminders', () => ({ runSigningReminders }))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET as trainingDaily, maxDuration as trainingMaxDuration } from '@/app/api/cron/training-daily/route'
import { GET as signingReminders, maxDuration as signingMaxDuration } from '@/app/api/cron/signing-reminders/route'

let db: FakeDb

function request(path: string, authorised = true): NextRequest {
  return new NextRequest(`https://management.example${path}`, {
    headers: authorised ? { authorization: 'Bearer secret' } : {},
  })
}

function run(overrides: Partial<TrainingDailyRun> = {}): TrainingDailyRun {
  return {
    today: '2026-11-02',
    emailsEnabled: false,
    suspended: false,
    sweep: { created: 2, cancelled: 0, updated: 1 },
    finalised: 0,
    certificatesPrepared: 0,
    certificatesFailed: 0,
    staffEmailsSent: 0,
    staffEmailsUncertain: 0,
    staffEmailsSuspended: 0,
    staffEmailsRefused: 0,
    staffEmailsProviderRefused: 0,
    staffEmailsAlreadyClaimed: 0,
    managerEmailSent: false,
    managerItems: 0,
    managerOutcome: 'off',
    failedStages: [],
    errors: [],
    deadline: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeDb()
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
})

describe('/api/cron/training-daily', () => {
  it('has a five minute limit for certificate packs', () => {
    expect(trainingMaxDuration).toBe(300)
  })

  it('refuses a request without the cron secret, runs nothing and records nothing', async () => {
    const response = await trainingDaily(request('/api/cron/training-daily', false))

    expect(response.status).toBe(401)
    expect(runTrainingDaily).not.toHaveBeenCalled()
    expect(db.rows('cron_job_runs')).toHaveLength(0)
  })

  it('records a clean run with its counts and no alert', async () => {
    runTrainingDaily.mockResolvedValue(run())
    const response = await trainingDaily(request('/api/cron/training-daily'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, created: 2, updated: 1, emailsEnabled: false, managerOutcome: 'off', failedItems: 0 })
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'training-daily', status: 'completed', result: expect.objectContaining({ created: 2, itemFailures: 0 }) }),
    ])
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('answers 207 and counts the items when some failed', async () => {
    runTrainingDaily.mockResolvedValue(run({
      emailsEnabled: true,
      staffEmailsUncertain: 1,
      errors: ['staff reminder for employee e1: outcome unknown', 'certificate for assignment a1: browser failed'],
    }))
    const response = await trainingDaily(request('/api/cron/training-daily'))
    const body = await response.json()

    expect(response.status).toBe(207)
    expect(body.failedItems).toBe(2)
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'training-daily', status: 'completed', result: expect.objectContaining({ itemFailures: 2 }) }),
    ])
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('answers 500 and alerts when a whole stage failed', async () => {
    runTrainingDaily.mockResolvedValue(run({ failedStages: ['sweep'], errors: ['sweep: relation does not exist'] }))
    const response = await trainingDaily(request('/api/cron/training-daily'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Training daily stages failed: sweep')
    expect(db.rows('cron_job_runs')).toEqual([expect.objectContaining({ job_name: 'training-daily', status: 'failed' })])
    expect(reportCronFailure).toHaveBeenCalledWith('training-daily', expect.any(Error), expect.objectContaining({ httpStatus: 500 }))
  })

  it('records and alerts a run that throws', async () => {
    runTrainingDaily.mockRejectedValue(new Error('boom'))
    const response = await trainingDaily(request('/api/cron/training-daily'))

    expect(response.status).toBe(500)
    expect(db.rows('cron_job_runs')).toEqual([expect.objectContaining({ job_name: 'training-daily', status: 'failed' })])
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })
})

describe('/api/cron/signing-reminders', () => {
  it('keeps its five minute limit', () => {
    expect(signingMaxDuration).toBe(300)
  })

  it('refuses a request without the cron secret', async () => {
    const response = await signingReminders(request('/api/cron/signing-reminders', false))

    expect(response.status).toBe(401)
    expect(runSigningReminders).not.toHaveBeenCalled()
    expect(db.rows('cron_job_runs')).toHaveLength(0)
  })

  it('now records a clean run', async () => {
    runSigningReminders.mockResolvedValue({ remindersSent: 2, withdrawn: 0, trailRepaired: 0, expired: 0, finalised: 1, errors: [] })
    const response = await signingReminders(request('/api/cron/signing-reminders'))

    expect(response.status).toBe(200)
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'signing-reminders', status: 'completed', result: expect.objectContaining({ remindersSent: 2, finalised: 1, itemFailures: 0 }) }),
    ])
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('counts item errors on the run record with a 207', async () => {
    runSigningReminders.mockResolvedValue({ remindersSent: 1, withdrawn: 0, trailRepaired: 0, expired: 0, finalised: 0, errors: ['doc-1: send failed'] })
    const response = await signingReminders(request('/api/cron/signing-reminders'))

    expect(response.status).toBe(207)
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'signing-reminders', status: 'completed', result: expect.objectContaining({ itemFailures: 1 }) }),
    ])
  })

  it('alerts once through the run recorder when the run throws', async () => {
    runSigningReminders.mockRejectedValue(new Error('signing tables missing'))
    const response = await signingReminders(request('/api/cron/signing-reminders'))

    expect(response.status).toBe(500)
    expect(db.rows('cron_job_runs')).toEqual([expect.objectContaining({ job_name: 'signing-reminders', status: 'failed' })])
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(reportCronFailure).toHaveBeenCalledWith('signing-reminders', expect.any(Error), expect.objectContaining({ httpStatus: 500 }))
  })
})
