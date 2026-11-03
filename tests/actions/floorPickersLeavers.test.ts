// Floor pickers and the voucher actor: someone on notice can be named up to and including their
// last working day, and not after it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ employees: [] as Record<string, unknown>[] }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/app/actions/timeclock', () => ({ getOpenSessions: vi.fn().mockResolvedValue({ success: true, data: [] }) }))
vi.mock('@/lib/checklists/settings', () => ({ currentBusinessDate: vi.fn(), getChecklistSettings: vi.fn() }))
vi.mock('@/lib/checklists/rota', () => ({ getPublishedShiftsForDate: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'employees') throw new Error(`Unexpected table ${table}`)
      const result = { data: state.employees, error: null }
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'in', 'order']) query[method] = () => query
      // The voucher actor reads one row by id.
      query.eq = (_column: string, value: unknown) => {
        const row = state.employees.find((employee) => employee.employee_id === value) ?? null
        return { in: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }
      }
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return query
    },
  }),
}))

import { getAttributionCandidates } from '@/app/actions/checklists'
import { getActiveEmployee } from '@/app/api/foh/vouchers/shared'
import { createAdminClient } from '@/lib/supabase/admin'

const LAST_DAY = '2026-11-07'
const ADA = { employee_id: 'ada', first_name: 'Ada', last_name: 'Active', preferred_name: null, status: 'Active', employment_end_date: null }
const SAM = { employee_id: 'sam', first_name: 'Sam', last_name: 'Taylor', preferred_name: null, status: 'Started Separation', employment_end_date: LAST_DAY }

beforeEach(() => {
  state.employees = [ADA, SAM]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('who completed a checklist', () => {
  it('lists someone on notice for checks on their last working day, even after midnight', async () => {
    // The business date is the checklist's own date: a late close runs past midnight.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-08T00:30:00.000Z'))

    const result = await getAttributionCandidates({ date: LAST_DAY, department: 'bar' })

    expect(result.data?.map((candidate) => candidate.employeeId).sort()).toEqual(['ada', 'sam'])
  })

  it('leaves them out of checks for any day after it', async () => {
    const result = await getAttributionCandidates({ date: '2026-11-08', department: 'bar' })

    expect(result.data?.map((candidate) => candidate.employeeId)).toEqual(['ada'])
  })
})

describe('who handed out or took a voucher', () => {
  it('accepts someone on notice on their last working day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${LAST_DAY}T20:00:00.000Z`))

    await expect(getActiveEmployee(createAdminClient() as never, 'sam')).resolves.toEqual({ id: 'sam', name: 'Sam' })
  })

  it('refuses them the day after, as a former employee is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-08T00:30:00.000Z'))

    await expect(getActiveEmployee(createAdminClient() as never, 'sam')).resolves.toBeNull()
    await expect(getActiveEmployee(createAdminClient() as never, 'ada')).resolves.toEqual({ id: 'ada', name: 'Ada' })
  })
})
