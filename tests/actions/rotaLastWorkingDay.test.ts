// Someone on notice is gone once their last working day has passed, and cannot be given a shift
// after it. These run the real check (src/lib/rota/last-working-day-guard.ts) against fake
// clients: the rota write funnel, the portal's open-shift request, the portal's own-record
// lookup and the rota grid's list of people who can be given shifts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/rota/send-rota-emails', () => ({ sendRotaWeekEmails: vi.fn(), sendRotaWeekChangeEmails: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  acceptPortalShift,
  createShift,
  getActiveEmployeesForRota,
  moveShift,
  requestOpenShift,
} from '@/app/actions/rota'

type Result = { data: unknown; error: unknown }

/**
 * A thenable query chain: every filter returns the chain, and awaiting it (or calling
 * single/maybeSingle) resolves to the table's canned result.
 */
function chain(result: Result) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'is', 'not', 'or', 'limit', 'insert', 'update']) {
    query[method] = vi.fn(() => query)
  }
  query.single = vi.fn(async () => result)
  query.maybeSingle = vi.fn(async () => result)
  query.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return query
}

function fakeClient(tables: Record<string, Result>) {
  const queries: Record<string, ReturnType<typeof chain>[]> = {}
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'staff@example.com' } }, error: null }) },
    from: vi.fn((table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`)
      const query = chain(tables[table] as Result)
      ;(queries[table] ??= []).push(query)
      return query
    }),
    rpc: vi.fn().mockImplementation((_name: string, args: { p_shifts?: Array<{ ref: string }> }) =>
      Promise.resolve({
        data: { status: 'written', shifts: (args?.p_shifts ?? []).map(entry => ({ ref: entry.ref, shift_id: 'shift-new' })), conflicts: [], reason: null },
        error: null,
      }),
    ),
    queries,
  }
  return client
}

const EMPLOYEE_ID = '660e8400-e29b-41d4-a716-446655440000'
const SHIFT_ID = '550e8400-e29b-41d4-a716-446655440001'
const LAST_DAY = '2026-04-07'

const LEAVER = {
  employee_id: EMPLOYEE_ID,
  first_name: 'Samantha',
  last_name: 'Taylor',
  preferred_name: 'Sam',
  email_address: 'sam@example.com',
  status: 'Started Separation',
  employment_end_date: LAST_DAY,
}

const REFUSAL = 'Sam is leaving, with 7 April 2026 as their last working day, so they cannot be given a shift after it.'

function setToday(isoDate: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${isoDate}T12:00:00.000Z`))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkUserPermission).mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('manager writes to the rota', () => {
  const input = {
    weekId: '550e8400-e29b-41d4-a716-446655440000',
    employeeId: EMPLOYEE_ID,
    startTime: '09:00',
    endTime: '17:00',
    unpaidBreakMinutes: 30,
    department: 'bar',
    isOpenShift: false,
    isOvernight: false,
  }

  function rotaClient() {
    const client = fakeClient({
      rota_weeks: { data: { week_start: '2026-04-06' }, error: null },
      employees: { data: [LEAVER], error: null },
      rota_shifts: { data: { id: 'shift-new', employee_id: EMPLOYEE_ID, shift_date: LAST_DAY }, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(client as never)
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    return client
  }

  it('refuses to create a shift the day after the last working day, and writes nothing', async () => {
    const client = rotaClient()

    const result = await createShift({ ...input, shiftDate: '2026-04-08' })

    expect(result).toEqual({ success: false, error: REFUSAL })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('creates a shift on the last working day itself', async () => {
    const client = rotaClient()

    const result = await createShift({ ...input, shiftDate: LAST_DAY })

    expect(result.success).toBe(true)
    expect(client.rpc).toHaveBeenCalledWith('write_rota_shifts_with_leave_guard', expect.anything())
  })

  it('creates an open shift after the last working day without checking anybody', async () => {
    const client = rotaClient()

    const result = await createShift({ ...input, employeeId: undefined, isOpenShift: true, shiftDate: '2026-04-08' })

    expect(result.success).toBe(true)
    expect(client.queries.employees).toBeUndefined()
  })

  it('refuses to drag a shift onto the leaver on a day after their last working day', async () => {
    const client = fakeClient({
      rota_shifts: {
        data: { week_id: 'week-1', employee_id: null, shift_date: '2026-04-08', status: 'scheduled', start_time: '09:00', is_open_shift: true },
        error: null,
      },
      rota_weeks: { data: { week_start: '2026-04-06' }, error: null },
      employees: { data: [LEAVER], error: null },
    })
    vi.mocked(createClient).mockResolvedValue(client as never)
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    const result = await moveShift(SHIFT_ID, EMPLOYEE_ID, '2026-04-08')

    expect(result).toEqual({ success: false, error: REFUSAL })
    expect(client.rpc).not.toHaveBeenCalled()
  })
})

describe('the staff portal', () => {
  function portalClients(employee: Record<string, unknown>, shiftDate: string) {
    const session = fakeClient({ employees: { data: employee, error: null } })
    const admin = fakeClient({
      rota_published_shifts: {
        data: { id: SHIFT_ID, shift_date: shiftDate, start_time: '09:00', end_time: '17:00', department: 'bar', is_open_shift: true, status: 'scheduled' },
        error: null,
      },
      // A duplicate request: proves the request got past every check to the insert, without
      // needing the manager email that follows a real one.
      rota_open_shift_requests: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    vi.mocked(createClient).mockResolvedValue(session as never)
    vi.mocked(createAdminClient).mockReturnValue(admin as never)
    return { session, admin }
  }

  it('refuses an open-shift request for a day after the last working day', async () => {
    setToday('2026-04-01')
    const { admin } = portalClients(LEAVER, '2026-04-08')

    const result = await requestOpenShift({ shiftId: SHIFT_ID })

    expect(result).toEqual({
      success: false,
      error: 'Your last working day is 7 April 2026, so you cannot pick up a shift after it.',
    })
    expect(admin.queries.rota_open_shift_requests).toBeUndefined()
  })

  it('lets someone on notice request an open shift on their last working day', async () => {
    setToday('2026-04-01')
    const { admin } = portalClients(LEAVER, LAST_DAY)

    const result = await requestOpenShift({ shiftId: SHIFT_ID })

    expect(result).toEqual({ success: false, error: 'You have already requested this shift' })
    expect(admin.queries.rota_open_shift_requests).toHaveLength(1)
  })

  it('turns away someone whose last working day has passed, as it would a former employee', async () => {
    setToday('2026-04-08')
    const { admin } = portalClients(LEAVER, '2026-04-08')

    await expect(acceptPortalShift(SHIFT_ID)).resolves.toEqual({ success: false, error: 'Unauthorized' })
    await expect(requestOpenShift({ shiftId: SHIFT_ID })).resolves.toEqual({ success: false, error: 'Unauthorized' })
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('still lets them in on their last working day', async () => {
    setToday(LAST_DAY)
    const { admin } = portalClients(LEAVER, LAST_DAY)

    await requestOpenShift({ shiftId: SHIFT_ID })

    expect(admin.queries.rota_published_shifts).toHaveLength(1)
  })
})

describe('the rota grid list of people who can be given shifts', () => {
  const ADA = { employee_id: 'ada', first_name: 'Ada', last_name: 'Active', preferred_name: null, job_title: 'Bar', separation_shift_policy: null, status: 'Active', employment_end_date: null }
  const WILL = { employee_id: 'will', first_name: 'Will', last_name: 'Work', preferred_name: null, job_title: 'Bar', separation_shift_policy: 'work_remaining', status: 'Started Separation', employment_end_date: LAST_DAY }

  function gridClient() {
    const client = fakeClient({
      employees: { data: [ADA, WILL], error: null },
      employee_pay_settings: { data: [], error: null },
    })
    vi.mocked(createClient).mockResolvedValue(client as never)
    return client
  }

  it('keeps someone on notice on their last working day', async () => {
    setToday(LAST_DAY)
    gridClient()

    const result = await getActiveEmployeesForRota()

    expect(result.success && result.data.map(employee => employee.employee_id)).toEqual(['ada', 'will'])
  })

  it('drops them the day after', async () => {
    setToday('2026-04-08')
    gridClient()

    const result = await getActiveEmployeesForRota()

    expect(result.success && result.data.map(employee => employee.employee_id)).toEqual(['ada'])
  })
})
