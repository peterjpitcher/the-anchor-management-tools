import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the admin client before importing the module under test
const mockFrom = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockGte = vi.fn()
const mockLte = vi.fn()
const mockOrder = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}))

import { recalculateTaxYearMileage } from '../recalculateTaxYear'

describe('recalculateTaxYearMileage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default chain: from().select().gte().lte().order().order()
    mockOrder.mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    mockLte.mockReturnValue({ order: mockOrder })
    mockGte.mockReturnValue({ lte: mockLte })
    mockSelect.mockReturnValue({ gte: mockGte })
    mockFrom.mockReturnValue({ select: mockSelect })
  })

  it('should do nothing when there are no trips in the tax year', async () => {
    mockOrder.mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    await recalculateTaxYearMileage('2026-06-15')

    // Should have called from('mileage_trips') for the select
    expect(mockFrom).toHaveBeenCalledWith('mileage_trips')
    // Should NOT have called from() again for updates (no trips to update)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('should recalculate splits for trips within standard rate threshold', async () => {
    const trips = [
      { id: 'trip-1', total_miles: '100' },
      { id: 'trip-2', total_miles: '200' },
    ]

    // Setup the chain for fetching trips
    const mockOrderInner = vi.fn().mockResolvedValue({ data: trips, error: null })
    mockOrder.mockReturnValue({ order: mockOrderInner })

    // Setup the chain for updating trips
    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
    mockUpdate.mockReturnValue({ eq: mockUpdateEq })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') {
        // First call is select, subsequent calls are updates
        if (mockFrom.mock.calls.length === 1) {
          return { select: mockSelect }
        }
        return { update: mockUpdate }
      }
      return { select: mockSelect }
    })

    await recalculateTaxYearMileage('2026-06-15')

    // Both trips should be updated
    // Trip 1: 100 miles, all at standard rate (0 cumulative before)
    // Trip 2: 200 miles, all at standard rate (100 cumulative before)
    expect(mockUpdate).toHaveBeenCalledTimes(2)

    // First trip: 100 miles at standard
    expect(mockUpdate).toHaveBeenNthCalledWith(1, {
      miles_at_standard_rate: 100,
      miles_at_reduced_rate: 0,
      amount_due: 45, // 100 * 0.45
    })

    // Second trip: 200 miles at standard
    expect(mockUpdate).toHaveBeenNthCalledWith(2, {
      miles_at_standard_rate: 200,
      miles_at_reduced_rate: 0,
      amount_due: 90, // 200 * 0.45
    })
  })

  it('should throw on fetch error', async () => {
    const mockOrderInner = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB connection failed' },
    })
    mockOrder.mockReturnValue({ order: mockOrderInner })

    await expect(recalculateTaxYearMileage('2026-06-15')).rejects.toThrow(
      'Failed to fetch trips for recalculation'
    )
  })

  it('should query the correct tax year bounds', async () => {
    const mockOrderInner = vi.fn().mockResolvedValue({ data: [], error: null })
    mockOrder.mockReturnValue({ order: mockOrderInner })

    // Date 2026-06-15 falls in tax year 2026-04-06 to 2027-04-05
    await recalculateTaxYearMileage('2026-06-15')

    expect(mockGte).toHaveBeenCalledWith('trip_date', '2026-04-06')
    expect(mockLte).toHaveBeenCalledWith('trip_date', '2027-04-05')
  })

  it('should query correct bounds for a date before April 6', async () => {
    const mockOrderInner = vi.fn().mockResolvedValue({ data: [], error: null })
    mockOrder.mockReturnValue({ order: mockOrderInner })

    // Date 2026-01-15 falls in tax year 2025-04-06 to 2026-04-05
    await recalculateTaxYearMileage('2026-01-15')

    expect(mockGte).toHaveBeenCalledWith('trip_date', '2025-04-06')
    expect(mockLte).toHaveBeenCalledWith('trip_date', '2026-04-05')
  })
})
