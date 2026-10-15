import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * Recruitment writes that used to fail silently while staff were told it worked.
 *
 * - Hiring: the right to work record (a legal compliance record) could fail to copy across
 *   and the hire still showed as complete.
 * - GDPR erasure: a failed appointment cancel, message scrub or CV file removal still
 *   reported the candidate as erased, and a failed CV removal orphaned the file.
 * - Bulk rejection: a lost rejection reason was counted as a success.
 *
 * Every case runs the real service against an in-memory database.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import {
  BULK_REJECTION_REASON_NOT_SAVED,
  HIRE_RIGHT_TO_WORK_NOT_COPIED,
  bulkUpdateRecruitmentApplications,
  completeRecruitmentHireHandoff,
  eraseRecruitmentCandidate,
} from '@/services/recruitment'

type Row = Record<string, unknown>

type Storage = { removed: string[]; failWith: string | null }

function clientWith(db: FakeDb, storage: Storage) {
  return {
    ...db.client,
    storage: {
      from: (_bucket: string) => ({
        remove: async (paths: string[]) => {
          if (storage.failWith) return { data: null, error: { message: storage.failWith } }
          storage.removed.push(...paths)
          return { data: [], error: null }
        },
      }),
    },
  } as never
}

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
  consoleError.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('completeRecruitmentHireHandoff: right to work copy', () => {
  function setup() {
    const candidate: Row = {
      id: 'cand-1',
      cv_file_path: null,
      right_to_work_status: 'verified',
      right_to_work_document_type: 'uk_passport',
      right_to_work_checked_at: '2026-10-01T09:00:00.000Z',
      right_to_work_checked_by: 'user-1',
    }
    const db = createFakeDb({
      recruitment_applications: [{ id: 'app-1', candidate_id: 'cand-1', status: 'offered', candidate }],
      recruitment_candidates: [{ ...candidate }],
      employee_right_to_work: [],
    })
    const rpcCalls: string[] = []
    db.onRpc((name) => {
      rpcCalls.push(name)
      return { data: { id: 'app-1', status: 'hired' }, error: null }
    })
    const storage: Storage = { removed: [], failWith: null }
    return { db, rpcCalls, client: clientWith(db, storage) }
  }

  it('copies the verified right to work check and reports no warning', async () => {
    const { db, client } = setup()

    const result = await completeRecruitmentHireHandoff('app-1', 'emp-1', 'user-1', client)

    expect(result).toEqual({ success: true, rightToWorkSaved: true, warning: undefined })
    expect(db.rows('employee_right_to_work')).toEqual([
      expect.objectContaining({ employee_id: 'emp-1', document_type: 'uk_passport', verification_date: '2026-10-01' }),
    ])
  })

  it('still completes the hire, but warns that the right to work record was not saved', async () => {
    const { db, rpcCalls, client } = setup()
    db.failNext({ table: 'employee_right_to_work', operation: 'insert', message: 'violates check constraint' })

    const result = await completeRecruitmentHireHandoff('app-1', 'emp-1', 'user-1', client)

    expect(result.rightToWorkSaved).toBe(false)
    expect(result.warning).toBe(HIRE_RIGHT_TO_WORK_NOT_COPIED)
    expect(result.warning).toContain('The employee was created')
    // The hire itself is not undone.
    expect(db.rows('recruitment_candidates')[0].converted_employee_id).toBe('emp-1')
    expect(rpcCalls).toContain('recruitment_transition_application_status_actor')
  })
})

describe('eraseRecruitmentCandidate: fails closed', () => {
  function setup() {
    const db = createFakeDb({
      recruitment_candidates: [{
        id: 'cand-1',
        first_name: 'Sam',
        last_name: 'Taylor',
        email: 'sam@example.com',
        cv_file_path: 'cvs/cand-1/sam-taylor.pdf',
        anonymised_at: null,
      }],
      recruitment_candidate_appointments: [{
        id: 'appt-1',
        candidate_id: 'cand-1',
        slot_id: 'slot-1',
        status: 'scheduled',
        scheduled_start: '2099-01-05T10:00:00.000Z',
      }],
      recruitment_appointment_slots: [{ id: 'slot-1', status: 'booked' }],
      recruitment_communications: [{ id: 'msg-1', candidate_id: 'cand-1', final_body: 'Hi Sam', subject: 'Interview' }],
    })
    const storage: Storage = { removed: [], failWith: null }
    const erase = () => eraseRecruitmentCandidate('cand-1', 'GDPR request', clientWith(db, storage))
    const candidate = () => db.rows('recruitment_candidates')[0]
    return { db, storage, erase, candidate }
  }

  it('erases everything and reports success when every step works', async () => {
    const { db, storage, erase, candidate } = setup()

    await expect(erase()).resolves.toEqual({ success: true, cancelledAppointments: 1 })

    expect(candidate().anonymised_at).toEqual(expect.any(String))
    expect(candidate().email).toBeNull()
    expect(candidate().cv_file_path).toBeNull()
    expect(storage.removed).toEqual(['cvs/cand-1/sam-taylor.pdf'])
    expect(db.rows('recruitment_candidate_appointments')[0].status).toBe('cancelled')
    expect(db.rows('recruitment_appointment_slots')[0].status).toBe('open')
    expect(db.rows('recruitment_communications')[0].final_body).toBe('[erased under GDPR request]')
  })

  it('does not report success when an appointment cannot be cancelled, and leaves its slot booked', async () => {
    const { db, erase, candidate } = setup()
    db.failNext({ table: 'recruitment_candidate_appointments', operation: 'update', message: 'permission denied' })

    await expect(erase()).rejects.toThrow(
      "Erasure is incomplete: 1 future appointment could not be cancelled. The candidate's details have not been erased yet. Try the erasure again."
    )

    expect(db.rows('recruitment_appointment_slots')[0].status).toBe('booked')
    // The record is not marked erased, so the Erase button is still there for a retry.
    expect(candidate().anonymised_at).toBeNull()
  })

  it('does not report success when the message history cannot be scrubbed', async () => {
    const { db, erase, candidate } = setup()
    db.failNext({ table: 'recruitment_communications', operation: 'update', message: 'statement timeout' })

    await expect(erase()).rejects.toThrow('their message history could not be scrubbed')

    expect(db.rows('recruitment_communications')[0].final_body).toBe('Hi Sam')
    expect(candidate().anonymised_at).toBeNull()
  })

  it('keeps the CV path when the file cannot be removed, and logs no personal data', async () => {
    const { storage, erase, candidate } = setup()
    storage.failWith = 'storage said no'

    await expect(erase()).rejects.toThrow('the CV file could not be deleted')

    expect(candidate().cv_file_path).toBe('cvs/cand-1/sam-taylor.pdf')
    expect(candidate().anonymised_at).toBeNull()
    const report = consoleError.mock.calls.find(([text]) => String(text).includes('Removing the CV file for erasure failed'))
    expect(report?.[1]).toEqual({ candidateId: 'cand-1', message: 'storage said no' })
    expect(JSON.stringify(report)).not.toContain('sam-taylor')
  })

  it('finishes the job on a retry once the failing step works', async () => {
    const { db, storage, erase, candidate } = setup()
    storage.failWith = 'storage said no'
    db.failNext({ table: 'recruitment_communications', operation: 'update', message: 'statement timeout', times: 1 })

    await expect(erase()).rejects.toThrow(
      "Erasure is incomplete: the CV file could not be deleted; their message history could not be scrubbed."
    )

    storage.failWith = null
    await expect(erase()).resolves.toEqual(expect.objectContaining({ success: true }))
    expect(storage.removed).toEqual(['cvs/cand-1/sam-taylor.pdf'])
    expect(candidate().cv_file_path).toBeNull()
    expect(candidate().anonymised_at).toEqual(expect.any(String))
    expect(db.rows('recruitment_communications')[0].final_body).toBe('[erased under GDPR request]')
  })
})

describe('bulkUpdateRecruitmentApplications: rejection reason', () => {
  function setup() {
    const db = createFakeDb({
      recruitment_applications: [
        { id: 'app-1', status: 'new', rejection_reason: null },
        { id: 'app-2', status: 'new', rejection_reason: null },
      ],
    })
    db.onRpc(() => ({ data: {}, error: null }))
    const run = () =>
      bulkUpdateRecruitmentApplications(['app-1', 'app-2'], { action: 'reject', note: 'Role filled' }, 'user-1', db.client as never)
    return { db, run }
  }

  it('counts every application as updated when the reason saves', async () => {
    const { db, run } = setup()

    await expect(run()).resolves.toEqual({ updated: 2, failures: [] })
    expect(db.rows('recruitment_applications').map((row) => row.rejection_reason)).toEqual(['Role filled', 'Role filled'])
  })

  it('counts an application as failed when its rejection reason is lost', async () => {
    const { db, run } = setup()
    db.failNext({ table: 'recruitment_applications', operation: 'update', message: 'permission denied', times: 1 })

    const result = await run()

    expect(result.updated).toBe(1)
    expect(result.failures).toEqual([{ id: 'app-1', success: false, error: BULK_REJECTION_REASON_NOT_SAVED }])
  })
})
