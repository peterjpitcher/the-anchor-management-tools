// Holiday self-service on the staff portal ends with the last working day: someone on notice can
// see and cancel their own requests on that day, and is turned away the day after, as a former
// employee is.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { cancelOwnLeaveRequest, getLeaveRequests } from '@/app/actions/leave'

const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333'
const REQUEST_ID = '44444444-4444-4444-8444-444444444444'
const ON_NOTICE = { employee_id: EMPLOYEE_ID, status: 'Started Separation', employment_end_date: '2026-11-07' }

type Result = { data: unknown; error: unknown }

function query(result: Result): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'delete']) chain[method] = () => chain
  chain.maybeSingle = () => Promise.resolve(result)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

function session() {
  const from = vi.fn((table: string) => {
    if (table === 'employees') return query({ data: ON_NOTICE, error: null })
    if (table === 'leave_requests') return query({ data: [], error: null })
    throw new Error(`Unexpected table: ${table}`)
  })
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from,
  } as never)
  return from
}

function setLondonNow(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

beforeEach(() => {
  vi.clearAllMocks()
  // Staff using the portal have no leave permission: they get in as themselves or not at all.
  vi.mocked(checkUserPermission).mockResolvedValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('holiday self-service for someone on notice', () => {
  it('shows their own requests on their last working day', async () => {
    setLondonNow('2026-11-07T20:00:00.000Z')
    session()

    await expect(getLeaveRequests({ employeeId: EMPLOYEE_ID })).resolves.toEqual({ success: true, data: [] })
  })

  it('turns them away the day after', async () => {
    setLondonNow('2026-11-08T00:30:00.000Z')
    const from = session()

    await expect(getLeaveRequests({ employeeId: EMPLOYEE_ID })).resolves.toEqual({ success: false, error: 'Permission denied' })
    expect(from).not.toHaveBeenCalledWith('leave_requests')
  })

  it('refuses to cancel a request the day after, without touching it', async () => {
    setLondonNow('2026-11-08T00:30:00.000Z')
    const from = session()

    await expect(cancelOwnLeaveRequest(REQUEST_ID)).resolves.toEqual({
      success: false,
      error: 'Your account is not linked to an active employee profile',
    })
    expect(from).not.toHaveBeenCalledWith('leave_requests')
  })
})
