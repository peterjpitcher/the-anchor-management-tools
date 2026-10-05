import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks: must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRotaWeekDayInfo } from '@/app/actions/rota-day-info'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

// ---------------------------------------------------------------------------
// An in-memory database that applies the filters it is given
//
// The defect this file guards was in the filter, not in the mapping: a row with
// a NULL end_date never came back from the query. A mock that hands back fixed
// rows would hide that, so this one filters its rows the way Postgres does,
// where a comparison with NULL is never true. A filter it does not understand
// throws rather than letting every row through.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type Predicate = (row: Row) => boolean

function compare(operator: string, cell: unknown, value: string): boolean {
  if (operator === 'is') {
    if (value !== 'null') throw new Error(`Unsupported is.${value} in the test database`)
    return cell === null || cell === undefined
  }
  if (cell === null || cell === undefined) return false
  switch (operator) {
    case 'eq':
      return String(cell) === value
    case 'neq':
      return String(cell) !== value
    case 'gte':
      return String(cell) >= value
    case 'lte':
      return String(cell) <= value
    default:
      throw new Error(`Unsupported operator "${operator}" in the test database`)
  }
}

/** Splits on the commas that are not inside brackets. */
function splitTopLevel(expression: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of expression) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
}

/** One term of a PostgREST logic string: `column.operator.value`, `and(...)` or `or(...)`. */
function matchesTerm(term: string, row: Row): boolean {
  const group = /^(and|or)\((.*)\)$/.exec(term)
  if (group) {
    const inner = splitTopLevel(group[2])
    return group[1] === 'and'
      ? inner.every((part) => matchesTerm(part, row))
      : inner.some((part) => matchesTerm(part, row))
  }
  const [column, operator, ...rest] = term.split('.')
  return compare(operator, row[column], rest.join('.'))
}

function createDatabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const predicates: Predicate[] = []
      let orderColumn: string | null = null

      const builder = {
        select: () => builder,
        gte: (column: string, value: string) => {
          predicates.push((row) => compare('gte', row[column], value))
          return builder
        },
        lte: (column: string, value: string) => {
          predicates.push((row) => compare('lte', row[column], value))
          return builder
        },
        neq: (column: string, value: string) => {
          predicates.push((row) => compare('neq', row[column], value))
          return builder
        },
        or: (expression: string) => {
          predicates.push((row) => splitTopLevel(expression).some((term) => matchesTerm(term, row)))
          return builder
        },
        order: (column: string) => {
          orderColumn = column
          return builder
        },
        then: (
          resolve: (value: { data: Row[]; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => {
          try {
            const rows = (tables[table] ?? []).filter((row) => predicates.every((test) => test(row)))
            const column = orderColumn
            if (column) {
              rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')))
            }
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
          } catch (error) {
            return Promise.reject(error).then(resolve, reject)
          }
        },
      }
      return builder
    },
  }
}

function useDatabase(tables: Record<string, Row[]>) {
  mockedCreateAdminClient.mockReturnValue(createDatabase(tables))
}

function note(title: string, noteDate: string, endDate: string | null): Row {
  return { title, note_date: noteDate, end_date: endDate, color: '#0EA5E9' }
}

function titlesByDay(result: Awaited<ReturnType<typeof getRotaWeekDayInfo>>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(result).map(([iso, info]) => [iso, info.calendarNotes.map((n) => n.title)]),
  )
}

// The week the defect was found in. The clocks go back at 02:00 on Sunday 25 October 2026.
const WEEK_START = '2026-10-19'
const WEEK_END = '2026-10-25'
const WEEK_DAYS = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
]

beforeEach(() => {
  vi.clearAllMocks()
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  })
  mockedPermission.mockResolvedValue(true)
})

describe('getRotaWeekDayInfo calendar notes', () => {
  it('shows a note with no end date on its one day', async () => {
    useDatabase({
      calendar_notes: [
        note('Autumn Half Term', '2026-10-17', '2026-11-01'),
        note('Clocks go back', '2026-10-25', null),
      ],
    })

    const days = titlesByDay(await getRotaWeekDayInfo(WEEK_START, WEEK_END))

    expect(days['2026-10-25']).toEqual(['Autumn Half Term', 'Clocks go back'])
    for (const iso of WEEK_DAYS.slice(0, 6)) {
      expect(days[iso]).toEqual(['Autumn Half Term'])
    }
  })

  it('shows a note with no end date on the first day of the week', async () => {
    useDatabase({ calendar_notes: [note('Stock take', WEEK_START, null)] })

    const days = titlesByDay(await getRotaWeekDayInfo(WEEK_START, WEEK_END))

    expect(days[WEEK_START]).toEqual(['Stock take'])
    expect(WEEK_DAYS.slice(1).flatMap((iso) => days[iso])).toEqual([])
  })

  it('leaves out a note with no end date that falls outside the week', async () => {
    useDatabase({
      calendar_notes: [
        note('Day before', '2026-10-18', null),
        note('Day after', '2026-10-26', null),
      ],
    })

    const days = titlesByDay(await getRotaWeekDayInfo(WEEK_START, WEEK_END))

    expect(WEEK_DAYS.flatMap((iso) => days[iso])).toEqual([])
  })

  it('still spreads a note with an end date across every day it covers', async () => {
    useDatabase({
      calendar_notes: [
        note('Started earlier', '2026-10-12', '2026-10-20'),
        note('Midweek', '2026-10-21', '2026-10-22'),
        note('Runs on', '2026-10-24', '2026-10-30'),
        note('Over already', '2026-10-01', '2026-10-18'),
        note('Not yet', '2026-10-26', '2026-10-27'),
      ],
    })

    const days = titlesByDay(await getRotaWeekDayInfo(WEEK_START, WEEK_END))

    expect(days).toEqual({
      '2026-10-19': ['Started earlier'],
      '2026-10-20': ['Started earlier'],
      '2026-10-21': ['Midweek'],
      '2026-10-22': ['Midweek'],
      '2026-10-23': [],
      '2026-10-24': ['Runs on'],
      '2026-10-25': ['Runs on'],
    })
  })
})

describe('getRotaWeekDayInfo days', () => {
  it('returns one entry for each day of the week asked for, whatever zone the server is in', async () => {
    useDatabase({})

    const autumn = await getRotaWeekDayInfo(WEEK_START, WEEK_END)
    // The clocks go forward at 01:00 on Sunday 29 March 2026.
    const spring = await getRotaWeekDayInfo('2026-03-23', '2026-03-29')

    expect(Object.keys(autumn)).toEqual(WEEK_DAYS)
    expect(Object.keys(spring)).toEqual([
      '2026-03-23',
      '2026-03-24',
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
    ])
  })

  it('files events, private bookings and covers under their own date', async () => {
    useDatabase({
      events: [{ date: '2026-10-25', name: 'Quiz Night', time: '19:00', event_status: 'scheduled' }],
      private_bookings: [
        { event_date: '2026-10-19', customer_name: 'Test Party', guest_count: 30, status: 'confirmed' },
      ],
      table_bookings: [
        { booking_date: '2026-10-25', party_size: 4, high_chair_count: 1, is_outside_seating: false, status: 'confirmed' },
      ],
    })

    const result = await getRotaWeekDayInfo(WEEK_START, WEEK_END)

    expect(result['2026-10-25'].events).toEqual([{ name: 'Quiz Night', time: '19:00' }])
    expect(result['2026-10-25'].tableCovers).toBe(4)
    expect(result['2026-10-25'].highChairs).toBe(1)
    expect(result['2026-10-19'].privateBookings).toEqual([{ customer_name: 'Test Party', guest_count: 30 }])
  })

  it('refuses a week that is not a pair of real dates, without querying', async () => {
    useDatabase({ calendar_notes: [note('Clocks go back', '2026-10-25', null)] })

    expect(await getRotaWeekDayInfo('2026-10-19,note_date.gte.1900-01-01', WEEK_END)).toEqual({})
    expect(await getRotaWeekDayInfo(WEEK_START, '2026-02-30')).toEqual({})
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })
})
