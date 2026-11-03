// The kiosk: someone on notice cannot clock in once their last working day has passed, but can
// still clock out, so a shift from their last working day can finish after midnight.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { clockIn, clockOut } from '@/app/actions/timeclock'

const LAST_DAY = '2026-11-07'

const LEAVER = {
  employee_id: 'emp-1',
  status: 'Started Separation',
  employment_end_date: LAST_DAY,
  mobile_number: '07700901234',
  timeclock_pin_hash: null,
}

function setLondonNow(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

/** The employee row, and an open session (or none) for the double clock-in and clock-out reads. */
function kiosk(openSession: { id: string; work_date: string } | null) {
  const sessionReads = vi.fn()
  const updatedSession = { id: 'session-1', employee_id: 'emp-1', clock_in_at: `${LAST_DAY}T18:00:00Z` }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'employees') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: LEAVER, error: null }) }) }) }
      }
      if (table === 'timeclock_sessions') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    sessionReads()
                    return { data: openSession, error: null }
                  },
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({ is: () => ({ select: () => ({ maybeSingle: async () => ({ data: updatedSession, error: null }) }) }) }),
          }),
        }
      }
      if (table === 'payroll_periods') {
        return { select: () => ({ lte: () => ({ gte: async () => ({ data: [], error: null }) }) }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(client as never)
  return { sessionReads }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('clockIn for someone on notice', () => {
  it('lets them clock in on their last working day', async () => {
    setLondonNow(`${LAST_DAY}T17:00:00.000Z`)
    const { sessionReads } = kiosk({ id: 'session-existing', work_date: LAST_DAY })

    const result = await clockIn('emp-1', '1234')

    // Reaching the double clock-in check proves the last working day did not refuse them.
    expect(result).toEqual({ success: false, error: 'Already clocked in. Please clock out first.' })
    expect(sessionReads).toHaveBeenCalledTimes(1)
  })

  it('refuses the day after, with the same words as for a former employee', async () => {
    // 00:30 on 8 November in London (GMT).
    setLondonNow('2026-11-08T00:30:00.000Z')
    const { sessionReads } = kiosk(null)

    const result = await clockIn('emp-1', '1234')

    expect(result).toEqual({ success: false, error: 'Employee is not active' })
    expect(sessionReads).not.toHaveBeenCalled()
  })
})

describe('clockOut for someone on notice', () => {
  it('lets them clock out after midnight from a shift on their last working day', async () => {
    setLondonNow('2026-11-08T00:30:00.000Z')
    kiosk({ id: 'session-1', work_date: LAST_DAY })

    const result = await clockOut('emp-1', '1234')

    expect(result.success).toBe(true)
  })
})
