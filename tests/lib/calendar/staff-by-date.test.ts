import { describe, expect, it, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readStaffByDate } from '@/lib/calendar/datasets'

/**
 * "Who is working" on the shared calendar reads rota_shifts for 90 days back and 180
 * days ahead. It used to ask for `.range(0, 4999)`, which reads as a 5,000 row read but
 * is not one: Supabase returns at most 1,000 rows per request and says nothing when it
 * cuts a result short. 437 rows sit in that window today against 1,705 in the table, so
 * nothing was missing on screen yet, but December staffing would have quietly emptied
 * days off the calendar.
 *
 * The mock below therefore enforces the server's real ceiling rather than the span the
 * caller asked for, which is what makes these tests fail against the old code.
 */
const SERVER_ROW_CAP = 1000

const SHIFT_COUNT = 1400
const STAFF_PER_DAY = 100
const DATES = Array.from({ length: SHIFT_COUNT / STAFF_PER_DAY }, (_, index) =>
  `2026-09-${String(index + 1).padStart(2, '0')}`,
)
const START_ISO = DATES[0]
const END_ISO = DATES[DATES.length - 1]

type ShiftRow = { employee_id: string; shift_date: string; start_time: string | null }
type EmployeeRow = {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
}

type RangeCall = [number, number]
type FilterCall = [string, string]

type PageResult = { data: ShiftRow[] | null; error: { message: string } | null }

type ShiftQuery = {
  select: (columns: string) => ShiftQuery
  gte: (column: string, value: string) => ShiftQuery
  lte: (column: string, value: string) => ShiftQuery
  order: (column: string) => ShiftQuery
  range: (from: number, to: number) => Promise<PageResult>
}

type EmployeeQuery = {
  select: (columns: string) => EmployeeQuery
  in: (column: string, values: string[]) => Promise<{ data: EmployeeRow[]; error: null }>
}

/** Shift i belongs to its own employee, so a dropped page loses names we can name. */
function buildShifts(): ShiftRow[] {
  return Array.from({ length: SHIFT_COUNT }, (_, index) => ({
    employee_id: `emp-${index}`,
    shift_date: DATES[Math.floor(index / STAFF_PER_DAY)],
    start_time: '09:00:00',
  }))
}

function buildEmployees(): EmployeeRow[] {
  return Array.from({ length: SHIFT_COUNT }, (_, index) => ({
    employee_id: `emp-${index}`,
    first_name: `Shift ${index}`,
    last_name: 'Worker',
    preferred_name: null,
  }))
}

function createCalendarClient(options: {
  shifts: ShiftRow[]
  employees: EmployeeRow[]
  rangeCalls: RangeCall[]
  orderCalls: string[]
  filterCalls: FilterCall[]
  pageError?: { message: string }
}): SupabaseClient {
  const shiftQuery: ShiftQuery = {
    select: () => shiftQuery,
    gte: (column, value) => {
      options.filterCalls.push([column, value])
      return shiftQuery
    },
    lte: (column, value) => {
      options.filterCalls.push([column, value])
      return shiftQuery
    },
    order: (column) => {
      options.orderCalls.push(column)
      return shiftQuery
    },
    range: (from, to) => {
      options.rangeCalls.push([from, to])
      if (options.pageError) return Promise.resolve({ data: null, error: options.pageError })
      // The server never returns more than 1,000 rows, whatever the range asks for.
      const page = options.shifts.slice(from, to + 1).slice(0, SERVER_ROW_CAP)
      return Promise.resolve({ data: page, error: null })
    },
  }

  const employeeQuery: EmployeeQuery = {
    select: () => employeeQuery,
    in: (_column, values) =>
      Promise.resolve({
        data: options.employees.filter((employee) => values.includes(employee.employee_id)),
        error: null,
      }),
  }

  const from = vi.fn((table: string) => {
    if (table === 'rota_shifts') return shiftQuery
    if (table === 'employees') return employeeQuery
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from } as unknown as SupabaseClient
}

describe('readStaffByDate paging', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns every shift when the window runs past the 1,000 row ceiling', async () => {
    const client = createCalendarClient({
      shifts: buildShifts(),
      employees: buildEmployees(),
      rangeCalls: [],
      orderCalls: [],
      filterCalls: [],
    })

    const result = await readStaffByDate(client, START_ISO, END_ISO)

    expect(result.status).toBe('ok')
    expect(result.data.map((day) => day.date).sort()).toEqual([...DATES].sort())
    expect(result.data.reduce((total, day) => total + day.staff.length, 0)).toBe(SHIFT_COUNT)

    // The last four days live entirely on the second page, so the old single read lost
    // them outright rather than losing a name here and there.
    const lastDay = result.data.find((day) => day.date === DATES[DATES.length - 1])
    expect(lastDay?.staff).toHaveLength(STAFF_PER_DAY)
    expect(lastDay?.staff).toContain(`Shift ${SHIFT_COUNT - 1}`)
  })

  it('reads the shifts in pages of 1,000 over one stable order and one window', async () => {
    const rangeCalls: RangeCall[] = []
    const orderCalls: string[] = []
    const filterCalls: FilterCall[] = []
    const client = createCalendarClient({
      shifts: buildShifts(),
      employees: buildEmployees(),
      rangeCalls,
      orderCalls,
      filterCalls,
    })

    await readStaffByDate(client, START_ISO, END_ISO)

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    // Ordered by the primary key, or which rows a page boundary drops is undefined.
    expect(orderCalls).toEqual(['id', 'id'])
    // Same window on both pages, so the pages are slices of one result.
    expect(filterCalls).toEqual([
      ['shift_date', START_ISO],
      ['shift_date', END_ISO],
      ['shift_date', START_ISO],
      ['shift_date', END_ISO],
    ])
  })

  it('returns the existing failure value rather than throwing when a page fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rangeCalls: RangeCall[] = []
    const client = createCalendarClient({
      shifts: buildShifts(),
      employees: buildEmployees(),
      rangeCalls,
      orderCalls: [],
      filterCalls: [],
      pageError: { message: 'statement timeout' },
    })

    const result = await readStaffByDate(client, START_ISO, END_ISO)

    expect(result).toEqual({
      status: 'failed',
      data: [],
      message: 'Who is working could not be loaded.',
    })
    expect(rangeCalls).toEqual([[0, 999]])
    expect(consoleError).toHaveBeenCalled()
  })
})
