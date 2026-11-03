// Reliability scoring and the type of leave behind a leave event.
//
// leave_types.counts_in_reliability is false for 'unavailable' (days someone cannot work, which
// are not holiday), and migration 20260819050000 exempts time off agreed at hire
// (leave_requests.leave_origin) from late notice and clash scoring. The recorder checked neither,
// and the score read never looked: in production one 'unavailable' request carried a scored
// late_holiday and a scored holiday_conflict, which lowered that person's score. Both ends are
// covered here: new events are recorded as information only, and existing ones stop counting
// without a data change. A failed read of the leave types or requests is a load error, never a
// score worked out without the rules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adminFromMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import {
  getEmployeeReliabilityData,
  getTeamReliabilityLeaderboard,
  recordHolidayReliabilityEvents,
  RELIABILITY_LEADERBOARD_LOAD_ERROR,
  type ReliabilityLeaveSnapshot,
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
const HOLIDAY_REQUEST = '10000000-0000-4000-8000-000000000001'
const CANNOT_WORK_REQUEST = '10000000-0000-4000-8000-000000000002'
const AT_HIRE_REQUEST = '10000000-0000-4000-8000-000000000003'
const DELETED_REQUEST = '10000000-0000-4000-8000-000000000004'

const LEAVE_TYPES = [
  { code: 'holiday', counts_in_reliability: true },
  { code: 'unavailable', counts_in_reliability: false },
]

const LEAVE_REQUESTS = [
  { id: HOLIDAY_REQUEST, leave_type: 'holiday', leave_origin: 'normal_request' },
  { id: CANNOT_WORK_REQUEST, leave_type: 'unavailable', leave_origin: 'normal_request' },
  { id: AT_HIRE_REQUEST, leave_type: 'holiday', leave_origin: 'agreed_at_hire' },
]

const TIMEOUT = { message: 'statement timeout' }

let sequence = 0
function reliabilityEvent(eventType: string, overrides: Record<string, unknown> = {}) {
  sequence += 1
  return {
    id: `event-${String(sequence).padStart(5, '0')}`,
    employee_id: SAM,
    event_type: eventType,
    event_at: new Date(Date.UTC(2026, 9, 31, 12) - sequence * 60_000).toISOString(),
    source: 'test',
    idempotency_key: `key-${sequence}`,
    impacted_shift_count: 0,
    score_eligible: true,
    published_at: null,
    leave_request_id: null,
    created_at: '2026-10-31T12:00:00Z',
    ...overrides,
  }
}

/** Five accepted shifts, so the score is ranked and only the leave events move it. */
function acceptedShifts() {
  return Array.from({ length: 5 }, () => reliabilityEvent('shift_accepted', { published_at: '2026-10-31T00:00:00Z' }))
}

function employee() {
  return { employee_id: SAM, first_name: 'Sam', last_name: 'Rowe', preferred_name: null, email_address: 'sam@example.com', job_title: 'Bar Staff', status: 'Active' }
}

/** Tables for a good load, with any of them overridden. */
function tables(events: unknown[], overrides: Partial<Record<string, Result>> = {}) {
  return recordingTables((table, calls) => {
    if (overrides[table]) return overrides[table] as Result
    if (table === 'employees') return pageOf([employee()], calls)
    if (table === 'employee_reliability_events') return pageOf(events, calls)
    if (table === 'leave_types') return { data: LEAVE_TYPES, error: null }
    if (table === 'leave_requests') {
      const ids = (argsOf(calls, 'in')[0]?.[1] ?? []) as string[]
      return { data: LEAVE_REQUESTS.filter((row) => ids.includes(row.id)), error: null }
    }
    throw new Error(`Unexpected table ${table}`)
  })
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  clearLeaveTypeCache()
  adminFromMock.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'))
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  consoleError.mockRestore()
})

describe('the score ignores leave events that do not count', () => {
  it("takes the penalties off a cannot-work request's late holiday and rota clash on the leaderboard", async () => {
    const queries = tables([
      ...acceptedShifts(),
      reliabilityEvent('late_holiday', { leave_request_id: CANNOT_WORK_REQUEST, notice_days: 3 }),
      reliabilityEvent('holiday_conflict', { leave_request_id: CANNOT_WORK_REQUEST, impacted_shift_count: 1 }),
    ])

    const [row] = await getTeamReliabilityLeaderboard()

    expect(row.recent.counts.lateHolidays).toBe(0)
    expect(row.recent.counts.holidayConflicts).toBe(0)
    expect(row.recent.components.holidayNoticeImpact).toBe(10)
    expect(row.recent.score).toBe(100)
    // The type comes from leave_types, and only the requests behind those events are read.
    expect(queries.some((query) => query.table === 'leave_types')).toBe(true)
    const requestRead = queries.find((query) => query.table === 'leave_requests')!
    expect(argsOf(requestRead.calls, 'in')).toEqual([['id', [CANNOT_WORK_REQUEST]]])
  })

  it('takes the penalty off late notice on time off agreed at hire', async () => {
    tables([
      ...acceptedShifts(),
      reliabilityEvent('late_holiday', { leave_request_id: AT_HIRE_REQUEST, notice_days: 3 }),
    ])

    const [row] = await getTeamReliabilityLeaderboard()

    expect(row.recent.counts.lateHolidays).toBe(0)
    expect(row.recent.score).toBe(100)
  })

  it('still penalises a late holiday, and one whose request has been deleted', async () => {
    tables([
      ...acceptedShifts(),
      reliabilityEvent('late_holiday', { leave_request_id: HOLIDAY_REQUEST, notice_days: 3 }),
      reliabilityEvent('late_holiday', { leave_request_id: DELETED_REQUEST, notice_days: 3 }),
    ])

    const [row] = await getTeamReliabilityLeaderboard()

    expect(row.recent.counts.lateHolidays).toBe(2)
    expect(row.recent.components.holidayNoticeImpact).toBe(2)
  })

  it('reads no leave tables when there is no leave event to check', async () => {
    const queries = tables(acceptedShifts())

    await getTeamReliabilityLeaderboard()

    expect(queries.map((query) => query.table).sort()).toEqual(['employee_reliability_events', 'employees'])
  })

  it("does the same on the employee's own Reliability tab, and keeps the event in the list", async () => {
    tables([
      ...acceptedShifts(),
      reliabilityEvent('late_holiday', { leave_request_id: CANNOT_WORK_REQUEST, notice_days: 3 }),
    ])

    const data = await getEmployeeReliabilityData(SAM)

    expect(data.loadError).toBeNull()
    expect(data.allTime.counts.lateHolidays).toBe(0)
    expect(data.recent.score).toBe(100)
    const late = data.events.find((event) => event.event_type === 'late_holiday')
    expect(late?.score_eligible).toBe(false)
  })
})

describe('a failed read of the leave rules is a load error, not a score without them', () => {
  const events = () => [
    ...acceptedShifts(),
    reliabilityEvent('late_holiday', { leave_request_id: CANNOT_WORK_REQUEST, notice_days: 3 }),
  ]

  it('the leaderboard throws its load error when leave_types cannot be read', async () => {
    tables(events(), { leave_types: { data: null, error: TIMEOUT } })

    await expect(getTeamReliabilityLeaderboard()).rejects.toThrow(RELIABILITY_LEADERBOARD_LOAD_ERROR)
    expect(consoleError).toHaveBeenCalledWith('[employeeReliability] failed to read leave types for scoring', TIMEOUT)
  })

  it('the leaderboard throws its load error when the leave requests cannot be read', async () => {
    tables(events(), { leave_requests: { data: null, error: TIMEOUT } })

    await expect(getTeamReliabilityLeaderboard()).rejects.toThrow(RELIABILITY_LEADERBOARD_LOAD_ERROR)
    expect(consoleError).toHaveBeenCalledWith('[employeeReliability] failed to read leave requests for scoring', TIMEOUT)
  })

  it('an empty leave_types answer counts as a failed read', async () => {
    tables(events(), { leave_types: { data: [], error: null } })

    await expect(getTeamReliabilityLeaderboard()).rejects.toThrow(RELIABILITY_LEADERBOARD_LOAD_ERROR)
  })

  it("the employee's tab shows its load error rather than a score", async () => {
    tables(events(), { leave_types: { data: null, error: TIMEOUT } })

    const data = await getEmployeeReliabilityData(SAM)

    expect(data.loadError).toBe('Could not load the reliability events.')
    expect(data.events).toEqual([])
  })
})

describe('recording late notice', () => {
  function recorder(leaveTypes: Result | (() => never)) {
    const upserts: Array<Record<string, unknown>> = []
    const supabase = {
      from: (table: string) => ({
        upsert: (payload: Record<string, unknown>) => {
          upserts.push({ table, ...payload })
          return Promise.resolve({ error: null })
        },
        insert: () => Promise.resolve({ error: null }),
        select: () => (typeof leaveTypes === 'function' ? leaveTypes() : Promise.resolve(leaveTypes)),
      }),
    }
    return { upserts, supabase }
  }

  // Requested 1 October for 5 October: four days' notice, so late.
  const lateLeave = {
    id: 'leave-1',
    employee_id: SAM,
    start_date: '2026-10-05',
    end_date: '2026-10-06',
    status: 'approved',
    created_at: '2026-10-01T09:00:00Z',
    reviewed_at: '2026-10-01T10:00:00Z',
  }

  async function lateEvent(leave: Partial<ReliabilityLeaveSnapshot>, leaveTypes: Result | (() => never) = { data: LEAVE_TYPES, error: null }) {
    const { upserts, supabase } = recorder(leaveTypes)
    await recordHolidayReliabilityEvents({
      leave: { ...lateLeave, ...leave },
      source: 'test',
      includeApproved: true,
      includeLate: true,
      supabase,
    })
    return upserts.find((row) => row.event_type === 'late_holiday')
  }

  it('records late notice on a holiday as scored', async () => {
    const late = await lateEvent({ leave_type: 'holiday', leave_origin: 'normal_request' })

    expect(late?.score_eligible).toBe(true)
  })

  it('records late notice on days someone cannot work as information only', async () => {
    const late = await lateEvent({ leave_type: 'unavailable', leave_origin: 'normal_request' })

    expect(late).toBeDefined()
    expect(late?.score_eligible).toBe(false)
    expect(late?.metadata).toEqual(expect.objectContaining({ leave_type: 'unavailable', leave_origin: 'normal_request' }))
  })

  it('records late notice on time off agreed at hire as information only', async () => {
    const late = await lateEvent({ leave_type: 'holiday', leave_origin: 'agreed_at_hire' })

    expect(late?.score_eligible).toBe(false)
  })

  it('treats a request with no type as a holiday, the column default', async () => {
    const late = await lateEvent({})

    expect(late?.score_eligible).toBe(true)
  })

  it('uses the seeded types when leave_types cannot be read', async () => {
    const late = await lateEvent({ leave_type: 'unavailable' }, { data: null, error: TIMEOUT })

    expect(late?.score_eligible).toBe(false)
  })

  it('records it as scored, and logs, when the leave type lookup throws', async () => {
    const boom = new Error('socket hang up')
    const late = await lateEvent({ leave_type: 'unavailable' }, () => { throw boom })

    // The score read checks it again against leave_types, so this can only be corrected later.
    expect(late?.score_eligible).toBe(true)
    expect(consoleError).toHaveBeenCalledWith('[employeeReliability] failed to read leave types for a late holiday', boom)
  })

  it('keeps the requested and approved events as information only', async () => {
    const { upserts, supabase } = recorder({ data: LEAVE_TYPES, error: null })
    await recordHolidayReliabilityEvents({
      leave: { ...lateLeave, leave_type: 'holiday' },
      source: 'test',
      includeRequested: true,
      includeApproved: true,
      supabase,
    })

    expect(upserts.map((row) => [row.event_type, row.score_eligible])).toEqual([
      ['holiday_requested', false],
      ['holiday_approved', false],
    ])
  })
})
