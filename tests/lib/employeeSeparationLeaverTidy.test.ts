// Marking a leaver as Former tidies what they leave behind instead of refusing.
//
// On 3 November 2026 the nightly job refused a leaver whose last working day was 28 October,
// because holiday booked in August ran from 1 to 8 November. Leave after the last working day is
// now removed (cut back to the last day, or deleted when it starts after it), sick shifts no
// longer block, a clock-in after the last day is reported, and their pending open shift requests
// are declined.
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
const TODAY = '2026-11-03'
const LAST_WORKING_DAY = '2026-10-28'

const mockedAudit = logAuditEvent as unknown as ReturnType<typeof vi.fn>

type LeaveRequestRow = {
  id: string
  status: 'pending' | 'approved'
  start_date: string
  end_date: string
}

/**
 * An admin client whose query chains record their calls and resolve on await. The employee is on
 * notice with a last working day of 28 October and a login; nothing blocks unless told otherwise.
 */
function adminClientFor(options: {
  leaveRequests?: LeaveRequestRow[]
  /** Refuses every write to leave_requests. */
  leaveWriteFails?: boolean
  lateClockIns?: Array<{ work_date: string }>
} = {}) {
  const calls: QueryCall[] = []

  function query(table: string) {
    const methods: string[] = []
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          let result: unknown = { data: [], error: null }
          if (table === 'employees' && methods.includes('maybeSingle')) {
            result = {
              data: { auth_user_id: AUTH_USER_ID, email_address: 'alex@example.com', status: 'Started Separation', employment_end_date: LAST_WORKING_DAY },
              error: null,
            }
          } else if (table === 'employees' && methods.includes('update') && methods.includes('select')) {
            result = { data: [{ employee_id: EMPLOYEE_ID }], error: null }
          } else if (table === 'leave_requests' && (methods.includes('update') || methods.includes('delete'))) {
            result = { data: null, error: options.leaveWriteFails ? { message: 'permission denied', code: '42501' } : null }
          } else if (table === 'leave_requests' && methods.includes('select')) {
            result = { data: options.leaveRequests ?? [], error: null }
          } else if (table === 'timeclock_sessions' && methods.includes('gt')) {
            result = { data: options.lateClockIns ?? [], error: null }
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

  const deleteUser = vi.fn().mockResolvedValue({ error: null })
  const client = {
    from: vi.fn((table: string) => query(table)),
    auth: { admin: { deleteUser } },
  }
  return { client: client as unknown as AdminClient, calls, deleteUser }
}

function callsOn(calls: QueryCall[], table: string, method: string) {
  return calls.filter(call => call.table === table && call.method === method)
}

function notesWritten(calls: QueryCall[]): string[] {
  return callsOn(calls, 'employee_notes', 'insert').map(call => (call.args[0] as { note_text: string }).note_text)
}

function markedFormer(calls: QueryCall[]): boolean {
  return callsOn(calls, 'employees', 'update')
    .some(call => (call.args[0] as Record<string, unknown>).status === 'Former')
}

describe('finalizeEmployeeSeparation tidies a leaver instead of refusing', () => {
  let consoleError: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('deletes holiday that starts after the last working day and marks them as Former', async () => {
    const { client, calls } = adminClientFor({
      leaveRequests: [{ id: 'leave-1', status: 'approved', start_date: '2026-11-01', end_date: '2026-11-08' }],
    })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY, source: 'automatic' })

    expect(result).toEqual({ success: true, employmentEndDate: LAST_WORKING_DAY, authUserDeleted: true })
    // Leave from the day after the last working day, not from today: 1 to 3 November counted too.
    expect(callsOn(calls, 'leave_requests', 'gt')[0].args).toEqual(['end_date', LAST_WORKING_DAY])
    expect(callsOn(calls, 'leave_requests', 'delete')).toHaveLength(1)
    expect(callsOn(calls, 'leave_requests', 'eq').map(call => call.args)).toContainEqual(['id', 'leave-1'])
    expect(callsOn(calls, 'leave_requests', 'update')).toHaveLength(0)
    expect(callsOn(calls, 'leave_days', 'gt')[0].args).toEqual(['leave_date', LAST_WORKING_DAY])
    expect(notesWritten(calls)).toContain(
      'Holiday booked after their last working day (28 October 2026) was removed because they have left: 1 November 2026 to 8 November 2026 (approved, 8 days).',
    )
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'delete',
      resource_type: 'leave_request',
      resource_id: 'leave-1',
      old_values: { start_date: '2026-11-01', end_date: '2026-11-08', status: 'approved' },
    }))
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'access_revoked',
      additional_info: expect.objectContaining({
        leave_removed: [{
          leave_request_id: 'leave-1',
          status: 'approved',
          removed_from: '2026-11-01',
          removed_to: '2026-11-08',
          request_deleted: true,
        }],
      }),
    }))
    expect(markedFormer(calls)).toBe(true)
  })

  it('cuts a request that runs past the last working day back to end on it', async () => {
    const { client, calls } = adminClientFor({
      leaveRequests: [{ id: 'leave-2', status: 'pending', start_date: '2026-10-26', end_date: '2026-10-31' }],
    })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, {
      adminClient: client,
      todayIso: TODAY,
      actorUser: { user_id: 'manager-1', user_email: 'manager@example.com' },
    })

    expect(result.success).toBe(true)
    // The request keeps its start (and so its holiday year); the days after are cleared in one go.
    expect(callsOn(calls, 'leave_requests', 'update').map(call => call.args[0])).toEqual([{ end_date: LAST_WORKING_DAY }])
    expect(callsOn(calls, 'leave_requests', 'delete')).toHaveLength(0)
    expect(callsOn(calls, 'leave_days', 'gt')[0].args).toEqual(['leave_date', LAST_WORKING_DAY])
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'manager-1',
      operation_type: 'update',
      resource_type: 'leave_request',
      new_values: { start_date: '2026-10-26', end_date: LAST_WORKING_DAY, status: 'pending' },
    }))
    expect(notesWritten(calls)).toContain(
      'Holiday booked after their last working day (28 October 2026) was removed because they have left: 29 October 2026 to 31 October 2026 (waiting for a decision, 3 days).',
    )
  })

  it('stops before the status change when the holiday cannot be removed', async () => {
    const { client, calls, deleteUser } = adminClientFor({
      leaveRequests: [{ id: 'leave-3', status: 'approved', start_date: '2026-10-27', end_date: '2026-11-02' }],
      leaveWriteFails: true,
    })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY })

    expect(result).toEqual({
      success: false,
      error: 'Could not remove the holiday booked after their last working day, so they have not been marked as Former. Please try again.',
      code: 'leave_removal_failed',
    })
    expect(markedFormer(calls)).toBe(false)
    expect(callsOn(calls, 'user_roles', 'delete')).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('counts only scheduled shifts as in the way, not shifts marked sick', async () => {
    const { client, calls } = adminClientFor()

    await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY, blockShiftsOnOrAfterToday: true })

    expect(callsOn(calls, 'rota_shifts', 'eq').map(call => call.args)).toContainEqual(['status', 'scheduled'])
    expect(callsOn(calls, 'rota_shifts', 'neq')).toHaveLength(0)
  })

  it('marks them as Former but says so when they clocked in after the last working day', async () => {
    const { client, calls } = adminClientFor({ lateClockIns: [{ work_date: '2026-10-30' }] })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY })

    expect(result).toEqual({
      success: true,
      employmentEndDate: LAST_WORKING_DAY,
      authUserDeleted: true,
      warning: 'They clocked in on 30 October 2026, after their last working day of 28 October 2026. Check that date and their final pay.',
    })
    expect(callsOn(calls, 'timeclock_sessions', 'gt')[0].args).toEqual(['work_date', LAST_WORKING_DAY])
    expect(markedFormer(calls)).toBe(true)
  })

  it('declines their open shift requests that are still waiting', async () => {
    const { client, calls } = adminClientFor()

    await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: TODAY, actorUser: { user_id: 'manager-1' } })

    const [decline] = callsOn(calls, 'rota_open_shift_requests', 'update')
    expect(decline.args[0]).toEqual(expect.objectContaining({
      status: 'declined',
      decided_by: 'manager-1',
      manager_note: 'Declined automatically because they have left.',
    }))
    expect(callsOn(calls, 'rota_open_shift_requests', 'eq').map(call => call.args)).toEqual([
      ['employee_id', EMPLOYEE_ID],
      ['status', 'pending'],
    ])
  })
})
