import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkUserPermission: vi.fn(),
  getUnfilledShiftCount: vi.fn(),
  adminFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.adminFrom }),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/rota-reassign', () => ({ getUnfilledShiftCount: mocks.getUnfilledShiftCount }))

import { buildRotaNavItems, getRotaNavItems } from '@/app/(authenticated)/rota/_shared/nav'
import { getTodayIsoDate } from '@/lib/dateUtils'

/** A PostgREST-style query that resolves to the given rows whatever filters are chained. */
function queryResolving(data: unknown[], error: { message: string } | null = null) {
  const result = { data, error }
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'gte', 'lte', 'in', 'eq', 'order']) query[method] = () => query
  query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
  return query
}

function grant(permissions: string[]) {
  mocks.checkUserPermission.mockImplementation(async (module: string, action: string) =>
    permissions.includes(`${module}:${action}`),
  )
}

const EVERY_TAB = ['rota:view', 'leave:view', 'timeclock:view', 'payroll:view', 'settings:manage']

describe('rota tab row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mocks.getUnfilledShiftCount.mockResolvedValue(0)
    mocks.adminFrom.mockImplementation(() => queryResolving([]))
  })

  it('shows every tab, in order, to somebody who can open them all', async () => {
    grant(EVERY_TAB)

    const items = await getRotaNavItems()

    expect(items.map(item => item.label)).toEqual([
      'Rota',
      'Reassign',
      'Hours by Employee',
      'Leave',
      'Timeclock',
      'Labour Costs',
      'Payroll',
      'Shift Templates',
      'Rota Settings',
    ])
  })

  it('hides each tab whose page would turn this user away', async () => {
    grant(['rota:view', 'leave:view'])

    const labels = (await getRotaNavItems()).map(item => item.label)

    expect(labels).toEqual(['Rota', 'Reassign', 'Leave', 'Labour Costs', 'Shift Templates'])
    // Hours by Employee needs timeclock access as well as rota access.
    expect(labels).not.toContain('Hours by Employee')
  })

  it('shows only the tabs a leave-only user can open, and runs no badge queries for them', async () => {
    grant(['leave:view'])

    const labels = (await getRotaNavItems()).map(item => item.label)

    expect(labels).toEqual(['Leave'])
    expect(mocks.getUnfilledShiftCount).not.toHaveBeenCalled()
    expect(mocks.adminFrom).not.toHaveBeenCalled()
  })

  it('badges Reassign with the shifts still needing somebody', async () => {
    grant(EVERY_TAB)
    mocks.getUnfilledShiftCount.mockResolvedValue(3)

    const items = await getRotaNavItems()

    expect(items.find(item => item.label === 'Reassign')?.badge).toBe(3)
    expect(items.find(item => item.label === 'Rota')?.badge).toBeUndefined()
  })

  it('badges Rota with the weeks from this one forwards that hold shifts staff cannot see yet', async () => {
    grant(EVERY_TAB)
    const today = getTodayIsoDate()
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === 'rota_shifts') {
        return queryResolving([{
          id: 'shift-1',
          employee_id: 'employee-1',
          shift_date: today,
          start_time: '12:00',
          end_time: '18:00',
          unpaid_break_minutes: 0,
          department: 'bar',
          status: 'scheduled',
          notes: null,
          is_overnight: false,
          is_open_shift: false,
          name: null,
          reassignment_reason: null,
        }])
      }
      return queryResolving([])
    })

    const items = await getRotaNavItems()

    expect(items.find(item => item.label === 'Rota')?.badge).toBe(1)
  })

  it('shows no badge, rather than failing the page, when a count cannot load', async () => {
    grant(EVERY_TAB)
    mocks.getUnfilledShiftCount.mockRejectedValue(new Error('database away'))
    mocks.adminFrom.mockImplementation(() => queryResolving([], { message: 'database away' }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const items = await getRotaNavItems()

    expect(items.every(item => item.badge === undefined)).toBe(true)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('gives nobody signed out any tabs', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    expect(await getRotaNavItems()).toEqual([])
    expect(mocks.checkUserPermission).not.toHaveBeenCalled()
  })

  it('keeps Rota Settings hidden unless the caller says it may show', () => {
    expect(buildRotaNavItems(0).map(item => item.label)).not.toContain('Rota Settings')
    expect(buildRotaNavItems(0, { canManageSettings: true }).map(item => item.label)).toContain('Rota Settings')
  })

  it('badges the Rota tab with the weeks still needing publishing', () => {
    const items = buildRotaNavItems(0, { weeksNeedingPublishing: 2 })

    expect(items.find(item => item.label === 'Rota')?.badge).toBe(2)
    expect(items.find(item => item.label === 'Reassign')?.badge).toBeUndefined()
  })
})
