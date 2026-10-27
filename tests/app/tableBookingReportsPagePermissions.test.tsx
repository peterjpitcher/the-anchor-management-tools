// BK-120: the bookings report lists guests and their bookings, so it needs table bookings access
// as well as reports access. It computed canViewTableBookings and never used it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ granted: new Set<string>() }))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/table-bookings/reports',
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async (module: string, action: string) => state.granted.has(`${module}:${action}`)),
  getUserPermissions: vi.fn(async () => ({ success: true, data: [] })),
}))
vi.mock('@/lib/analytics/table-booking-reports', () => ({
  loadTableBookingReportsSnapshot: vi.fn(async () => {
    throw new Error('the report must not load for this login')
  }),
  resolveTableBookingReportsWindow: () => 'week',
}))
vi.mock('@/components/charts/BarChart', () => ({ BarChart: () => null }))

import TableBookingReportsPage from '@/app/(authenticated)/table-bookings/reports/page'
import { loadTableBookingReportsSnapshot } from '@/lib/analytics/table-booking-reports'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('table booking reports page access (BK-120)', () => {
  it('turns away a login with reports access but no table bookings access', async () => {
    state.granted = new Set(['reports:view'])
    await expect(TableBookingReportsPage({})).rejects.toThrow('NEXT_REDIRECT /unauthorized')
    expect(loadTableBookingReportsSnapshot).not.toHaveBeenCalled()
  })

  it('turns away a login with table bookings access but no reports access', async () => {
    state.granted = new Set(['table_bookings:view'])
    await expect(TableBookingReportsPage({})).rejects.toThrow('NEXT_REDIRECT /unauthorized')
    expect(loadTableBookingReportsSnapshot).not.toHaveBeenCalled()
  })
})
