// Leave actions: what staff are told when something goes wrong (siblings#5).
//
// The employee Holidays tab, the rota leave manager and the staff portal showed raw Postgres
// text when the leave requests or leave days could not be read. Book Holiday showed the raw Zod
// issue list (a JSON array) for a note over 500 characters, and Postgres text when the booking
// function failed. These now log the detail and say it plainly, worded for every screen that
// calls them.
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
import {
  bookApprovedHoliday,
  cancelOwnLeaveRequest,
  deleteLeaveRequest,
  getEmployeeLeaveDays,
  getHolidayUsage,
  getLeaveRequestById,
  getLeaveRequests,
  reviewLeaveRequest,
  submitLeaveRequest,
  updateLeaveRequestDates,
} from '@/app/actions/leave'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetRotaSettings = getRotaSettings as unknown as Mock

const EMPLOYEE_ID = '33333333-3333-3333-3333-333333333333'
const REQUEST_ID = '44444444-4444-4444-8444-444444444444'
const TIMEOUT = { code: '57014', message: 'canceling statement due to statement timeout' }
const PENDING_REQUEST = {
  id: REQUEST_ID,
  status: 'pending',
  start_date: '2099-06-07',
  end_date: '2099-06-08',
  employee_id: EMPLOYEE_ID,
  note: null,
  created_at: '2099-05-01T09:00:00.000Z',
  employees: null,
}
const LONG_NOTE = 'x'.repeat(501)

let consoleError: ReturnType<typeof vi.spyOn>

/** A query builder that ends in the given result however it is chained. */
function query(result: { data: unknown; error: unknown }): Record<string, unknown> {
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

type Result = { data: unknown; error: unknown }

/** A session client. A list of results for a table is used one per query, in order. */
function sessionClient(tables: Record<string, Result | Result[]>) {
  const queues = new Map(Object.entries(tables).map(([table, result]) => [table, Array.isArray(result) ? [...result] : result]))
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } }) },
    from: vi.fn((table: string) => {
      const entry = queues.get(table)
      if (!entry) throw new Error(`Unexpected table: ${table}`)
      const result = Array.isArray(entry) ? entry.shift() : entry
      if (!result) throw new Error(`No result left for table: ${table}`)
      return query(result)
    }),
  })
}

/** The service role client: an employee who can be given leave, and the guarded functions. */
function adminClient(rpcResult: Result = { data: null, error: null }) {
  mockedCreateAdminClient.mockReturnValue({
    from: vi.fn(() => query({ data: { status: 'Active', employment_end_date: null }, error: null })),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  })
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

describe('Book Holiday input', () => {
  it('asks for a shorter note, not the Zod issue list', async () => {
    const result = await bookApprovedHoliday({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-08', note: LONG_NOTE })

    expect(result).toEqual({ success: false, error: 'Keep the note to 500 characters.' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('asks for valid dates', async () => {
    const result = await bookApprovedHoliday({ employeeId: EMPLOYEE_ID, startDate: '7 June', endDate: '2099-06-08' })

    expect(result).toEqual({ success: false, error: 'Choose valid start and end dates.' })
  })

  it('says the same on the staff portal request form', async () => {
    const result = await submitLeaveRequest({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-08', note: LONG_NOTE })

    expect(result).toEqual({ success: false, error: 'Keep the note to 500 characters.' })
  })
})

describe('Book Holiday when the booking function fails', () => {
  it('says so plainly and logs the Postgres text', async () => {
    sessionClient({})
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(() => query({ data: { status: 'Active', employment_end_date: null }, error: null })),
      rpc: vi.fn().mockResolvedValue({ data: null, error: TIMEOUT }),
    })

    const result = await bookApprovedHoliday({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-08' })

    expect(result).toEqual({ success: false, error: 'Could not book this holiday. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Booking approved holiday failed:', TIMEOUT)
  })
})

describe('reading leave for the Holidays tab, the leave manager and the portal', () => {
  it('leave requests', async () => {
    sessionClient({ leave_requests: { data: null, error: TIMEOUT } })

    const result = await getLeaveRequests({ employeeId: EMPLOYEE_ID })

    expect(result).toEqual({ success: false, error: 'The holiday requests could not be loaded. Refresh the page to try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to load leave requests:', TIMEOUT)
  })

  it('leave days', async () => {
    sessionClient({
      leave_types: { data: [{ code: 'holiday', consumes_allowance: true }], error: null },
      leave_days: { data: null, error: TIMEOUT },
    })

    const result = await getEmployeeLeaveDays(EMPLOYEE_ID)

    expect(result).toEqual({ success: false, error: 'The holiday totals could not be loaded. Refresh the page to try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to load leave days:', TIMEOUT)
  })

  it('still returns each request with its leave type and origin', async () => {
    const row = { id: 'r1', employee_id: EMPLOYEE_ID, leave_type: 'unavailable', leave_origin: 'agreed_at_hire' }
    sessionClient({ leave_requests: { data: [row], error: null } })

    const result = await getLeaveRequests({ employeeId: EMPLOYEE_ID })

    expect(result).toEqual({ success: true, data: [row] })
  })
})

// siblings#5, the rest: the staff portal and the rota paths still returned raw Postgres text.
describe('the staff portal holiday request', () => {
  it('says so plainly when the request cannot be saved', async () => {
    adminClient()
    sessionClient({ leave_requests: [{ data: [], error: null }, { data: null, error: TIMEOUT }] })

    const result = await submitLeaveRequest({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-08' })

    expect(result).toEqual({ success: false, error: 'Could not save this holiday request. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to save leave request:', TIMEOUT)
  })

  it('says the request was saved when only its dates could not be added', async () => {
    adminClient()
    sessionClient({
      leave_requests: [{ data: [], error: null }, { data: { id: REQUEST_ID }, error: null }],
      leave_days: { data: null, error: TIMEOUT },
    })

    const result = await submitLeaveRequest({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-08' })

    expect(result).toEqual({
      success: false,
      error: 'The request was saved, but its dates could not be added to the rota. Ask a manager to check it.',
    })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to add leave days for a new request:', { requestId: REQUEST_ID, ...TIMEOUT })
  })

  it('says so plainly when a cancellation fails', async () => {
    sessionClient({
      employees: { data: { employee_id: EMPLOYEE_ID, status: 'Active', employment_end_date: null }, error: null },
      leave_requests: { data: null, error: TIMEOUT },
    })

    const result = await cancelOwnLeaveRequest(REQUEST_ID)

    expect(result).toEqual({ success: false, error: 'Could not cancel this holiday request. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Cancelling leave request failed:', TIMEOUT)
  })

  it('says so plainly when their employee record cannot be read', async () => {
    sessionClient({ employees: { data: null, error: TIMEOUT } })

    const result = await cancelOwnLeaveRequest(REQUEST_ID)

    expect(result).toEqual({ success: false, error: 'Could not cancel this holiday request. Please try again.' })
  })

  it('does not show the Zod issue list for a bad request id', async () => {
    const result = await cancelOwnLeaveRequest('not-a-request')

    expect(result).toEqual({ success: false, error: 'Only pending holiday requests can be cancelled' })
  })
})

describe('approving and declining on the rota', () => {
  it('says so plainly when the approval function fails', async () => {
    adminClient({ data: null, error: TIMEOUT })
    sessionClient({ leave_requests: { data: PENDING_REQUEST, error: null } })

    const result = await reviewLeaveRequest(REQUEST_ID, 'approved')

    expect(result).toEqual({ success: false, error: 'Could not approve this holiday. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Approving leave request failed:', TIMEOUT)
  })

  it('says so plainly when a decline cannot be saved', async () => {
    sessionClient({ leave_requests: [{ data: PENDING_REQUEST, error: null }, { data: null, error: TIMEOUT }] })

    const result = await reviewLeaveRequest(REQUEST_ID, 'declined')

    expect(result).toEqual({ success: false, error: 'Could not decline this holiday. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Declining leave request failed:', TIMEOUT)
  })

  it('says the request was declined when only its dates could not be cleared', async () => {
    sessionClient({
      leave_requests: [{ data: PENDING_REQUEST, error: null }, { data: { id: REQUEST_ID }, error: null }],
      leave_days: { data: null, error: TIMEOUT },
    })

    const result = await reviewLeaveRequest(REQUEST_ID, 'declined')

    expect(result).toEqual({
      success: false,
      error: 'The request was declined, but its dates could not be cleared from the rota. Refresh the page to check.',
    })
  })
})

describe('editing and deleting on the rota', () => {
  it('says so plainly when the overlap check fails', async () => {
    sessionClient({ leave_requests: [{ data: { ...PENDING_REQUEST, status: 'approved' }, error: null }, { data: null, error: TIMEOUT }] })

    const result = await updateLeaveRequestDates(REQUEST_ID, '2099-06-07', '2099-06-09')

    expect(result).toEqual({ success: false, error: 'Could not change these dates. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to check for overlapping leave:', TIMEOUT)
  })

  it('says so plainly when the date change function fails', async () => {
    adminClient({ data: null, error: TIMEOUT })
    sessionClient({ leave_requests: [{ data: { ...PENDING_REQUEST, status: 'approved' }, error: null }, { data: [], error: null }] })

    const result = await updateLeaveRequestDates(REQUEST_ID, '2099-06-07', '2099-06-09')

    expect(result).toEqual({ success: false, error: 'Could not change these dates. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Updating leave dates failed:', TIMEOUT)
  })

  it('does not show the Zod issue list for bad input', async () => {
    expect(await updateLeaveRequestDates('not-a-request', '2099-06-07', '2099-06-09')).toEqual({ success: false, error: 'Request not found' })
    expect(await updateLeaveRequestDates(REQUEST_ID, '7 June', '2099-06-09')).toEqual({ success: false, error: 'Choose valid start and end dates.' })
  })

  it('says so plainly when a delete fails', async () => {
    sessionClient({ leave_requests: { data: null, error: TIMEOUT } })

    const result = await deleteLeaveRequest(REQUEST_ID)

    expect(result).toEqual({ success: false, error: 'Could not delete this holiday request. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Deleting leave request failed:', TIMEOUT)
  })

  it('calls a bad request id not found', async () => {
    expect(await deleteLeaveRequest('not-a-request')).toEqual({ success: false, error: 'Request not found' })
  })
})

describe('reading one request and the allowance', () => {
  it('a request that cannot be read', async () => {
    sessionClient({ leave_requests: { data: null, error: TIMEOUT } })

    const result = await getLeaveRequestById(REQUEST_ID)

    expect(result).toEqual({ success: false, error: 'The holiday request could not be loaded. Refresh the page to try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to load leave request:', TIMEOUT)
  })

  it('a request that is not there', async () => {
    sessionClient({ leave_requests: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } })

    expect(await getLeaveRequestById(REQUEST_ID)).toEqual({ success: false, error: 'Request not found' })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('an allowance that cannot be read', async () => {
    sessionClient({
      employee_pay_settings: { data: null, error: TIMEOUT },
      leave_types: { data: [{ code: 'holiday', consumes_allowance: true }], error: null },
    })

    const result = await getHolidayUsage(EMPLOYEE_ID, 2099)

    expect(result).toEqual({ success: false, error: 'The holiday allowance could not be loaded. Refresh the page to try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to load holiday allowance:', TIMEOUT)
  })

  it('holiday days that cannot be read', async () => {
    sessionClient({
      employee_pay_settings: { data: { holiday_allowance_days: 28 }, error: null },
      leave_types: { data: [{ code: 'holiday', consumes_allowance: true }], error: null },
      leave_days: { data: null, error: TIMEOUT },
    })

    const result = await getHolidayUsage(EMPLOYEE_ID, 2099)

    expect(result).toEqual({ success: false, error: 'The holiday totals could not be loaded. Refresh the page to try again.' })
    expect(consoleError).toHaveBeenCalledWith('[leave] Failed to load holiday usage:', TIMEOUT)
  })
})
