import { beforeEach, describe, expect, it, vi } from 'vitest'

type MileageTripRow = {
  trip_date: string
  total_miles: number
  amount_due: number
}

const mileageRows: MileageTripRow[] = [
  { trip_date: '2026-04-29', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-04-14', total_miles: 40.2, amount_due: 18.09 },
  { trip_date: '2026-04-09', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-04-04', total_miles: 3.4, amount_due: 1.53 },
  { trip_date: '2026-03-12', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-03-06', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-26', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-19', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-13', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-12', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-11', total_miles: 110, amount_due: 49.5 },
  { trip_date: '2026-02-06', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-01-28', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-01-20', total_miles: 28, amount_due: 12.6 },
  { trip_date: '2026-01-15', total_miles: 28, amount_due: 12.6 },
  { trip_date: '2026-01-05', total_miles: 28, amount_due: 12.6 },
]

const queryRanges: Array<{ gte?: string; lte?: string }> = []

function createMileageTripsQuery(): Record<string, unknown> {
  const range: { gte?: string; lte?: string } = {}
  const chain: Record<string, unknown> = {}

  chain.select = vi.fn(() => chain)
  chain.gte = vi.fn((_column: string, value: string) => {
    range.gte = value
    return chain
  })
  chain.lte = vi.fn((_column: string, value: string) => {
    range.lte = value
    queryRanges.push(range)
    return chain
  })
  chain.then = (
    resolve: (value: { data: MileageTripRow[]; error: null }) => void,
    reject?: (reason: unknown) => void
  ) => {
    const data = mileageRows.filter(
      (row) => (!range.gte || row.trip_date >= range.gte) && (!range.lte || row.trip_date <= range.lte)
    )
    return Promise.resolve({ data, error: null }).then(resolve, reject)
  }

  return chain
}

const mockFrom = vi.fn(() => createMileageTripsQuery())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    user_id: 'test-user-id',
    user_email: 'test@example.com',
  }),
}))

vi.mock('@/lib/dateUtils', () => ({
  getTodayIsoDate: vi.fn(() => '2026-05-05'),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { getTripStats } from '../mileage'

describe('getTripStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryRanges.length = 0
  })

  it('uses calendar-year totals for the annual stat while preserving tax-year threshold totals', async () => {
    const result = await getTripStats()

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      quarterTotalMiles: 98.8,
      quarterAmountDue: 44.46,
      calendarYear: 2026,
      calendarYearTotalMiles: 513.6,
      calendarYearAmountDue: 231.12,
      taxYearTotalMiles: 95.4,
      taxYearAmountDue: 42.93,
      milesToThreshold: 9904.6,
    })
    expect(queryRanges).toEqual([
      { gte: '2026-04-06', lte: '2027-04-05' },
      { gte: '2026-01-01', lte: '2026-12-31' },
    ])
  })
})
