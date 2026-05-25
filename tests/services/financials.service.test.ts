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

type CashupSalesRow = {
  id: string
  session_date: string
  status: string
  total_counted_amount: number
  cashup_sales_breakdowns?: Array<{ sales_category: string; amount: number }>
}

type ImportedSalesTestRow = {
  sale_date: string
  drinks_sales: number
  food_sales: number
  other_sales: number
  total_sales: number
}

function createFinancialDashboardClient(
  receiptPages: ReceiptExpenseRow[][],
  cashupRows: CashupSalesRow[] = [],
  importedSalesRows: ImportedSalesTestRow[] = []
) {
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

  const cashupOrder = vi.fn().mockResolvedValue({ data: cashupRows, error: null })
  const cashupIn = vi.fn().mockReturnValue({ order: cashupOrder })
  const cashupGte = vi.fn().mockReturnValue({ in: cashupIn })
  const cashupSelect = vi.fn().mockReturnValue({ gte: cashupGte })

  const importedSalesOrder = vi.fn().mockResolvedValue({ data: importedSalesRows, error: null })
  const importedSalesGte = vi.fn().mockReturnValue({ order: importedSalesOrder })
  const importedSalesEqSection = vi.fn().mockReturnValue({ gte: importedSalesGte })
  const importedSalesEqSource = vi.fn().mockReturnValue({ eq: importedSalesEqSection })
  const importedSalesSelect = vi.fn().mockReturnValue({ eq: importedSalesEqSource })

  const benchmarkMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const benchmarkLimit = vi.fn().mockReturnValue({ maybeSingle: benchmarkMaybeSingle })
  const benchmarkOrder = vi.fn().mockReturnValue({ limit: benchmarkLimit })
  const benchmarkEq = vi.fn().mockReturnValue({ order: benchmarkOrder })
  const benchmarkSelect = vi.fn().mockReturnValue({ eq: benchmarkEq })

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
    if (table === 'cashup_sessions') {
      return { select: cashupSelect }
    }
    if (table === 'pnl_sales_imports') {
      return { select: importedSalesSelect }
    }
    if (table === 'greene_king_pnl_benchmarks') {
      return { select: benchmarkSelect }
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
      cashupOrder,
      cashupIn,
      cashupGte,
      importedSalesOrder,
      importedSalesGte,
      importedSalesEqSource,
      importedSalesEqSection,
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
      { metric: 'drinks_sales', timeframe: '1m', value: null },
      { metric: 'total_staff', timeframe: '3m', value: null },
    ])

    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(deleteEqMetric).toHaveBeenNthCalledWith(1, 'metric_key', 'drinks_sales')
    expect(deleteEqTimeframe).toHaveBeenNthCalledWith(1, 'timeframe', '1m')
    expect(deleteEqMetric).toHaveBeenNthCalledWith(2, 'metric_key', 'total_staff')
    expect(deleteEqTimeframe).toHaveBeenNthCalledWith(2, 'timeframe', '3m')
  })

  it('deletes manual inputs by exact metric+timeframe pairs', async () => {
    const manualMetric = MANUAL_METRIC_KEYS[0]

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
    ])

    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteEqMetric).toHaveBeenCalledWith('metric_key', manualMetric)
    expect(deleteEqTimeframe).toHaveBeenCalledWith('timeframe', '12m')
  })

  it('rejects unknown P&L metric keys', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({ from: vi.fn() })

    await expect(
      FinancialService.savePlTargets([{ metric: 'unknown_metric', timeframe: '12m', value: 1 }])
    ).rejects.toThrow('Invalid P&L metric key')
  })

  it('rejects percentages outside 0 to 100', async () => {
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({ from: vi.fn() })

    await expect(
      FinancialService.savePlTargets([{ metric: 'total_food', timeframe: '12m', value: 101 }])
    ).rejects.toThrow('Percentage values must be between 0 and 100')
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

  it('uses submitted cash-up sales splits for drinks and food plus other sales', async () => {
    const rows: CashupSalesRow[] = [
      {
        id: 'cashup-1',
        session_date: isoDateDaysAgo(3),
        status: 'approved',
        total_counted_amount: 100,
        cashup_sales_breakdowns: [
          { sales_category: 'drinks_sales', amount: 70 },
          { sales_category: 'food_sales', amount: 20 },
          { sales_category: 'other_sales', amount: 10 },
        ],
      },
      {
        id: 'cashup-2',
        session_date: isoDateDaysAgo(3),
        status: 'draft',
        total_counted_amount: 999,
        cashup_sales_breakdowns: [
          { sales_category: 'drinks_sales', amount: 999 },
        ],
      },
    ]

    const { client } = createFinancialDashboardClient([[]], rows)
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

    const result = await FinancialService.getPlDashboardData()

    expect(result.actuals['1m'].drinks_sales).toBe(70)
    expect(result.actuals['1m'].food_sales).toBe(30)
    expect(result.cashupSales['1m'].totalRevenue).toBe(100)
    expect(result.cashupSales['1m'].excludedDraftCount).toBe(1)
  })

  it('prefers imported till sales rows over cash-up fallback data', async () => {
    const cashupRows: CashupSalesRow[] = [
      {
        id: 'cashup-1',
        session_date: isoDateDaysAgo(3),
        status: 'approved',
        total_counted_amount: 999,
        cashup_sales_breakdowns: [
          { sales_category: 'drinks_sales', amount: 999 },
        ],
      },
    ]
    const importedRows: ImportedSalesTestRow[] = [
      {
        sale_date: isoDateDaysAgo(3),
        drinks_sales: 80,
        food_sales: 20,
        other_sales: -0.18,
        total_sales: 99.82,
      },
    ]

    const { client, mocks } = createFinancialDashboardClient([[]], cashupRows, importedRows)
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

    const result = await FinancialService.getPlDashboardData()

    expect(mocks.importedSalesEqSource).toHaveBeenCalledWith('source', 'till_csv')
    expect(mocks.importedSalesEqSection).toHaveBeenCalledWith('source_section', 'Net sales')
    expect(mocks.cashupOrder).not.toHaveBeenCalled()
    expect(result.actuals['1m'].drinks_sales).toBe(80)
    expect(result.actuals['1m'].food_sales).toBe(19.82)
    expect(result.cashupSales['1m'].totalRevenue).toBe(99.82)
    expect(result.cashupSales['1m'].sessionCount).toBe(1)
  })

  it('flags completed cash-ups with missing sales split data', async () => {
    const rows: CashupSalesRow[] = [
      {
        id: 'cashup-1',
        session_date: isoDateDaysAgo(3),
        status: 'submitted',
        total_counted_amount: 100,
        cashup_sales_breakdowns: [],
      },
    ]

    const { client } = createFinancialDashboardClient([[]], rows)
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(client)

    const result = await FinancialService.getPlDashboardData()

    expect(result.cashupSales['1m'].missingSplitCount).toBe(1)
    expect(result.cashupSales['1m'].unallocatedSales).toBe(100)
    expect(result.dataQuality.warnings.join(' ')).toContain('missing a matching drinks/food/other split')
  })
})
