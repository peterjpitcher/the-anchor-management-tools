import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { MANUAL_METRIC_KEYS } from '@/lib/pnl/constants'
import { FinancialService } from '@/services/financials'

describe('FinancialService deletion precision guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes P&L targets by exact metric+timeframe pairs (no cross-product delete)', async () => {
    const deleteEqTimeframe = vi.fn().mockResolvedValue({ error: null })
    const deleteEqMetric = vi.fn().mockReturnValue({ eq: deleteEqTimeframe })
    const deleteMock = vi.fn().mockReturnValue({ eq: deleteEqMetric })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'pl_targets') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: deleteMock,
        }
      }),
    })

    await FinancialService.savePlTargets([
      { metric: 'sales', timeframe: '1m', value: null },
      { metric: 'cost_of_goods', timeframe: '3m', value: null },
    ])

    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(deleteEqMetric).toHaveBeenNthCalledWith(1, 'metric_key', 'sales')
    expect(deleteEqTimeframe).toHaveBeenNthCalledWith(1, 'timeframe', '1m')
    expect(deleteEqMetric).toHaveBeenNthCalledWith(2, 'metric_key', 'cost_of_goods')
    expect(deleteEqTimeframe).toHaveBeenNthCalledWith(2, 'timeframe', '3m')
  })

  it('applies manual-input deletion only for manual metrics and exact pairs', async () => {
    const manualMetric = MANUAL_METRIC_KEYS[0]
    const nonManualMetric = 'staff_costs'

    const deleteEqTimeframe = vi.fn().mockResolvedValue({ error: null })
    const deleteEqMetric = vi.fn().mockReturnValue({ eq: deleteEqTimeframe })
    const deleteMock = vi.fn().mockReturnValue({ eq: deleteEqMetric })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'pl_manual_actuals') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: deleteMock,
        }
      }),
    })

    await FinancialService.savePlManualActuals([
      { metric: manualMetric, timeframe: '12m', value: null },
      { metric: nonManualMetric, timeframe: '12m', value: null },
    ])

    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteEqMetric).toHaveBeenCalledWith('metric_key', manualMetric)
    expect(deleteEqTimeframe).toHaveBeenCalledWith('timeframe', '12m')
  })
})
