import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import { savePlManualActualsAction } from '@/app/actions/pnl'
import type { PnlDashboardData } from '@/app/actions/pnl'
import { MANUAL_METRIC_KEYS, PNL_METRICS, PNL_TIMEFRAMES } from '@/lib/pnl/constants'
import { GREENE_KING_BENCHMARK } from '@/lib/pnl/greene-king-benchmark'

// PnlClient renders the Receipts page chrome (PageLayout), which reads the router and path.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/receipts/pnl',
}))

vi.mock('@/app/actions/pnl', () => ({
  savePlManualActualsAction: vi.fn().mockResolvedValue({ success: true }),
  savePlTargetsAction: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/components/ui-v2/feedback/Toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function createZeroMetricMap(): Record<string, number> {
  return PNL_METRICS.reduce<Record<string, number>>((acc, metric) => {
    acc[metric.key] = 0
    return acc
  }, {})
}

function createInitialDashboardData(): PnlDashboardData {
  const emptyManuals = MANUAL_METRIC_KEYS.reduce<
    Record<string, Partial<Record<'1m' | '3m' | '12m', number | null>>>
  >((acc, metric) => {
    acc[metric] = { '1m': null, '3m': null, '12m': null }
    return acc
  }, {})

  return {
    metrics: PNL_METRICS,
    timeframes: PNL_TIMEFRAMES,
    actuals: {
      '1m': createZeroMetricMap(),
      '3m': createZeroMetricMap(),
      '12m': createZeroMetricMap(),
    },
    targets: {
      drinks_sales: { '12m': 120 },
      draught_beer_pct: { '12m': 60 },
      total_drinks_post_wastage: { '12m': 80 },
    },
    manualActuals: {
      ...emptyManuals,
      drinks_sales: { '1m': null, '3m': null, '12m': 100 },
      draught_beer_pct: { '1m': null, '3m': null, '12m': 50 },
      total_drinks_post_wastage: { '1m': null, '3m': null, '12m': 70 },
    },
    expenseTotals: {
      '1m': 0,
      '3m': 0,
      '12m': 0,
    },
    cashupSales: {
      '1m': {
        totalRevenue: 0,
        drinksSales: 0,
        foodSales: 0,
        otherSales: 0,
        foodPlusOtherSales: 0,
        unallocatedSales: 0,
        sessionCount: 0,
        missingSplitCount: 0,
        excludedDraftCount: 0,
        latestSessionDate: null,
      },
      '3m': {
        totalRevenue: 0,
        drinksSales: 0,
        foodSales: 0,
        otherSales: 0,
        foodPlusOtherSales: 0,
        unallocatedSales: 0,
        sessionCount: 0,
        missingSplitCount: 0,
        excludedDraftCount: 0,
        latestSessionDate: null,
      },
      '12m': {
        totalRevenue: 100,
        drinksSales: 100,
        foodSales: 0,
        otherSales: 0,
        foodPlusOtherSales: 0,
        unallocatedSales: 0,
        sessionCount: 1,
        missingSplitCount: 0,
        excludedDraftCount: 0,
        latestSessionDate: '2026-02-23',
      },
    },
    dataQuality: {
      warnings: [],
      receiptAggregationFailed: false,
      cashupAggregationFailed: false,
    },
    greeneKingBenchmark: GREENE_KING_BENCHMARK,
  }
}

describe('PnlClient currency detail formatting', () => {
  it('renders detail lines with a single currency symbol', () => {
    const { container } = render(<PnlClient initialData={createInitialDashboardData()} canExport />)
    const text = container.textContent ?? ''

    expect(text).toContain('Actual GP £70.00 · Cost £30.00')
    expect(text).toContain('P&L Target GP £96.00 · Cost £24.00')
    expect(text).not.toContain('££')
  })

  it('shows the export action only when export permission is available', () => {
    const data = createInitialDashboardData()
    const { rerender } = render(<PnlClient initialData={data} canExport={false} />)

    expect(screen.queryByRole('button', { name: 'PDF' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Spreadsheet' })).toBeNull()

    rerender(<PnlClient initialData={data} canExport />)

    // Header actions: PageLayout renders them in the desktop header and the phone nav row.
    expect(screen.getAllByRole('button', { name: 'PDF' })[0]).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Spreadsheet' })[0]).toBeInTheDocument()
  })

  it('uses the selected timeframe when triggering PDF export', () => {
    render(<PnlClient initialData={createInitialDashboardData()} canExport />)

    // The timeframe switch and the exports are header actions (the switch is a DS Segmented,
    // so each timeframe is a radio). PageLayout renders header actions twice, desktop and phone.
    const chooseTimeframe = (label: string) => fireEvent.click(screen.getAllByRole('radio', { name: label })[0])
    const exportButton = screen.getAllByRole('button', { name: 'PDF' })[0]

    chooseTimeframe('Last 30 days')
    expect(exportButton).toHaveAttribute('data-export-url', '/api/receipts/pnl/export?timeframe=1m&format=pdf')

    chooseTimeframe('Last 90 days')
    expect(exportButton).toHaveAttribute('data-export-url', '/api/receipts/pnl/export?timeframe=3m&format=pdf')

    chooseTimeframe('Last 365 days')
    expect(exportButton).toHaveAttribute('data-export-url', '/api/receipts/pnl/export?timeframe=12m&format=pdf')
  })

  it('renders business health and comparison sections', () => {
    render(<PnlClient initialData={createInitialDashboardData()} canExport />)

    expect(screen.getByText('Actual income')).toBeInTheDocument()
    expect(screen.getByText('Sales Performance')).toBeInTheDocument()
    expect(screen.getByText('Expense Performance')).toBeInTheDocument()
    expect(screen.getByText('Gross Profit / Operating Profit')).toBeInTheDocument()
    expect(screen.getByText('Greene King Benchmark')).toBeInTheDocument()
    expect(screen.getByText('Greene King Benchmark Target Values')).toBeInTheDocument()
  })

  it('saves P&L inputs for the selected timeframe only', async () => {
    render(<PnlClient initialData={createInitialDashboardData()} canManage />)

    fireEvent.click(screen.getAllByRole('radio', { name: 'Last 90 days' })[0])
    fireEvent.change(screen.getAllByLabelText('Accommodation sales')[0], { target: { value: '123.45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save P&L Inputs' }))

    await waitFor(() => {
      expect(savePlManualActualsAction).toHaveBeenCalled()
    })

    const formData = vi.mocked(savePlManualActualsAction).mock.calls[0][0] as FormData
    const payload = JSON.parse(String(formData.get('data'))) as Array<{
      metric: string
      timeframe: string
      value: number | null
    }>

    expect(new Set(payload.map((entry) => entry.timeframe))).toEqual(new Set(['3m']))
    expect(payload.find((entry) => entry.metric === 'accommodation_sales')).toMatchObject({
      timeframe: '3m',
      value: 123.45,
    })
    expect(payload).toHaveLength(MANUAL_METRIC_KEYS.length)
  })
})
