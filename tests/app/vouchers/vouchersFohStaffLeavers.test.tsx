// The vouchers screen's staff picker lists someone on notice up to and including their last
// working day, and not after it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const state = vi.hoisted(() => ({ employees: [] as Record<string, unknown>[] }))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ getUserPermissions: vi.fn().mockResolvedValue({ success: true, data: [] }) }))
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohVoucherPermission: vi.fn().mockResolvedValue({ ok: true }),
  getLondonDateIso: () => '2026-11-08',
}))
vi.mock('@/lib/foh/user-mode', () => ({ isFohOnlyUser: () => false }))
vi.mock('@/app/actions/timeclock', () => ({ getOpenSessions: vi.fn().mockResolvedValue({ success: true, data: [] }) }))
vi.mock('@/app/(authenticated)/vouchers/foh/VouchersFohClient', () => ({ VouchersFohClient: () => null }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'in', 'order']) query[method] = () => query
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: state.employees, error: null }).then(resolve)
      return query
    },
  }),
}))

import VouchersFohPage from '@/app/(authenticated)/vouchers/foh/page'

const ADA = { employee_id: 'ada', first_name: 'Ada', last_name: 'Active', preferred_name: null, status: 'Active', employment_end_date: null }
const SAM = { employee_id: 'sam', first_name: 'Sam', last_name: 'Taylor', preferred_name: null, status: 'Started Separation', employment_end_date: '2026-11-07' }

async function staffIds(): Promise<string[]> {
  const page = (await VouchersFohPage()) as ReactElement<{ children: ReactElement<{ staff: Array<{ id: string }> }> }>
  return page.props.children.props.staff.map((member) => member.id)
}

beforeEach(() => {
  state.employees = [ADA, SAM]
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the vouchers staff picker', () => {
  it('lists someone on notice on their last working day', async () => {
    vi.setSystemTime(new Date('2026-11-07T20:00:00.000Z'))
    expect(await staffIds()).toEqual(['ada', 'sam'])
  })

  it('leaves them out the day after', async () => {
    vi.setSystemTime(new Date('2026-11-08T00:30:00.000Z'))
    expect(await staffIds()).toEqual(['ada'])
  })
})
