import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The nightly recruitment retention job removes nothing until it is switched on.
 *
 * The job is already scheduled (vercel.json, 02:30 every night). Deploying the
 * new, wider rule must not start deleting CVs that night, before the owner has
 * seen how many it would remove, so the route runs dry unless
 * RECRUITMENT_RETENTION_APPLY is exactly `true`.
 */

const runRecruitmentRetentionCleanup = vi.hoisted(() => vi.fn())
const authorizeCronRequest = vi.hoisted(() => vi.fn())

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest }))
vi.mock('@/services/recruitment-retention', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/recruitment-retention')>()),
  runRecruitmentRetentionCleanup,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/recruitment/calendar', () => ({ deleteRecruitmentAppointmentCalendarEvent: vi.fn() }))

import { GET } from '@/app/api/cron/recruitment-retention/route'

function report(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'dry_run',
    retentionMonths: 12,
    cutoff: '2025-10-07T23:00:00.000Z',
    due: { candidates: 4, cvFiles: 3 },
    skipped: { hired: 1, recent_application: 0, upcoming_appointment: 0 },
    cleared: 0,
    cvFilesRemoved: 0,
    calendarEntriesRemoved: 0,
    calendarEntriesLeft: 0,
    failed: [],
    remaining: 4,
    ...overrides,
  }
}

function cron(query = ''): NextRequest {
  return new NextRequest(`https://example.com/api/cron/recruitment-retention${query}`, {
    headers: { authorization: 'Bearer cron-secret' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.RECRUITMENT_RETENTION_APPLY
  authorizeCronRequest.mockReturnValue({ authorized: true })
  runRecruitmentRetentionCleanup.mockResolvedValue(report())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.RECRUITMENT_RETENTION_APPLY
})

describe('GET /api/cron/recruitment-retention', () => {
  it('refuses a caller without the cron secret and runs nothing', async () => {
    authorizeCronRequest.mockReturnValue({ authorized: false, reason: 'Unauthorized' })
    const response = await GET(cron())

    expect(response.status).toBe(401)
    expect(runRecruitmentRetentionCleanup).not.toHaveBeenCalled()
  })

  it('runs dry when the switch has not been set', async () => {
    const response = await GET(cron())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(runRecruitmentRetentionCleanup).toHaveBeenCalledWith({ dryRun: true })
    expect(payload).toMatchObject({ success: true, result: { mode: 'dry_run', cleared: 0 } })
  })

  it.each(['false', '1', 'yes', 'TRUE', ''])('runs dry when the switch is %j', async (value) => {
    process.env.RECRUITMENT_RETENTION_APPLY = value
    await GET(cron())

    expect(runRecruitmentRetentionCleanup).toHaveBeenCalledWith({ dryRun: true })
  })

  it('applies only when the switch is exactly "true"', async () => {
    process.env.RECRUITMENT_RETENTION_APPLY = 'true'
    runRecruitmentRetentionCleanup.mockResolvedValue(report({ mode: 'applied', cleared: 4, remaining: 0 }))
    const response = await GET(cron())

    expect(response.status).toBe(200)
    expect(runRecruitmentRetentionCleanup).toHaveBeenCalledWith({ dryRun: false })
  })

  it.each(['?dry_run=1', '?dry_run=true'])('can be forced dry with %s even when switched on', async (query) => {
    process.env.RECRUITMENT_RETENTION_APPLY = 'true'
    await GET(cron(query))

    expect(runRecruitmentRetentionCleanup).toHaveBeenCalledWith({ dryRun: true })
  })

  it('cannot be forced to apply from the address when the switch is off', async () => {
    await GET(cron('?dry_run=0&apply=true'))

    expect(runRecruitmentRetentionCleanup).toHaveBeenCalledWith({ dryRun: true })
  })

  it('answers 500 when any candidate could not be cleared, so the failure is seen', async () => {
    process.env.RECRUITMENT_RETENTION_APPLY = 'true'
    runRecruitmentRetentionCleanup.mockResolvedValue(
      report({
        mode: 'applied',
        cleared: 3,
        remaining: 1,
        failed: [{ candidateId: 'candidate-1', step: 'cv_file', message: 'storage said no' }],
      })
    )
    const response = await GET(cron())
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.success).toBe(false)
    expect(payload.result.failed).toHaveLength(1)
  })

  it('answers 500 when the job throws', async () => {
    runRecruitmentRetentionCleanup.mockRejectedValue(new Error('Could not read recruitment_candidates'))
    const response = await GET(cron())

    expect(response.status).toBe(500)
    expect((await response.json()).success).toBeUndefined()
  })
})
