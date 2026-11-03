// The staff portal pages close once the last working day of someone on notice has passed, and say
// why, instead of telling them their account is not linked to an employee profile.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const state = vi.hoisted(() => ({ employee: null as Record<string, unknown> | null }))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in']) query[method] = () => query
      query.single = async () => ({ data: state.employee, error: null })
      return query
    },
  }),
}))
// Nothing past the employee check may run for someone who has left.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('the page went past the employee check')
  },
}))
vi.mock('@/app/actions/leave', () => ({
  getLeaveRequests: vi.fn(() => {
    throw new Error('the page went past the employee check')
  }),
  getHolidayUsage: vi.fn(),
}))
vi.mock('@/app/actions/rota-settings', () => ({
  getRotaSettings: vi.fn(() => {
    throw new Error('the page went past the employee check')
  }),
}))

import MyShiftsPage from '@/app/(staff-portal)/portal/shifts/page'
import MyLeavePage from '@/app/(staff-portal)/portal/leave/page'
import NewLeaveRequestPage from '@/app/(staff-portal)/portal/leave/new/page'

const ON_NOTICE = { employee_id: 'sam', first_name: 'Sam', last_name: 'Taylor', preferred_name: null, status: 'Started Separation', employment_end_date: '2026-11-07' }
const CLOSED = 'Your last working day was 7 November 2026, so the staff portal is now closed to you.'

function setLondonNow(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

beforeEach(() => {
  state.employee = ON_NOTICE
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the staff portal the day after the last working day', () => {
  beforeEach(() => {
    setLondonNow('2026-11-08T00:30:00.000Z')
  })

  it('closes My Shifts and says why', async () => {
    const html = renderToStaticMarkup(await MyShiftsPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain(CLOSED)
    expect(html).not.toContain('not linked to an employee profile')
  })

  it('closes My Holiday and says why', async () => {
    const html = renderToStaticMarkup(await MyLeavePage())
    expect(html).toContain(CLOSED)
  })

  it('sends Request Holiday back to My Holiday', async () => {
    await expect(NewLeaveRequestPage()).rejects.toThrow('redirect:/portal/leave')
  })
})

describe('the staff portal on the last working day', () => {
  beforeEach(() => {
    setLondonNow('2026-11-07T20:00:00.000Z')
  })

  it('opens My Holiday as usual', async () => {
    // Reaching the holiday settings read proves the page went past the employee check.
    await expect(MyLeavePage()).rejects.toThrow('the page went past the employee check')
  })

  it('opens Request Holiday as usual', async () => {
    const page = await NewLeaveRequestPage()
    expect(page).toBeTruthy()
  })
})

describe('someone with no linked record', () => {
  it('is still told their account is not linked', async () => {
    state.employee = null
    const html = renderToStaticMarkup(await MyShiftsPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Your account is not linked to an employee profile. Please contact your manager.')
  })
})
