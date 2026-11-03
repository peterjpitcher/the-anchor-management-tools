// A manager cannot approve an open-shift request that would put someone on notice on a shift
// after their last working day, from the reassignment queue or from the email link. The
// approval function itself checks only that they are Active or on notice.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rota', () => ({ moveShift: vi.fn() }))
vi.mock('@/lib/rota/open-shift-request-token', () => ({ verifyOpenShiftApprovalToken: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOpenShiftApprovalToken } from '@/lib/rota/open-shift-request-token'
import { approveOpenShiftVolunteer } from '@/app/actions/rota-reassign'
import { GET as approveFromEmail } from '@/app/api/rota/open-shift-requests/approve/route'

const LAST_DAY = '2026-11-07'
const SAM = { employee_id: 'sam', first_name: 'Sam', last_name: 'Taylor', preferred_name: null, status: 'Started Separation', employment_end_date: LAST_DAY }
const REFUSAL = 'Sam is leaving, with 7 November 2026 as their last working day, so they cannot be given a shift after it.'

function chain(result: { data: unknown; error: unknown }): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in']) query[method] = () => query
  query.maybeSingle = async () => result
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return query
}

function admin(shiftDate: string) {
  const rpc = vi.fn().mockResolvedValue({ data: [{ status: 'approved', week_start: '2026-11-02', reason: null }], error: null })
  vi.mocked(createAdminClient).mockReturnValue({
    from: (table: string) => {
      if (table === 'rota_open_shift_requests') return chain({ data: { id: 'req-1', shift_id: 'shift-1', employee_id: 'sam', status: 'pending' }, error: null })
      if (table === 'rota_shifts') return chain({ data: { id: 'shift-1', shift_date: shiftDate, start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0, department: 'bar', is_overnight: false, name: null }, error: null })
      if (table === 'employees') return chain({ data: [SAM], error: null })
      throw new Error(`Unexpected table ${table}`)
    },
    rpc,
  } as never)
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'manager-1', email: 'billy@example.com' } } }) },
  } as never)
})

describe('approving from the reassignment queue', () => {
  it('approves a shift on the last working day', async () => {
    const rpc = admin(LAST_DAY)

    await expect(approveOpenShiftVolunteer('req-1')).resolves.toEqual({ success: true, weekStart: '2026-11-02' })
    expect(rpc).toHaveBeenCalledWith('approve_rota_open_shift_request', expect.anything())
  })

  it('refuses a shift the day after, and approves nothing', async () => {
    const rpc = admin('2026-11-08')

    await expect(approveOpenShiftVolunteer('req-1')).resolves.toEqual({ success: false, error: REFUSAL })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('approving from the email link', () => {
  function link(shiftDate: string) {
    vi.mocked(verifyOpenShiftApprovalToken).mockReturnValue({
      v: 1,
      requestId: 'req-1',
      shiftId: 'shift-1',
      employeeId: 'sam',
      requestedAt: '2026-11-01T09:00:00.000Z',
      expected: { shiftDate, startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 0, department: 'bar', isOvernight: false, name: null },
    } as never)
    return new NextRequest('http://localhost/api/rota/open-shift-requests/approve?token=t')
  }

  it('approves a shift on the last working day', async () => {
    const rpc = admin(LAST_DAY)

    const response = await approveFromEmail(link(LAST_DAY))

    expect(new URL(response.headers.get('location') as string).searchParams.get('openShiftRequest')).toBe('approved')
    expect(rpc).toHaveBeenCalled()
  })

  it('refuses a shift the day after as a stale approval, and approves nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rpc = admin('2026-11-08')

    const response = await approveFromEmail(link('2026-11-08'))

    expect(new URL(response.headers.get('location') as string).searchParams.get('openShiftRequest')).toBe('stale')
    expect(rpc).not.toHaveBeenCalled()
  })
})
