// The employee roster read and the export, over a recording Supabase mock.
//
// FF-06: the roster selected every column and sent each address, date of birth, phone number and
// post code to the browser. FF-50: its holiday column read leave_days in one unpaged request, which
// Supabase cuts off at 1,000 rows with no error. FF-56: it sorted on start date alone, so people
// sharing a start date could swap between pages. FF-57: the export ignored the search box, and every
// phone number came out as '+44... behind the formula guard.
//
// These also carry the holiday count cases from tests/services/employees.service.test.ts, rewritten
// for the paged read, so that older block can be retired.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { clearLeaveTypeCache } from '@/lib/leave/leave-types'
import { EmployeeService } from '@/services/employees'

type Call = { method: string; args: unknown[] }
type Result = { data?: unknown; error?: { message: string } | null; count?: number | null }

/**
 * A PostgREST-style builder that records every call. Awaiting it asks `resolve` for the result,
 * given the table and the calls made, so a test can answer each page of a paged read differently.
 */
function recordingClient(resolve: (table: string, calls: Call[]) => Result) {
  const queries: Array<{ table: string; calls: Call[] }> = []
  const from = vi.fn((table: string) => {
    const calls: Call[] = []
    queries.push({ table, calls })
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'in', 'eq', 'or', 'gte', 'lte', 'order', 'range', 'limit']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
    }
    builder.maybeSingle = () => Promise.resolve(resolve(table, [...calls, { method: 'maybeSingle', args: [] }]))
    builder.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve(table, calls)).then(onFulfilled, onRejected)
    return builder
  })
  ;(createAdminClient as unknown as Mock).mockReturnValue({ from })
  return { queries }
}

function argsOf(calls: Call[], method: string): unknown[][] {
  return calls.filter((call) => call.method === method).map((call) => call.args)
}

const LEAVE_TYPES = [
  { code: 'holiday', label: 'Holiday', consumes_allowance: true, paid: true, shown_on_rota: true, counts_in_reliability: true, allowed_at_onboarding: true, sort_order: 1, is_active: true },
  { code: 'unavailable', label: 'Not available to work', consumes_allowance: false, paid: false, shown_on_rota: true, counts_in_reliability: false, allowed_at_onboarding: true, sort_order: 2, is_active: true },
]

// A full employees row, as select('*') would return it, with every personal field filled in.
function fullEmployee(id: string, overrides: Record<string, unknown> = {}) {
  return {
    employee_id: id,
    first_name: 'Alex',
    last_name: 'Rowe',
    preferred_name: null,
    email_address: `${id}@example.com`,
    job_title: 'Server',
    employment_start_date: '2024-01-10',
    status: 'Active',
    auth_user_id: null,
    address: '1 Private Road',
    post_code: 'TW19 6AQ',
    date_of_birth: '1990-05-01',
    mobile_number: '+447700900123',
    phone_number: '+441753000000',
    timeclock_pin_hash: 'hash',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

interface RosterSetup {
  employees?: Record<string, unknown>[]
  /** Answers each leave_days page, given the range asked for. */
  leaveDayPage?: (from: number, to: number) => Result
  holidayYearStartMonth?: number
  holidayYearStartDay?: number
}

function setupRoster({
  employees = [fullEmployee('employee-1'), fullEmployee('employee-2', { first_name: 'Blake' })],
  leaveDayPage = () => ({ data: [], error: null }),
  holidayYearStartMonth = 1,
  holidayYearStartDay = 1,
}: RosterSetup = {}) {
  return recordingClient((table, calls) => {
    if (table === 'employees') {
      const [columns, options] = (argsOf(calls, 'select')[0] ?? []) as [string, { count?: string } | undefined]
      if (columns === 'status') return { data: employees.map((row) => ({ status: row.status })), error: null }
      if (options?.count === 'exact') return { count: employees.length, error: null }
      return { data: employees, error: null }
    }
    if (table === 'leave_days') {
      const [from, to] = argsOf(calls, 'range')[0] as [number, number]
      return leaveDayPage(from, to)
    }
    if (table === 'system_settings') {
      const key = argsOf(calls, 'eq')[0]?.[1]
      return { data: { value: { value: key === 'rota_holiday_year_start_month' ? holidayYearStartMonth : holidayYearStartDay } }, error: null }
    }
    if (table === 'leave_types') return { data: LEAVE_TYPES, error: null }
    throw new Error(`Unexpected table: ${table}`)
  })
}

function leaveDay(employeeId: string, leaveDate: string, leaveType = 'holiday') {
  return { employee_id: employeeId, leave_date: leaveDate, leave_requests: { status: 'approved', leave_type: leaveType } }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Leave types are cached in module scope for five minutes, so a stale entry from an
  // earlier test would silently satisfy the next one.
  clearLeaveTypeCache()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-05-04T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the roster sends only the columns the list shows (FF-06)', () => {
  it('never selects or returns address, date of birth, phone numbers, post code or the PIN hash', async () => {
    const { queries } = setupRoster()

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    const pageRead = queries.find(
      (query) => query.table === 'employees' && argsOf(query.calls, 'range').length > 0
    )!
    const [columns] = argsOf(pageRead.calls, 'select')[0] as [string]
    for (const column of ['address', 'date_of_birth', 'mobile_number', 'phone_number', 'post_code', 'timeclock_pin_hash', '*']) {
      expect(columns.split(',').map((part) => part.trim())).not.toContain(column)
    }

    // Even when the database hands back more than was asked for, none of it reaches the page.
    expect(result.employees).toHaveLength(2)
    for (const employee of result.employees) {
      for (const field of ['address', 'date_of_birth', 'mobile_number', 'phone_number', 'post_code', 'timeclock_pin_hash', 'created_at']) {
        expect(employee).not.toHaveProperty(field)
      }
    }
    expect(result.employees[0]).toEqual({
      employee_id: 'employee-1',
      first_name: 'Alex',
      last_name: 'Rowe',
      preferred_name: null,
      email_address: 'employee-1@example.com',
      job_title: 'Server',
      employment_start_date: '2024-01-10',
      status: 'Active',
      auth_user_id: null,
      holiday_days_current_year: 0,
    })
  })

  it('still searches phone numbers and post codes, on the server', async () => {
    const { queries } = setupRoster()

    await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50, searchTerm: '07700' })

    const pageRead = queries.find(
      (query) => query.table === 'employees' && argsOf(query.calls, 'range').length > 0
    )!
    const [filter] = argsOf(pageRead.calls, 'or')[0] as [string]
    expect(filter).toContain('mobile_number.ilike.%07700%')
    expect(filter).toContain('post_code.ilike.%07700%')
  })
})

describe('the roster pages in a fixed order (FF-56)', () => {
  it('breaks ties on start date with the employee id', async () => {
    const { queries } = setupRoster()

    await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    const pageRead = queries.find(
      (query) => query.table === 'employees' && argsOf(query.calls, 'range').length > 0
    )!
    expect(argsOf(pageRead.calls, 'order')).toEqual([
      ['employment_start_date', { ascending: true }],
      ['employee_id', { ascending: true }],
    ])
  })
})

describe('the holiday column reads every leave day (FF-50)', () => {
  it('pages past 1,000 approved days instead of stopping at the first 1,000', async () => {
    // 1,250 approved holiday days for one person: 1,000 on the first page, 250 on the second.
    const days = Array.from({ length: 1250 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1) + (index % 365) * 86_400_000).toISOString().slice(0, 10)
      return leaveDay(index < 625 ? 'employee-1' : 'employee-2', date)
    })
    const { queries } = setupRoster({
      leaveDayPage: (from, to) => ({ data: days.slice(from, to + 1), error: null }),
    })

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    const leaveReads = queries.filter((query) => query.table === 'leave_days')
    expect(leaveReads.map((query) => argsOf(query.calls, 'range')[0])).toEqual([[0, 999], [1000, 1999]])
    // A stable order, so a page never repeats or skips a row.
    expect(argsOf(leaveReads[0].calls, 'order')).toEqual([['id', { ascending: true }]])
    // Every one of the 1,250 rows is counted; a single read would have stopped at 1,000.
    const counts = Object.fromEntries(result.employees.map((employee) => [employee.employee_id, employee.holiday_days_current_year]))
    expect(counts).toEqual({ 'employee-1': 625, 'employee-2': 625 })
  })

  it('fails loudly when a page of leave days cannot be read, rather than undercounting', async () => {
    setupRoster({
      leaveDayPage: (from) => (from === 0
        ? { data: Array.from({ length: 1000 }, () => leaveDay('employee-1', '2026-01-15')), error: null }
        : { data: null, error: { message: 'statement timeout' } }),
    })

    await expect(EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })).rejects.toThrow(/statement timeout/)
  })

  it('counts approved leave days in the current holiday year for the people on the page', async () => {
    const { queries } = setupRoster({
      leaveDayPage: () => ({ data: [leaveDay('employee-1', '2026-01-15'), leaveDay('employee-1', '2026-12-24')], error: null }),
    })

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    expect(result.employees.find((employee) => employee.employee_id === 'employee-1')?.holiday_days_current_year).toBe(2)
    expect(result.employees.find((employee) => employee.employee_id === 'employee-2')?.holiday_days_current_year).toBe(0)
    const read = queries.find((query) => query.table === 'leave_days')!
    expect(argsOf(read.calls, 'select')).toEqual([['employee_id, leave_date, leave_requests!inner(status, leave_type)']])
    expect(argsOf(read.calls, 'in')).toEqual([['employee_id', ['employee-1', 'employee-2']]])
    expect(argsOf(read.calls, 'gte')).toEqual([['leave_date', '2026-01-01']])
    expect(argsOf(read.calls, 'lte')).toEqual([['leave_date', '2026-12-31']])
    expect(argsOf(read.calls, 'eq')).toEqual([['leave_requests.status', 'approved']])
  })

  it('does not count leave whose type does not consume allowance', async () => {
    setupRoster({
      leaveDayPage: () => ({
        data: [
          leaveDay('employee-1', '2026-01-15', 'holiday'),
          leaveDay('employee-1', '2026-01-16', 'unavailable'),
          leaveDay('employee-1', '2026-01-17', 'unavailable'),
        ],
        error: null,
      }),
    })

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    expect(result.employees.find((employee) => employee.employee_id === 'employee-1')?.holiday_days_current_year).toBe(1)
  })

  it('counts weekend leave, because the pub trades at the weekend', async () => {
    setupRoster({
      leaveDayPage: () => ({ data: [leaveDay('employee-1', '2026-01-17'), leaveDay('employee-1', '2026-01-18')], error: null }),
    })

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    expect(result.employees.find((employee) => employee.employee_id === 'employee-1')?.holiday_days_current_year).toBe(2)
  })

  it('uses the configured holiday year rather than the calendar year', async () => {
    const { queries } = setupRoster({ holidayYearStartMonth: 4, holidayYearStartDay: 6 })

    await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    // 4 May 2026, so the current holiday year runs 6 April 2026 to 5 April 2027.
    const read = queries.find((query) => query.table === 'leave_days')!
    expect(argsOf(read.calls, 'gte')).toEqual([['leave_date', '2026-04-06']])
    expect(argsOf(read.calls, 'lte')).toEqual([['leave_date', '2027-04-05']])
  })

  it('does not read leave days when the page is empty', async () => {
    const { queries } = setupRoster({ employees: [] })

    const result = await EmployeeService.getEmployeesRoster({ page: 1, pageSize: 50 })

    expect(result.employees).toEqual([])
    expect(queries.some((query) => query.table === 'leave_days')).toBe(false)
  })
})

describe('the export (FF-57)', () => {
  function setupExport(rows: Record<string, unknown>[] = [fullEmployee('employee-1')]) {
    return recordingClient((table) => {
      if (table === 'employees') return { data: rows, error: null }
      throw new Error(`Unexpected table: ${table}`)
    })
  }

  it('applies the search box, so the file holds the people the list shows', async () => {
    const { queries } = setupExport()

    await EmployeeService.exportEmployeesData({ format: 'csv', statusFilter: 'Active', searchTerm: 'Mandy' })

    const read = queries[0]
    expect(argsOf(read.calls, 'in')).toEqual([['status', ['Active', 'Started Separation']]])
    const [filter] = argsOf(read.calls, 'or')[0] as [string]
    expect(filter).toContain('preferred_name.ilike.%Mandy%')
    expect(filter).toContain('first_name.ilike.%Mandy%')
  })

  it('exports everyone on the tab when the search box is empty', async () => {
    const { queries } = setupExport()

    await EmployeeService.exportEmployeesData({ format: 'csv' })

    expect(argsOf(queries[0].calls, 'or')).toEqual([])
    expect(argsOf(queries[0].calls, 'in')).toEqual([])
    expect(argsOf(queries[0].calls, 'eq')).toEqual([])
  })

  it('writes phone numbers without a stray apostrophe, and still guards formulas', () => {
    const csv = EmployeeService.generateCSV([
      {
        employee_id: 'employee-1',
        mobile_number: '+447700900123',
        phone_number: '+44 1753 000000',
        first_name: '+SUM(A1:A2)',
        last_name: '=HYPERLINK("x")',
        job_title: '+44 then text',
      } as never,
    ], ['mobile_number', 'phone_number', 'first_name', 'last_name', 'job_title'])

    const [, row] = csv.split('\n')
    expect(row).toBe(`+447700900123,+44 1753 000000,'+SUM(A1:A2),"'=HYPERLINK(""x"")",'+44 then text`)
  })
})
