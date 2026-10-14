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

function withStorage(db: FakeDb, failWith: string | null) {
  return {
    ...db.client,
    storage: {
      from: () => ({
        remove: async () => (failWith ? { data: null, error: { message: failWith } } : { data: [], error: null }),
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
  function setup() {
    const candidate = {
      id: 'cand-1',
      email: 'sam@example.com',
      first_name: 'Sam',
      last_name: 'Taylor',
      cv_file_path: null,
      right_to_work_status: 'verified',
      right_to_work_document_type: 'uk_passport',
      right_to_work_checked_at: '2026-10-01T09:00:00.000Z',
    }
    const db = createFakeDb({
      recruitment_applications: [{ id: 'app-1', candidate_id: 'cand-1', status: 'offered', candidate }],
      recruitment_candidates: [{ ...candidate }],
      employees: [],
      employee_right_to_work: [],
    })
    db.onRpc(() => ({ data: {}, error: null }))
    adminClient.current = withStorage(db, null)
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
