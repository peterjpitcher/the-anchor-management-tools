// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * Build contract 5.7: deleting a starter with training records is refused, because training
 * records are kept. EmployeeService.deleteEmployee refuses with an EmployeeServiceError; the
 * action must show the manager that wording, and record it in the failure audit row, instead of
 * the generic message it gives any other error.
 */

const mocks = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import { deleteEmployee } from '@/app/actions/employeeActions'

const SAM = '11111111-1111-4111-8111-111111111111'
const HAS_RECORDS = 'This starter already has training records, which are kept, so they cannot be deleted. Nothing was changed.'
const COULD_NOT_CHECK = 'Could not check for training records, so the employee was not deleted. Please try again.'

let db: FakeDb

function deleteForm(employeeId: string): FormData {
  const form = new FormData()
  form.set('employee_id', employeeId)
  return form
}

function failureAuditMessages(): unknown[] {
  return (logAuditEvent as unknown as Mock).mock.calls
    .map(([entry]) => entry as { operation_status?: string; error_message?: string })
    .filter((entry) => entry.operation_status === 'failure')
    .map((entry) => entry.error_message)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkUserPermission as unknown as Mock).mockResolvedValue(true)
  ;(getCurrentUser as unknown as Mock).mockResolvedValue({ user_id: 'user-1', user_email: 'manager@example.com' })
  db = createFakeDb({
    employees: [{ id: 'e1', employee_id: SAM, first_name: 'Sam', last_name: 'Example', status: 'Onboarding', date_of_birth: null }],
  })
  mocks.client = db.client
})

describe('deleteEmployee action, training records refusal', () => {
  it('shows the manager the refusal when the starter has training records', async () => {
    db.rows('training_assignments').push({ id: 'a1', employee_id: SAM, course_id: 'c1', status: 'completed' })

    const result = await deleteEmployee(null, deleteForm(SAM))

    expect(result).toEqual({ type: 'error', message: HAS_RECORDS })
    expect(failureAuditMessages()).toEqual([HAS_RECORDS])
    expect(db.rows('employees')).toHaveLength(1)
  })

  it('says it could not check when the training check fails', async () => {
    db.failNext({ table: 'training_events', operation: 'select', message: 'timeout', times: 1 })

    const result = await deleteEmployee(null, deleteForm(SAM))

    expect(result).toEqual({ type: 'error', message: COULD_NOT_CHECK })
    expect(failureAuditMessages()).toEqual([COULD_NOT_CHECK])
    expect(db.rows('employees')).toHaveLength(1)
  })

  it('keeps the generic message for any other failure', async () => {
    const result = await deleteEmployee(null, deleteForm('22222222-2222-4222-8222-222222222222'))

    expect(result).toEqual({ type: 'error', message: 'The employee could not be deleted. Please try again.' })
  })
})
