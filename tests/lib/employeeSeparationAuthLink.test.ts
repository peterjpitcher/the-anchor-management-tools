// Marking someone as Former: the login link and the refusal messages (FF-47, FF-48).
//
// The employee's auth_user_id was cleared whether or not deleting their login worked, which left
// a live login that nothing pointed at. It is now cleared only once the login is gone, and a
// failed delete comes back as a warning. The refusal for future shifts also names the dates, so
// whoever reads the nightly job's alert knows what to clear. Leave after the last working day is
// removed rather than refused (employeeSeparationLeaverTidy.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { logAuditEvent } from '@/app/actions/audit'
import { finalizeEmployeeSeparation } from '@/lib/employees/separation'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>
type QueryCall = { table: string; method: string; args: unknown[] }

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const AUTH_USER_ID = '00000000-0000-4000-8000-0000000000aa'
const TODAY = '2026-11-02'

const mockedAudit = logAuditEvent as unknown as ReturnType<typeof vi.fn>

/**
 * An admin client whose query chains record their calls and resolve on await. The employee has a
 * login, every check finds nothing blocking unless told otherwise, and every write succeeds.
 */
function adminClientFor(options: {
  deleteUserError?: { message: string } | null
  futureShifts?: Array<{ id: string; shift_date: string }>
  futureLeave?: Array<{ leave_date: string }>
}) {
  const calls: QueryCall[] = []

  function query(table: string) {
    const methods: string[] = []
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          let result: unknown = { data: [], error: null }
          if (table === 'employees' && methods.includes('maybeSingle')) {
            result = {
              data: { auth_user_id: AUTH_USER_ID, email_address: 'alex@example.com', status: 'Started Separation', employment_end_date: TODAY },
              error: null,
            }
          } else if (table === 'employees' && methods.includes('update') && methods.includes('select')) {
            result = { data: [{ employee_id: EMPLOYEE_ID }], error: null }
          } else if (table === 'rota_shifts') {
            result = { data: options.futureShifts ?? [], error: null }
          } else if (table === 'leave_days') {
            result = { data: options.futureLeave ?? [], error: null }
          } else if (methods.includes('update') || methods.includes('delete') || methods.includes('insert')) {
            result = { data: null, error: null }
          }
          return (resolve: (value: unknown) => unknown) => resolve(result)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(property), args })
          methods.push(String(property))
          return chain
        }
      },
    })
    return chain
  }

  const deleteUser = vi.fn().mockResolvedValue({ error: options.deleteUserError ?? null })
  const client = {
    from: vi.fn((table: string) => query(table)),
    auth: { admin: { deleteUser } },
  }
  return { client: client as unknown as AdminClient, calls, deleteUser }
}

function authLinkClears(calls: QueryCall[]) {
  return calls.filter(call =>
    call.table === 'employees'
    && call.method === 'update'
    && 'auth_user_id' in (call.args[0] as Record<string, unknown>))
}

describe('finalizeEmployeeSeparation and the login link', () => {
  let consoleError: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('keeps the link to the login and warns when the login cannot be deleted', async () => {
    const { client, calls } = adminClientFor({ deleteUserError: { message: 'User not allowed' } })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY })

    expect(result).toEqual({
      success: true,
      employmentEndDate: TODAY,
      authUserDeleted: false,
      warning: 'They are now Former and their permissions are removed, but their login could not be deleted. Ask an administrator to delete it.',
    })
    expect(authLinkClears(calls)).toHaveLength(0)
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'access_revoked',
      old_values: { status: 'Started Separation', employment_end_date: TODAY },
      new_values: expect.objectContaining({ status: 'Former', auth_user_id_cleared: false }),
      additional_info: expect.objectContaining({ auth_user_deleted: false }),
    }))
  })

  it('clears the link once the login is deleted', async () => {
    const { client, calls, deleteUser } = adminClientFor({})

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY })

    expect(result).toEqual({ success: true, employmentEndDate: TODAY, authUserDeleted: true })
    // Soft: a hard delete fails for anyone named on audit_logs (every current member of staff).
    expect(deleteUser).toHaveBeenCalledWith(AUTH_USER_ID, true)
    expect(authLinkClears(calls)).toHaveLength(1)
    expect(authLinkClears(calls)[0].args[0]).toEqual({ auth_user_id: null })
  })
})

describe('finalizeEmployeeSeparation refusals name the dates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the rota shifts in the way', async () => {
    const { client, deleteUser } = adminClientFor({
      futureShifts: [{ id: 'shift-1', shift_date: '2026-11-05' }, { id: 'shift-2', shift_date: '2026-11-06' }],
    })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY })

    expect(result).toEqual({
      success: false,
      error: 'This employee still has rota shifts on 5 November 2026, 6 November 2026. Reassign or cancel those shifts before marking them as Former.',
      code: 'future_rota_shifts',
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
