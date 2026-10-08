import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The "Run Retention" button on the recruitment page.
 *
 * It follows the same switch as the nightly job: until
 * RECRUITMENT_RETENTION_APPLY is exactly `true` a press reports what is due and
 * removes nothing. A press must never be the way CVs start being deleted before
 * the owner has seen the numbers.
 */

const runRecruitmentRetentionCleanup = vi.hoisted(() => vi.fn())
const checkUserPermission = vi.hoisted(() => vi.fn())
const logAuditEvent = vi.hoisted(() => vi.fn())
const getUser = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent }))
vi.mock('@/lib/recruitment/calendar', () => ({
  deleteRecruitmentAppointmentCalendarEvent: vi.fn(),
  syncRecruitmentAppointmentCalendar: vi.fn(),
  retryRecruitmentCalendarSync: vi.fn(),
  generateRecruitmentAppointmentIcs: vi.fn(),
  loadRecruitmentAppointment: vi.fn(),
  buildRecruitmentCalendarEvent: vi.fn(),
}))
vi.mock('@/services/recruitment-retention', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/recruitment-retention')>()),
  runRecruitmentRetentionCleanup,
}))

import { runRecruitmentRetentionAction } from '@/app/actions/recruitment'

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

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.RECRUITMENT_RETENTION_APPLY
  getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } })
  checkUserPermission.mockResolvedValue(true)
  logAuditEvent.mockResolvedValue(undefined)
  runRecruitmentRetentionCleanup.mockResolvedValue(report())
})

afterEach(() => {
  delete process.env.RECRUITMENT_RETENTION_APPLY
})

describe('runRecruitmentRetentionAction', () => {
  it('only checks, and says nothing was removed, until the job is switched on', async () => {
    const result = await runRecruitmentRetentionAction()

    expect(runRecruitmentRetentionCleanup).toHaveBeenCalledWith({ dryRun: true })
    expect(result.success).toBe(true)
    expect(result.message).toBe(
      'Check only: 4 applicants would have their CV and contact details removed (3 CV files). Nothing was removed.'
    )
  })

  it('says so when nobody is due', async () => {
    runRecruitmentRetentionCleanup.mockResolvedValue(report({ due: { candidates: 0, cvFiles: 0 }, remaining: 0 }))

    expect((await runRecruitmentRetentionAction()).message).toBe('Check only: nobody is due. Nothing was removed.')
  })

  it('applies when the switch is on, and says the names were kept', async () => {
    process.env.RECRUITMENT_RETENTION_APPLY = 'true'
    runRecruitmentRetentionCleanup.mockResolvedValue(
      report({ mode: 'applied', cleared: 1, cvFilesRemoved: 1, remaining: 0 })
    )
    const result = await runRecruitmentRetentionAction()

    expect(runRecruitmentRetentionCleanup).toHaveBeenCalledWith({ dryRun: false })
    expect(result.message).toBe('1 applicant cleared and 1 CV file deleted. Names and outcomes were kept.')
  })

  it('says how many are left when a run stops at the batch limit', async () => {
    process.env.RECRUITMENT_RETENTION_APPLY = 'true'
    runRecruitmentRetentionCleanup.mockResolvedValue(
      report({ mode: 'applied', cleared: 100, cvFilesRemoved: 90, remaining: 12 })
    )

    expect((await runRecruitmentRetentionAction()).message).toContain('12 applicants still to do: run it again.')
  })

  it('reports a failure as a failure, not as done', async () => {
    process.env.RECRUITMENT_RETENTION_APPLY = 'true'
    runRecruitmentRetentionCleanup.mockResolvedValue(
      report({
        mode: 'applied',
        cleared: 3,
        remaining: 1,
        failed: [{ candidateId: 'candidate-1', step: 'cv_file', message: 'storage said no' }],
      })
    )
    const result = await runRecruitmentRetentionAction()

    expect(result.success).toBe(false)
    expect(result.error).toContain('1 could not be cleared and still hold their details')
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure' }))
  })

  it('refuses someone without permission to manage recruitment, and runs nothing', async () => {
    checkUserPermission.mockResolvedValue(false)
    const result = await runRecruitmentRetentionAction()

    expect(result.success).toBe(false)
    expect(runRecruitmentRetentionCleanup).not.toHaveBeenCalled()
  })

  it('refuses when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const result = await runRecruitmentRetentionAction()

    expect(result.success).toBe(false)
    expect(runRecruitmentRetentionCleanup).not.toHaveBeenCalled()
  })

  it('returns the error when the job throws', async () => {
    runRecruitmentRetentionCleanup.mockRejectedValue(new Error('Could not read recruitment_candidates: timeout'))
    const result = await runRecruitmentRetentionAction()

    expect(result).toEqual({ success: false, error: 'Could not read recruitment_candidates: timeout' })
  })

  it('records counts in the audit log and never a name', async () => {
    await runRecruitmentRetentionAction()

    const entry = logAuditEvent.mock.calls[0][0]
    expect(entry.operation_type).toBe('retention_cleanup_dry_run')
    expect(entry.new_values).toMatchObject({ mode: 'dry_run', due: 4, cleared: 0, failed: 0 })
  })
})
