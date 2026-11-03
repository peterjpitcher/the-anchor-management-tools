import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * What staff see on the recruitment page when a write inside a hire or an erasure fails.
 * The page shows `error` in red and anything else as done, so a failed write must come
 * back as `error`. The real services run against an in-memory database.
 */

const checkUserPermission = vi.hoisted(() => vi.fn())
const logAuditEvent = vi.hoisted(() => vi.fn())
const getUser = vi.hoisted(() => vi.fn())
const inviteEmployee = vi.hoisted(() => vi.fn())
const adminClient = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => adminClient.current) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent }))
vi.mock('@/app/actions/employeeInvite', () => ({ inviteEmployee }))
vi.mock('@/lib/recruitment/calendar', () => ({
  deleteRecruitmentAppointmentCalendarEvent: vi.fn(),
  syncRecruitmentAppointmentCalendar: vi.fn(),
  retryRecruitmentCalendarSync: vi.fn(),
  generateRecruitmentAppointmentIcs: vi.fn(),
  loadRecruitmentAppointment: vi.fn(),
  buildRecruitmentCalendarEvent: vi.fn(),
}))

import { eraseRecruitmentCandidateAction, inviteRecruitmentCandidateAsEmployeeAction } from '@/app/actions/recruitment'

type Outcome = { success: boolean; message?: string; error?: string }

function withStorage(db: FakeDb, failWith: string | null, downloadFailsWith: string | null = null) {
  return {
    ...db.client,
    storage: {
      from: () => ({
        remove: async () => (failWith ? { data: null, error: { message: failWith } } : { data: [], error: null }),
        download: async () => ({ data: null, error: { message: downloadFailsWith ?? 'not expected in this test' } }),
      }),
    },
  }
}

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } })
  checkUserPermission.mockResolvedValue(true)
  logAuditEvent.mockResolvedValue(undefined)
  inviteEmployee.mockResolvedValue({ type: 'success', employeeId: 'emp-1' })
})

describe('inviteRecruitmentCandidateAsEmployeeAction', () => {
  function setup(options: { cvFilePath?: string | null; cvDownloadFailsWith?: string | null } = {}) {
    const candidate = {
      id: 'cand-1',
      email: 'sam@example.com',
      first_name: 'Sam',
      last_name: 'Taylor',
      cv_file_path: options.cvFilePath ?? null,
      cv_file_name: options.cvFilePath ? 'sam-cv.pdf' : null,
      right_to_work_status: 'verified',
      right_to_work_document_type: 'uk_passport',
      right_to_work_checked_at: '2026-10-01T09:00:00.000Z',
    }
    const db = createFakeDb({
      recruitment_applications: [{ id: 'app-1', candidate_id: 'cand-1', status: 'offered', candidate }],
      recruitment_candidates: [{ ...candidate }],
      employees: [],
      employee_right_to_work: [],
      attachment_categories: [{ category_id: 'cat-cv', category_name: 'CV' }],
      employee_attachments: [],
    })
    db.onRpc(() => ({ data: {}, error: null }))
    adminClient.current = withStorage(db, null, options.cvDownloadFailsWith ?? null)
    const hire = async () =>
      (await inviteRecruitmentCandidateAsEmployeeAction(form({ application_id: 'app-1', job_title: 'Bar staff' }))) as Outcome
    return { db, hire }
  }

  it('reports the hire as done when the right to work record copies across', async () => {
    const { hire } = setup()

    const result = await hire()

    expect(result).toEqual(expect.objectContaining({ success: true, message: 'Candidate invite sent and hire handoff completed.' }))
  })

  it('tells staff the employee was created but the right to work check must be recorded by hand', async () => {
    const { db, hire } = setup()
    db.failNext({ table: 'employee_right_to_work', operation: 'insert', message: 'violates check constraint' })

    const result = await hire()

    expect(result).toEqual({
      success: false,
      error:
        "The employee was created and the hire was completed, but their right to work check could not be copied across. Record it on the employee's Right to Work tab before they start.",
    })
    expect(db.rows('recruitment_candidates')[0].converted_employee_id).toBe('emp-1')
  })

  // inviteEmployee keeps the employee when the welcome email may have gone. Treating that as a
  // failed invite left a hire nobody could finish: a retry found the employee and refused.
  const MAY_HAVE_GONE =
    'We sent the invite to sam@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again. Their record has been kept, so you can resend the invite from their profile if it did not arrive.'

  it('completes the hire when the invite email may have gone, and passes the warning to staff', async () => {
    const { db, hire } = setup()
    inviteEmployee.mockResolvedValue({ type: 'warning', employeeId: 'emp-1', message: MAY_HAVE_GONE })

    const result = (await hire()) as Outcome & { warning?: string; data?: { employeeId: string } }

    expect(result).toEqual({
      success: true,
      data: { employeeId: 'emp-1' },
      message: `The employee was created and the hire was completed. ${MAY_HAVE_GONE}`,
      warning: `The employee was created and the hire was completed. ${MAY_HAVE_GONE}`,
    })
    expect(result.warning).not.toMatch(/could not be sent/i)
    expect(db.rows('recruitment_candidates')[0].converted_employee_id).toBe('emp-1')
    expect(db.rows('employee_right_to_work')).toHaveLength(1)
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_status: 'success',
        new_values: expect.objectContaining({ employee_id: 'emp-1', invite_email: 'may_have_gone' }),
      }),
    )
  })

  it('names both problems when the invite may have gone and the right to work check did not copy', async () => {
    const { db, hire } = setup()
    inviteEmployee.mockResolvedValue({ type: 'warning', employeeId: 'emp-1', message: MAY_HAVE_GONE })
    db.failNext({ table: 'employee_right_to_work', operation: 'insert', message: 'violates check constraint' })

    const result = await hire()

    expect(result).toEqual({
      success: false,
      error:
        "The employee was created and the hire was completed, but their right to work check could not be copied across. Record it on the employee's Right to Work tab before they start. " +
        MAY_HAVE_GONE,
    })
    expect(db.rows('recruitment_candidates')[0].converted_employee_id).toBe('emp-1')
  })

  it('still stops when the invite made no employee', async () => {
    const { db, hire } = setup()
    inviteEmployee.mockResolvedValue({ type: 'warning', message: 'Something odd happened.' })

    const result = await hire()

    expect(result).toEqual({ success: false, error: 'Something odd happened.' })
    expect(db.rows('recruitment_candidates')[0].converted_employee_id).toBeUndefined()
  })

  // The action's own refusals are written for staff, so they show as they are.
  it('shows its own refusals as written', async () => {
    const { db, hire } = setup()
    db.rows('employees').push({ employee_id: 'emp-0', email_address: 'sam@example.com', status: 'Active' })

    await expect(hire()).resolves.toEqual({ success: false, error: 'An active employee with this email address already exists.' })
    expect(inviteEmployee).not.toHaveBeenCalled()

    const missingTitle = await inviteRecruitmentCandidateAsEmployeeAction(form({ application_id: 'app-1' }))
    expect(missingTitle).toEqual({ success: false, error: 'Application and job title are required.' })
  })

  it('shows the permission refusal as written', async () => {
    const { hire } = setup()
    checkUserPermission.mockResolvedValue(false)

    await expect(hire()).resolves.toEqual({ success: false, error: 'You do not have permission to do this.' })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('shows the signed-out refusal as written', async () => {
    const { hire } = setup()
    getUser.mockResolvedValue({ data: { user: null } })

    await expect(hire()).resolves.toEqual({ success: false, error: 'Not authenticated' })
    expect(console.error).not.toHaveBeenCalled()
    expect(inviteEmployee).not.toHaveBeenCalled()
  })

  // supabase-js returns an auth error but rethrows anything else from getUser, and the server
  // client throws on a missing setting. Neither is written for staff.
  it('replaces anything else the permission check throws with a plain message, and logs it', async () => {
    const { hire } = setup()
    const thrown = new Error('fetch failed: getaddrinfo ENOTFOUND tfcasgxopxegwrabvwat.supabase.co')
    getUser.mockRejectedValue(thrown)

    const result = await hire()

    expect(result).toEqual({ success: false, error: 'Could not complete the hire just now. Please try again.' })
    expect(result.error).not.toContain('ENOTFOUND')
    expect(console.error).toHaveBeenCalledWith('Recruitment hire failed', { employeeId: null }, thrown)
    expect(inviteEmployee).not.toHaveBeenCalled()
  })

  const DETAILS_NOT_COPIED =
    "The candidate's name and phone number were not copied onto the employee record, so check them on the employee page."

  it('tells staff when the candidate details did not copy onto the employee, though the hire completed', async () => {
    const { db, hire } = setup()
    db.failNext({ table: 'employees', operation: 'update', message: 'permission denied for table employees' })

    const result = await hire()

    expect(result).toEqual({
      success: false,
      error: `The employee was created and the hire was completed. ${DETAILS_NOT_COPIED}`,
    })
    expect(result.error).not.toContain('permission denied')
    expect(db.rows('recruitment_candidates')[0].converted_employee_id).toBe('emp-1')
    expect(db.rows('employee_right_to_work')).toHaveLength(1)
    expect(console.error).toHaveBeenCalledWith(
      '[employees] Copying the candidate details onto the new employee failed',
      expect.objectContaining({ employeeId: 'emp-1', applicationId: 'app-1', message: 'permission denied for table employees' }),
    )
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_status: 'success',
        new_values: expect.objectContaining({ employee_id: 'emp-1', candidate_details_copied: false }),
      }),
    )
  })

  it('names every problem when the details, the right to work check and the invite email all need attention', async () => {
    const { db, hire } = setup()
    inviteEmployee.mockResolvedValue({ type: 'warning', employeeId: 'emp-1', message: MAY_HAVE_GONE })
    db.failNext({ table: 'employees', operation: 'update', message: 'statement timeout' })
    db.failNext({ table: 'employee_right_to_work', operation: 'insert', message: 'violates check constraint' })

    const result = await hire()

    expect(result).toEqual({
      success: false,
      error:
        "The employee was created and the hire was completed, but their right to work check could not be copied across. Record it on the employee's Right to Work tab before they start. " +
        `${DETAILS_NOT_COPIED} ${MAY_HAVE_GONE}`,
    })
  })

  it('records the details as copied in the audit when they were', async () => {
    const { hire } = setup()

    await hire()

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ new_values: expect.objectContaining({ candidate_details_copied: true }) }),
    )
  })

  // Anything else that throws is database or library text: it goes to the log, never to staff.
  it('replaces a database error before the employee exists with a plain message, and logs it', async () => {
    const { db, hire } = setup()
    db.failNext({ table: 'recruitment_applications', operation: 'select', message: 'relation "recruitment_applications" does not exist' })

    const result = await hire()

    expect(result).toEqual({ success: false, error: 'Could not complete the hire just now. Please try again.' })
    expect(inviteEmployee).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      'Recruitment hire failed',
      { employeeId: null },
      expect.objectContaining({ message: 'relation "recruitment_applications" does not exist' }),
    )
  })

  it('logs the thrown error object itself, so its stack survives, and never shows its text', async () => {
    const { hire } = setup()
    const thrown = new Error('duplicate key value violates unique constraint "employees_email_key"')
    inviteEmployee.mockRejectedValue(thrown)

    const result = await hire()

    expect(result).toEqual({ success: false, error: 'Could not complete the hire just now. Please try again.' })
    expect(console.error).toHaveBeenCalledWith('Recruitment hire failed', { employeeId: null }, thrown)
  })

  const UNFINISHED =
    "The employee was created, but the hire could not be finished, so their CV and right to work check may not have been copied across. Do not create another invite. Use Mark Hired, then open their employee record: record the right to work check on the Right to Work tab before they start if it is not there, and add their CV under Documents if it is missing."

  // Once the employee exists a retry is refused as a duplicate, so "try again" would be wrong.
  it('says the employee exists and not to invite again when the hire fails after the invite', async () => {
    const { db, hire } = setup()
    db.failNext({ table: 'recruitment_candidates', operation: 'update', message: 'permission denied for table recruitment_candidates' })

    const result = await hire()

    expect(result).toEqual({ success: false, error: UNFINISHED })
    expect(result.error).not.toContain('permission denied')
    expect(console.error).toHaveBeenCalledWith(
      'Recruitment hire failed',
      { employeeId: 'emp-1' },
      expect.objectContaining({ message: 'permission denied for table recruitment_candidates' }),
    )
  })

  it('keeps the may-have-gone warning when the hire fails after an uncertain invite email', async () => {
    const { db, hire } = setup()
    inviteEmployee.mockResolvedValue({ type: 'warning', employeeId: 'emp-1', message: MAY_HAVE_GONE })
    db.failNext({ table: 'recruitment_candidates', operation: 'update', message: 'statement timeout' })

    const result = await hire()

    expect(result).toEqual({ success: false, error: `${UNFINISHED} ${MAY_HAVE_GONE}` })
  })

  // The CV is copied first, so a storage error stops the handoff before the right to work check
  // is seeded: the message must name both as possibly missing, and Mark Hired copies neither.
  it('says the CV and right to work check may be missing when copying the CV fails', async () => {
    const { db, hire } = setup({ cvFilePath: 'cvs/cand-1.pdf', cvDownloadFailsWith: 'Object not found' })

    const result = await hire()

    expect(result).toEqual({ success: false, error: UNFINISHED })
    expect(result.error).not.toContain('Object not found')
    expect(db.rows('employee_right_to_work')).toHaveLength(0)
    expect(db.rows('employee_attachments')).toHaveLength(0)
    expect(db.rows('recruitment_candidates')[0].converted_employee_id).toBeUndefined()
    expect(console.error).toHaveBeenCalledWith(
      'Recruitment hire failed',
      { employeeId: 'emp-1' },
      expect.objectContaining({ message: 'Object not found' }),
    )
  })

  it('keeps the details warning when the hire fails after the details did not copy', async () => {
    const { db, hire } = setup()
    db.failNext({ table: 'employees', operation: 'update', message: 'statement timeout' })
    db.failNext({ table: 'recruitment_candidates', operation: 'update', message: 'statement timeout' })

    const result = await hire()

    expect(result).toEqual({ success: false, error: `${UNFINISHED} ${DETAILS_NOT_COPIED}` })
  })
})

describe('eraseRecruitmentCandidateAction', () => {
  function setup(storageFailure: string | null = null) {
    const db = createFakeDb({
      recruitment_candidates: [{ id: 'cand-1', email: 'sam@example.com', cv_file_path: 'cvs/cand-1.pdf', anonymised_at: null }],
      recruitment_candidate_appointments: [],
      recruitment_communications: [{ id: 'msg-1', candidate_id: 'cand-1', final_body: 'Hi Sam' }],
    })
    db.onRpc((name) => (name === 'get_user_roles' ? { data: [{ role_name: 'super_admin' }], error: null } : { data: {}, error: null }))
    adminClient.current = withStorage(db, storageFailure)
    const erase = async () => (await eraseRecruitmentCandidateAction(form({ candidate_id: 'cand-1', reason: 'GDPR request' }))) as Outcome
    return { db, erase }
  }

  it('reports the erasure as done when every step works', async () => {
    const { erase } = setup()

    await expect(erase()).resolves.toEqual(expect.objectContaining({ success: true, message: 'Candidate PII erased.' }))
  })

  it('tells staff the erasure is incomplete when the CV file cannot be removed', async () => {
    const { erase } = setup('storage said no')

    const result = await erase()

    expect(result).toEqual({
      success: false,
      error:
        "Erasure is incomplete: the CV file could not be deleted. The candidate's details have not been erased yet. Try the erasure again.",
    })
  })

  it('tells staff the erasure is incomplete when the message history cannot be scrubbed', async () => {
    const { db, erase } = setup()
    db.failNext({ table: 'recruitment_communications', operation: 'update', message: 'statement timeout' })

    const result = await erase()

    expect(result.success).toBe(false)
    expect(result.error).toContain('their message history could not be scrubbed')
    expect(result.error).toContain('Try the erasure again.')
  })
})
