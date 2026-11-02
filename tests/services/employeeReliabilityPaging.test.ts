// Reliability reads, notice days and failed reads, over a recording Supabase mock.
//
// FF-49: the leaderboard read its 90-day window in one request (417 rows on 2 November 2026) and an
// employee's all-time record stopped at 1,000 rows; Supabase cuts a result off at 1,000 with no
// error, so scores would drift quietly. FF-46: a failed read on the employee page was shown as an
// empty record. FF-58: notice days were counted from the UTC date of the request, a day long for a
// holiday asked for between 00:00 and 00:59 BST.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adminFromMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import {
  getEmployeeReliabilityData,
  getTeamReliabilityLeaderboard,
  recordHolidayReliabilityEvents,
} from '@/services/employee-reliability'
import { clearLeaveTypeCache } from '@/lib/leave/leave-types'

type Call = { method: string; args: unknown[] }
type Result = { data: unknown; error: { message: string } | null }

function recordingTables(resolve: (table: string, calls: Call[]) => Result) {
  const queries: Array<{ table: string; calls: Call[] }> = []
  adminFromMock.mockImplementation((table: string) => {
    const calls: Call[] = []
    queries.push({ table, calls })
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'in', 'eq', 'gte', 'order', 'range', 'limit']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
    }
    builder.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve(table, calls)).then(onFulfilled, onRejected)
    return builder
  })
  return queries
}

function argsOf(calls: Call[], method: string): unknown[][] {
  return calls.filter((call) => call.method === method).map((call) => call.args)
}

function pageOf<T>(rows: T[], calls: Call[]): Result {
  const [from, to] = argsOf(calls, 'range')[0] as [number, number]
  return { data: rows.slice(from, to + 1), error: null }
}

const SAM = '00000000-0000-4000-8000-000000000001'
const JO = '00000000-0000-4000-8000-000000000002'
const LEFT_LONG_AGO = '00000000-0000-4000-8000-000000000009'

function employee(id: string, firstName: string) {
  return { employee_id: id, first_name: firstName, last_name: 'Rowe', preferred_name: null, email_address: `${firstName}@example.com`, job_title: 'Bar Staff', status: 'Active' }
}

function reliabilityEvent(index: number, employeeId: string, eventType = 'shift_accepted') {
  return {
    id: `event-${String(index).padStart(5, '0')}`,
    employee_id: employeeId,
    event_type: eventType,
    event_at: new Date(Date.UTC(2026, 9, 31, 12) - index * 60_000).toISOString(),
    source: 'test',
    idempotency_key: `key-${index}`,
    impacted_shift_count: 0,
    score_eligible: true,
    published_at: null,
    created_at: '2026-10-31T12:00:00Z',
  }
}

beforeEach(() => {
  clearLeaveTypeCache()
  adminFromMock.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the leaderboard reads every event in the window (FF-49)', () => {
  it('pages past 1,000 events, in a stable order, and matches them to people in memory', async () => {
    // 1,500 events: 1,200 manual accepts for Sam, 299 rejections for Jo, and one for someone not
    // on the leaderboard (they left), which must not be scored against anyone.
    const events = [
      ...Array.from({ length: 1200 }, (_, index) => reliabilityEvent(index, SAM)),
      ...Array.from({ length: 299 }, (_, index) => reliabilityEvent(1200 + index, JO, 'shift_rejected')),
      reliabilityEvent(1499, LEFT_LONG_AGO, 'couldnt_work'),
    ]
    const queries = recordingTables((table, calls) => {
      if (table === 'employees') return pageOf([employee(SAM, 'Sam'), employee(JO, 'Jo')], calls)
      if (table === 'employee_reliability_events') return pageOf(events, calls)
      throw new Error(`Unexpected table ${table}`)
    })

    const rows = await getTeamReliabilityLeaderboard()

    const eventReads = queries.filter((query) => query.table === 'employee_reliability_events')
    expect(eventReads.map((query) => argsOf(query.calls, 'range')[0])).toEqual([[0, 999], [1000, 1999]])
    expect(argsOf(eventReads[0].calls, 'order')).toEqual([
      ['event_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    // No list of every employee id in the request; the window is the only filter.
    expect(argsOf(eventReads[0].calls, 'in')).toEqual([])
    expect(argsOf(eventReads[0].calls, 'gte')).toHaveLength(1)

    const byName = Object.fromEntries(rows.map((row) => [row.employeeName, row.recent.counts]))
    expect(byName.Sam.manualAccepts).toBe(1200)
    expect(byName.Jo.rejections).toBe(299)
    expect(byName.Sam.couldntWork + byName.Jo.couldntWork).toBe(0)

    // The employees read is paged too, with the id as the final sort key.
    const employeeRead = queries.find((query) => query.table === 'employees')!
    expect(argsOf(employeeRead.calls, 'order').map((args) => args[0])).toEqual(['last_name', 'first_name', 'employee_id'])
  })
})

describe("an employee's record (FF-49, FF-46)", () => {
  it('scores the whole all-time record, past 1,000 events, newest first', async () => {
    const events = Array.from({ length: 1200 }, (_, index) => reliabilityEvent(index, SAM))
    const queries = recordingTables((table, calls) => {
      if (table === 'employee_reliability_events') return pageOf(events, calls)
      throw new Error(`Unexpected table ${table}`)
    })

    const data = await getEmployeeReliabilityData(SAM)

    expect(data.loadError).toBeNull()
    expect(data.allTime.counts.manualAccepts).toBe(1200)
    expect(data.events).toHaveLength(150)
    expect(data.events[0].id).toBe('event-00000')
    const read = queries[0]
    expect(argsOf(read.calls, 'eq')).toEqual([['employee_id', SAM]])
    expect(argsOf(read.calls, 'limit')).toEqual([])
  })

  it('says the read failed instead of showing an empty record', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    recordingTables(() => ({ data: null, error: { message: 'statement timeout' } }))

    const data = await getEmployeeReliabilityData(SAM)

    expect(data.loadError).toBe('Could not load the reliability events.')
    expect(data.events).toEqual([])
    expect(consoleError).toHaveBeenCalledWith(
      '[employeeReliability] failed to fetch events',
      expect.objectContaining({ message: expect.stringContaining('statement timeout') }),
    )
    consoleError.mockRestore()
  })
})

describe('holiday notice is counted in London days (FF-58)', () => {
  it('counts a request made at 00:30 BST from that London date', async () => {
    const upserts: Array<Record<string, unknown>> = []
    const supabase = {
      from: (table: string) => ({
        upsert: (payload: Record<string, unknown>) => {
          upserts.push({ table, ...payload })
          return Promise.resolve({ error: null })
        },
        insert: () => Promise.resolve({ error: null }),
        // The recorder reads the leave types to decide whether late notice counts.
        select: () => Promise.resolve({ data: [{ code: 'holiday', counts_in_reliability: true }], error: null }),
      }),
    }

    // 23:30 UTC on 30 September is 00:30 BST on 1 October. The holiday starts 15 October, so the
    // notice is 14 days: late. Counted from the UTC date it was 15 days, and not flagged.
    await recordHolidayReliabilityEvents({
      leave: {
        id: 'leave-1',
        employee_id: SAM,
        start_date: '2026-10-15',
        end_date: '2026-10-16',
        status: 'approved',
        created_at: '2026-09-30T23:30:00Z',
        reviewed_at: '2026-10-01T09:00:00Z',
        leave_type: 'holiday',
      },
      source: 'test',
      includeLate: true,
      supabase,
    })

    const late = upserts.find((row) => row.event_type === 'late_holiday')
    expect(late).toBeDefined()
    expect(late?.notice_days).toBe(14)
    expect(late?.score_eligible).toBe(true)
  })
})
