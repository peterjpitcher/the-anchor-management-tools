import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: mockRpc })),
}))

import { recalculateTaxYearMileage } from '../recalculateTaxYear'

describe('recalculateTaxYearMileage', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('delegates to the database recalculation function', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })

    await recalculateTaxYearMileage('2026-04-05')

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('recalculate_mileage_tax_year_v01', { p_trip_date: '2026-04-05' })
  })

  it('throws when the database function fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '40P01', message: 'deadlock detected', details: null, hint: null },
    })

    await expect(recalculateTaxYearMileage('2026-04-05')).rejects.toThrow('deadlock detected')
  })
})
