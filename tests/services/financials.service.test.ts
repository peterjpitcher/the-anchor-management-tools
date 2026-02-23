import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { MANUAL_METRIC_KEYS } from '@/lib/pnl/constants'
import { FinancialService } from '@/services/financials'

const RECEIPT_PAGE_SIZE = 1000

type ReceiptExpenseRow = {
  transaction_date: string
  expense_category: string | null
  amount_out: number | null
}

function isoDateDaysAgo(daysAgo: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

function createFinancialDashboardClient(receiptPages: ReceiptExpenseRow[][]) {
  const targetSelect = vi.fn().mockResolvedValue({ data: [], error: null })
  const manualSelect = vi.fn().mockResolvedValue({ data: [], error: null })

  const receiptRange = vi.fn((from: number) => {
    const pageIndex = Math.floor(from / RECEIPT_PAGE_SIZE)
    return Promise.resolve({ data: receiptPages[pageIndex] ?? [], error: null })
  })
  const receiptOrderById = vi.fn().mockReturnValue({ range: receiptRange })
  const receiptOrderByDate = vi.fn().mockReturnValue({ order: receiptOrderById })
  const receiptIn = vi.fn().mockReturnValue({ order: receiptOrderByDate })
  const receiptGte = vi.fn().mockReturnValue({ in: receiptIn })
  const receiptSelect = vi.fn().mockReturnValue({ gte: receiptGte })

  const from = vi.fn((table: string) => {
    if (table === 'pl_targets') {
      return { select: targetSelect }
    }
    if (table === 'pl_manual_actuals') {
      return { select: manualSelect }
    }
    if (table === 'receipt_transactions') {
      return { select: receiptSelect }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return {
    client: { from },
    mocks: {
      receiptRange,
      receiptIn,
      receiptGte,
      receiptOrderByDate,
      receiptOrderById,
    },
  }
}

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

describe('FinancialService P&L aggregation correctness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates receipt expenses across all paginated pages', async () => {
    const firstPage = Array.from({ length: RECEIPT_PAGE_SIZE }, () => ({
      transaction_date: isoDateDaysAgo(1),
      expense_category: 'Total Staff',
      amount_out: 1,
    }))
    const secondPage = [
      {
        transaction_date: isoDateDaysAgo(2),
        expense_category: 'Total Staff',
        amount_out: 1,
      },
    ]

    const { client, mocks } = createFinancialDashboardClient([firstPage, secondPage])
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

    const result = await FinancialService.getPlDashboardData()

    expect(mocks.receiptRange).toHaveBeenCalledTimes(2)
    expect(result.actuals['12m'].total_staff).toBe(1001)
    expect(result.expenseTotals['12m']).toBe(1001)
  })

  it('includes cant_find transactions in the status filter', async () => {
    const { client, mocks } = createFinancialDashboardClient([[]])
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

    await FinancialService.getPlDashboardData()

    expect(mocks.receiptIn).toHaveBeenCalledWith(
      'status',
      expect.arrayContaining(['pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find'])
    )
  })

  it('rolls expense totals into 1m/3m/12m buckets from one fetched row set', async () => {
    const rows: ReceiptExpenseRow[] = [
      {
        transaction_date: isoDateDaysAgo(10),
        expense_category: 'Total Staff',
        amount_out: 10,
      },
      {
        transaction_date: isoDateDaysAgo(40),
        expense_category: 'Total Staff',
        amount_out: 20,
      },
      {
        transaction_date: isoDateDaysAgo(200),
        expense_category: 'Total Staff',
        amount_out: 30,
      },
      {
        transaction_date: isoDateDaysAgo(5),
        expense_category: 'Marketing/Promotion/Advertising',
        amount_out: 5,
      },
    ]

    const { client } = createFinancialDashboardClient([rows])
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

    const result = await FinancialService.getPlDashboardData()

    expect(result.actuals['1m'].total_staff).toBe(10)
    expect(result.actuals['3m'].total_staff).toBe(30)
    expect(result.actuals['12m'].total_staff).toBe(60)

    expect(result.actuals['1m'].marketing_promotion_advertising).toBe(5)
    expect(result.actuals['3m'].marketing_promotion_advertising).toBe(5)
    expect(result.actuals['12m'].marketing_promotion_advertising).toBe(5)

    expect(result.expenseTotals['1m']).toBe(15)
    expect(result.expenseTotals['3m']).toBe(35)
    expect(result.expenseTotals['12m']).toBe(65)
  })
})
