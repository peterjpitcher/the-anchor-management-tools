// The cashing-up dashboard's year-to-date comparison, on the London clock.
//
// Comparing this year with another year fetches the other year from 1 January up to the same
// day of the year as today. That day came from the host clock, which is UTC on the server and so
// still yesterday from 00:00 to 00:59 British Summer Time, cutting the comparison a day short.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getDashboardDataAction = vi.hoisted(() => vi.fn())
const getWeeklyProgressAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        limit: () => ({
          single: async () => ({ data: { id: 'site-1' }, error: null }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/app/actions/cashing-up', () => ({
  getDashboardDataAction: (...args: unknown[]) => getDashboardDataAction(...args),
  getWeeklyProgressAction: (...args: unknown[]) => getWeeklyProgressAction(...args),
}))

vi.mock('@/app/(authenticated)/cashing-up/dashboard/_components/DashboardClient', () => ({
  DashboardClient: () => null,
}))

import CashupDashboardPage from '@/app/(authenticated)/cashing-up/dashboard/page'

// 00:30 BST on Friday 2 October 2026 in London; still Thursday 1 October in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00Z'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(JUST_AFTER_MIDNIGHT_BST))
  getDashboardDataAction.mockResolvedValue({ success: true, data: null })
  getWeeklyProgressAction.mockResolvedValue({ success: true, data: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CashupDashboardPage', () => {
  it('compares the other year up to the same London day of the year', async () => {
    await CashupDashboardPage({ searchParams: Promise.resolve({ compareYear: '2025' }) })

    expect(getDashboardDataAction).toHaveBeenCalledTimes(2)
    expect(getDashboardDataAction).toHaveBeenNthCalledWith(1, 'site-1', '2026-01-01', '2026-12-31')
    expect(getDashboardDataAction).toHaveBeenNthCalledWith(2, 'site-1', '2025-01-01', '2025-10-02')
    expect(getWeeklyProgressAction).toHaveBeenCalledWith('site-1', '2026-10-02')
  })

  it('compares the whole of the other year when a past year is selected', async () => {
    await CashupDashboardPage({ searchParams: Promise.resolve({ year: '2025', compareYear: '2024' }) })

    expect(getDashboardDataAction).toHaveBeenNthCalledWith(1, 'site-1', '2025-01-01', '2025-12-31')
    expect(getDashboardDataAction).toHaveBeenNthCalledWith(2, 'site-1', '2024-01-01', '2024-12-31')
  })
})
