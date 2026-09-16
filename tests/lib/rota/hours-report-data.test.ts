import { describe, it, expect } from 'vitest'
import { loadHoursReportData } from '@/lib/rota/hours-report-data'

// A chainable stand-in for the Supabase query builder. Every filter returns the
// chain, `.order()` records the column so the tiebreak can be asserted, the chain
// is thenable (an unpaged read resolves on its own) and `.range()` records the
// window so paging can be asserted a page at a time.
type Resolved = { data: unknown[] | null; error: { message: string } | null }
type Responder = (from: number | null, to: number | null) => Resolved
type RecordedCall = { table: string; orders: string[]; ranges: Array<[number, number]> }

const EMPTY: Responder = () => ({ data: [], error: null })

function fakeSupabase(responders: Record<string, Responder>) {
  const calls: RecordedCall[] = []

  function chain(table: string) {
    const recorded: RecordedCall = { table, orders: [], ranges: [] }
    calls.push(recorded)
    const respond = (from: number | null, to: number | null) => (responders[table] ?? EMPTY)(from, to)

    // The fake mirrors PostgREST's loose builder shape, so it is untyped by nature.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {}
    for (const method of ['select', 'gte', 'lte', 'eq', 'gt', 'not']) {
      builder[method] = () => builder
    }
    builder.order = (column: string) => {
      recorded.orders.push(column)
      return builder
    }
    builder.range = (from: number, to: number) => {
      recorded.ranges.push([from, to])
      return Promise.resolve(respond(from, to))
    }
    // A request with no `.range()` is capped at 1,000 rows by Supabase, silently, so
    // the fake truncates too: an unpaged read must look as short here as it is live.
    builder.then = (resolve: (value: Resolved) => unknown) => {
      const { data, error } = respond(null, null)
      return resolve({ data: data ? data.slice(0, 1000) : data, error })
    }
    return builder
  }

  const client = { from: (table: string) => chain(table) } as unknown as Parameters<typeof loadHoursReportData>[0]

  // A paged read builds a fresh query per page, so gather every request for a table:
  // the ranges across all of them, and the ordering the first one asked for.
  function readOf(table: string): { orders: string[]; ranges: Array<[number, number]> } {
    const forTable = calls.filter(call => call.table === table)
    return {
      orders: forTable[0]?.orders ?? [],
      ranges: forTable.flatMap(call => call.ranges),
    }
  }

  return { client, calls, readOf }
}

function pageOf(rows: unknown[]): Responder {
  return (from, to) => ({ data: rows.slice(from ?? 0, (to ?? rows.length - 1) + 1), error: null })
}

function sessionRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    employee_id: 'employee-1',
    work_date: '2025-06-01',
    clock_in_at: '2025-06-01T09:00:00Z',
    clock_out_at: '2025-06-01T17:00:00Z',
  }))
}

function leaveDayRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    employee_id: 'employee-1',
    leave_date: '2025-06-01',
    request_id: `request-${index}`,
  }))
}

// A range the screen's free From and To boxes allow: fifteen months, which is where
// the 1,000 row ceiling started eating the newest weeks.
const FIFTEEN_MONTHS = { fromDate: '2025-06-16', toDate: '2026-09-16', today: '2026-09-16' }

describe('loadHoursReportData', () => {
  it('returns every session in a fifteen month range rather than the first thousand', async () => {
    const all = sessionRows(1025)
    const { client, readOf } = fakeSupabase({ timeclock_sessions: pageOf(all) })

    const data = await loadHoursReportData(client, FIFTEEN_MONTHS)

    expect(data.sessions).toHaveLength(1025)
    expect(data.sessions[0].id).toBe('session-0')
    expect(data.sessions[1024].id).toBe('session-1024')
    expect(readOf('timeclock_sessions').ranges).toEqual([[0, 999], [1000, 1999]])
  })

  it('orders sessions by id last so a page boundary cannot repeat or skip a row', async () => {
    const { client, readOf } = fakeSupabase({ timeclock_sessions: pageOf(sessionRows(1025)) })

    await loadHoursReportData(client, FIFTEEN_MONTHS)

    expect(readOf('timeclock_sessions').orders).toEqual(['work_date', 'clock_in_at', 'id'])
  })

  it('pages approved leave days the same way', async () => {
    const { client, readOf } = fakeSupabase({ leave_days: pageOf(leaveDayRows(1200)) })

    const data = await loadHoursReportData(client, FIFTEEN_MONTHS)

    expect(data.leaveDays).toHaveLength(1200)
    expect(readOf('leave_days').ranges).toEqual([[0, 999], [1000, 1999]])
    expect(readOf('leave_days').orders).toEqual(['leave_date', 'id'])
  })

  it('stops at one request when the range is short enough to fit', async () => {
    const { client, readOf } = fakeSupabase({ timeclock_sessions: pageOf(sessionRows(212)) })

    const data = await loadHoursReportData(client, { fromDate: '2026-06-29', toDate: '2026-09-20', today: '2026-09-16' })

    expect(data.sessions).toHaveLength(212)
    expect(readOf('timeclock_sessions').ranges).toEqual([[0, 999]])
  })

  it('throws when a page of sessions fails instead of reporting the hours short', async () => {
    const { client } = fakeSupabase({
      timeclock_sessions: () => ({ data: null, error: { message: 'connection reset' } }),
    })

    await expect(loadHoursReportData(client, FIFTEEN_MONTHS))
      .rejects.toThrow(/hours report timeclock sessions.*connection reset/)
  })

  it('throws when an unpaged read fails rather than showing an empty report', async () => {
    const { client } = fakeSupabase({
      employees: () => ({ data: null, error: { message: 'permission denied' } }),
    })

    await expect(loadHoursReportData(client, FIFTEEN_MONTHS))
      .rejects.toThrow(/hours report employees.*permission denied/)
  })

  it('hands each read back under its own name', async () => {
    const { client } = fakeSupabase({
      employees: () => ({ data: [{ employee_id: 'employee-1' }], error: null }),
      timeclock_sessions: pageOf(sessionRows(2)),
      leave_days: pageOf(leaveDayRows(3)),
      rota_shifts: () => ({ data: [{ id: 'shift-1' }], error: null }),
    })

    const data = await loadHoursReportData(client, FIFTEEN_MONTHS)

    expect(data.employees).toHaveLength(1)
    expect(data.sessions).toHaveLength(2)
    expect(data.leaveDays).toHaveLength(3)
    // Sick and planned shifts both read rota_shifts, so both see the same stub row.
    expect(data.sickShifts).toHaveLength(1)
    expect(data.plannedShifts).toHaveLength(1)
  })
})
