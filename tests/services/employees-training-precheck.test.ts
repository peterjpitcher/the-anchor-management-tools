// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))

import { EmployeeService, EmployeeServiceError } from '@/services/employees'

const SAM = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const HAS_RECORDS = 'This starter already has training records, which are kept, so they cannot be deleted. Nothing was changed.'
const COULD_NOT_CHECK = 'Could not check for training records, so the employee was not deleted. Please try again.'

/** The three tables that refer to an employee with ON DELETE RESTRICT, each with one row for `employeeId`. */
const TRAINING_ROWS: Record<string, (employeeId: string) => Record<string, unknown>> = {
  training_assignments: (employeeId) => ({ id: 'a1', employee_id: employeeId, course_id: 'c1', status: 'completed' }),
  training_profiles: (employeeId) => ({ employee_id: employeeId, groups: ['bar'], paused_from: null }),
  training_events: (employeeId) => ({ id: 'e1', employee_id: employeeId, event_type: 'groups_confirmed' }),
}

let db: FakeDb

beforeEach(() => {
  db = createFakeDb({
    employees: [{ id: 'e1', employee_id: SAM, first_name: 'Sam', last_name: 'Example', status: 'Onboarding', date_of_birth: null }],
  })
  mocks.client = db.client
})

function deleteWasAttempted(): boolean {
  return db.writes.some((write) => write.table === 'employees' && write.operation === 'delete')
}

describe('deleteEmployee training pre-check', () => {
  it.each(Object.keys(TRAINING_ROWS))('refuses to delete someone with a row in %s, and deletes nothing', async (table) => {
    db.rows(table).push(TRAINING_ROWS[table](SAM))
    await expect(EmployeeService.deleteEmployee(SAM)).rejects.toThrow(HAS_RECORDS)
    expect(db.writes).toEqual([])
    expect(db.rows('employees')).toHaveLength(1)
  })

  it.each(Object.keys(TRAINING_ROWS))('refuses, rather than deleting blind, when the %s check fails', async (table) => {
    db.failNext({ table, operation: 'select', message: 'timeout', times: 1 })
    await expect(EmployeeService.deleteEmployee(SAM)).rejects.toThrow(COULD_NOT_CHECK)
    expect(db.writes).toEqual([])
  })

  it('says it could not check, not that records exist, when one check fails and another finds rows', async () => {
    db.rows('training_profiles').push(TRAINING_ROWS.training_profiles(SAM))
    db.failNext({ table: 'training_events', operation: 'select', message: 'timeout', times: 1 })
    await expect(EmployeeService.deleteEmployee(SAM)).rejects.toThrow(COULD_NOT_CHECK)
    expect(db.writes).toEqual([])
  })

  it('refuses when a check comes back with no count at all', async () => {
    const from = db.client.from
    db.client.from = (table: string) => {
      const query = from(table)
      if (table !== 'training_events') return query
      return {
        ...query,
        select: () => ({ eq: () => Promise.resolve({ data: null, error: null, count: null }) }),
      } as unknown as ReturnType<typeof from>
    }
    await expect(EmployeeService.deleteEmployee(SAM)).rejects.toThrow(COULD_NOT_CHECK)
    expect(db.writes).toEqual([])
  })

  // The deleteEmployee action shows the message of an EmployeeServiceError as it is and turns
  // any other error into its generic message, so both refusals must use that class.
  it('marks both refusals as EmployeeServiceError, so the manager sees the wording', async () => {
    db.rows('training_assignments').push(TRAINING_ROWS.training_assignments(SAM))
    const hasRecords = await EmployeeService.deleteEmployee(SAM).catch((error: unknown) => error)
    expect(hasRecords).toBeInstanceOf(EmployeeServiceError)
    expect((hasRecords as Error).message).toBe(HAS_RECORDS)

    db.rows('training_assignments').length = 0
    db.failNext({ table: 'training_profiles', operation: 'select', message: 'timeout', times: 1 })
    const couldNotCheck = await EmployeeService.deleteEmployee(SAM).catch((error: unknown) => error)
    expect(couldNotCheck).toBeInstanceOf(EmployeeServiceError)
    expect((couldNotCheck as Error).message).toBe(COULD_NOT_CHECK)
  })

  it('does not mark an ordinary failure as a refusal', async () => {
    const missing = await EmployeeService.deleteEmployee(OTHER).catch((error: unknown) => error)
    expect(missing).toBeInstanceOf(Error)
    expect(missing).not.toBeInstanceOf(EmployeeServiceError)
  })

  it('looks only at that person', async () => {
    for (const [table, make] of Object.entries(TRAINING_ROWS)) db.rows(table).push(make(OTHER))
    // Past the pre-check, the delete goes on to the employee row (the rest is covered in employees.service.test.ts).
    await EmployeeService.deleteEmployee(SAM).catch(() => undefined)
    expect(deleteWasAttempted()).toBe(true)
  })
})
