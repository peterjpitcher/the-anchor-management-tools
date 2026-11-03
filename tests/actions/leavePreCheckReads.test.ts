// Leave actions: reads that run before a write, and what reliability scoring is told.
//
// submitLeaveRequest never read the error on its overlap check, so a failed read looked like "no
// overlap" and the request was saved over leave already there. Approving or declining, and
// changing dates, called any failed read of the request "Request not found". Each now refuses
// plainly and logs the database error. The reliability recorder is now told each request's leave
// type and origin, so late notice on days someone cannot work, or on time off agreed at hire, is
// recorded as information only.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/rota-settings', () => ({ getRotaSettings: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/rota/email-templates', () => ({
  buildHolidaySubmittedEmailHtml: vi.fn(),
  buildHolidayDecisionEmailHtml: vi.fn(),
}))
vi.mock('@/services/employee-reliability', () => ({
  recordHolidayAuditOnly: vi.fn(),
  recordHolidayReliabilityEvents: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRotaSettings } from '@/app/actions/rota-settings'
import { recordHolidayReliabilityEvents } from '@/services/employee-reliability'
import {
  bookApprovedHoliday,
  getLeaveRequests,
  reviewLeaveRequest,
  submitLeaveRequest,
  updateLeaveRequestDates,
} from '@/app/actions/leave'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetRotaSettings = getRotaSettings as unknown as Mock
const mockedRecordHoliday = recordHolidayReliabilityEvents as unknown as Mock

const EMPLOYEE_ID = '33333333-3333-3333-3333-333333333333'
const REQUEST_ID = '44444444-4444-4444-8444-444444444444'
const TIMEOUT = { code: '57014', message: 'canceling statement due to statement timeout' }
const NO_ROW = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }

let consoleError: ReturnType<typeof vi.spyOn>

type Result = { data: unknown; error: unknown }

/** A query builder that ends in the given result however it is chained. */
function query(result: Result): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'neq', 'in', 'lte', 'gte', 'order', 'insert', 'upsert', 'update', 'delete']) {
    chain[method] = () => chain
  }
  chain.maybeSingle = () => Promise.resolve(result)
  chain.single = () => Promise.resolve(result)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

/** A session client. A list of results for a table is used one per query, in order. */
function sessionClient(tables: Record<string, Result | Result[]>): Mock {
  const queues = new Map(Object.entries(tables).map(([table, result]) => [table, Array.isArray(result) ? [...result] : result]))
  const from = vi.fn((table: string) => {
    const entry = queues.get(table)
    if (!entry) throw new Error(`Unexpected table: ${table}`)
    const result = Array.isArray(entry) ? entry.shift() : entry
    if (!result) throw new Error(`No result left for table: ${table}`)
    return query(result)
  })
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } }) },
    from,
  })
  return from
}

/** The service role client: an employee who can be given leave, and the guarded functions. */
function adminClient(rpcResult: Result = { data: null, error: null }): void {
  mockedCreateAdminClient.mockReturnValue({
    from: vi.fn(() => query({ data: { status: 'Active', employment_end_date: null }, error: null })),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  })
}

function leaveRequestCalls(from: Mock): number {
  return from.mock.calls.filter(([table]) => table === 'leave_requests').length
}

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  mockedPermission.mockResolvedValue(true)
  mockedGetRotaSettings.mockResolvedValue({ holidayYearStartMonth: 4, holidayYearStartDay: 1, defaultHolidayDays: 28 })
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('a new holiday request when the overlap check fails', () => {
  it('refuses rather than saving over leave it could not see, and logs the error', async () => {
    adminClient()
    const from = sessionClient({ leave_requests: { data: null, error: TIMEOUT } })

    const result = await submitLeaveRequest({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-08' })

    expect(result).toEqual({ success: false, error: 'Could not save this holiday request. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to check for overlapping leave before a new request:', TIMEOUT)
    // Only the check ran: nothing was inserted.
    expect(leaveRequestCalls(from)).toBe(1)
    expect(from).not.toHaveBeenCalledWith('leave_days')
  })
})

describe('approving or declining when the request cannot be read', () => {
  it('says the approval could not be made, not that the request is missing', async () => {
    sessionClient({ leave_requests: { data: null, error: TIMEOUT } })

    const result = await reviewLeaveRequest(REQUEST_ID, 'approved')

    expect(result).toEqual({ success: false, error: 'Could not approve this holiday. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to load the leave request to review:', TIMEOUT)
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('says the same for a decline', async () => {
    sessionClient({ leave_requests: { data: null, error: TIMEOUT } })

    const result = await reviewLeaveRequest(REQUEST_ID, 'declined')

    expect(result).toEqual({ success: false, error: 'Could not decline this holiday. Please try again.' })
  })

  it('still says not found when there is no such request', async () => {
    sessionClient({ leave_requests: { data: null, error: NO_ROW } })

    const result = await reviewLeaveRequest(REQUEST_ID, 'approved')

    expect(result).toEqual({ success: false, error: 'Request not found' })
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('changing dates when the request cannot be read', () => {
  it('says the dates could not be changed, not that the request is missing', async () => {
    sessionClient({ leave_requests: { data: null, error: TIMEOUT } })

    const result = await updateLeaveRequestDates(REQUEST_ID, '2099-06-07', '2099-06-09')

    expect(result).toEqual({ success: false, error: 'Could not change these dates. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to load the leave request to change its dates:', TIMEOUT)
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('still says not found when there is no such request', async () => {
    sessionClient({ leave_requests: { data: null, error: NO_ROW } })

    const result = await updateLeaveRequestDates(REQUEST_ID, '2099-06-07', '2099-06-09')

    expect(result).toEqual({ success: false, error: 'Request not found' })
  })
})

describe('the self-service check', () => {
  it('logs a failed read of the employee record, and still refuses', async () => {
    mockedPermission.mockResolvedValue(false)
    sessionClient({ employees: { data: null, error: TIMEOUT } })

    const result = await getLeaveRequests({ employeeId: EMPLOYEE_ID })

    expect(result).toEqual({ success: false, error: 'Permission denied' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to check the employee record for self-service:', TIMEOUT)
  })
})

describe('what reliability scoring is told about the leave', () => {
  it('passes the type and origin of an approved request', async () => {
    adminClient({ data: { status: 'approved' }, error: null })
    sessionClient({
      leave_requests: {
        data: {
          id: REQUEST_ID,
          status: 'pending',
          start_date: '2099-06-07',
          end_date: '2099-06-08',
          employee_id: EMPLOYEE_ID,
          note: null,
          created_at: '2099-06-01T09:00:00.000Z',
          leave_type: 'unavailable',
          leave_origin: 'agreed_at_hire',
          employees: null,
        },
        error: null,
      },
    })

    const result = await reviewLeaveRequest(REQUEST_ID, 'approved')

    expect(result).toEqual({ success: true })
    expect(mockedRecordHoliday).toHaveBeenCalledWith(expect.objectContaining({
      includeLate: true,
      leave: expect.objectContaining({ id: REQUEST_ID, leave_type: 'unavailable', leave_origin: 'agreed_at_hire' }),
    }))
  })

  it('passes the defaults the booking function writes for a holiday booked directly', async () => {
    adminClient({ data: { status: 'booked', request_id: REQUEST_ID, leave_dates: ['2099-06-07'] }, error: null })
    sessionClient({})

    const result = await bookApprovedHoliday({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-07' })

    expect(result.success).toBe(true)
    expect(mockedRecordHoliday).toHaveBeenCalledWith(expect.objectContaining({
      leave: expect.objectContaining({ leave_type: 'holiday', leave_origin: 'normal_request' }),
    }))
  })

  it('passes the type and origin when approved dates change', async () => {
    adminClient({ data: { success: true }, error: null })
    sessionClient({
      leave_requests: [
        {
          data: {
            id: REQUEST_ID,
            employee_id: EMPLOYEE_ID,
            status: 'approved',
            start_date: '2099-06-07',
            end_date: '2099-06-08',
            note: null,
            manager_note: null,
            reviewed_by: null,
            reviewed_at: '2099-06-01T09:00:00.000Z',
            holiday_year: 2099,
            created_at: '2099-06-01T09:00:00.000Z',
            updated_at: '2099-06-01T09:00:00.000Z',
            leave_type: 'holiday',
            leave_origin: 'agreed_at_hire',
          },
          error: null,
        },
        { data: [], error: null },
      ],
    })

    const result = await updateLeaveRequestDates(REQUEST_ID, '2099-06-07', '2099-06-09')

    expect(result).toEqual({ success: true })
    expect(mockedRecordHoliday).toHaveBeenCalledWith(expect.objectContaining({
      includeLate: true,
      leave: expect.objectContaining({ leave_type: 'holiday', leave_origin: 'agreed_at_hire', end_date: '2099-06-09' }),
    }))
  })
})
