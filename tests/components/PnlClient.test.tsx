import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import { savePlManualActualsAction } from '@/app/actions/pnl'
import type { PnlDashboardData } from '@/app/actions/pnl'
import { MANUAL_METRIC_KEYS, PNL_METRICS, PNL_TIMEFRAMES } from '@/lib/pnl/constants'
import { GREENE_KING_BENCHMARK } from '@/lib/pnl/greene-king-benchmark'

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

    expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spreadsheet' })).toBeInTheDocument()
  })

  it('uses the selected timeframe when triggering PDF export', () => {
    render(<PnlClient initialData={createInitialDashboardData()} canExport />)

    const timeframeSelect = screen.getByLabelText('View timeframe')
    const exportButton = screen.getByRole('button', { name: 'PDF' })

    fireEvent.change(timeframeSelect, { target: { value: '1m' } })
    expect(exportButton).toHaveAttribute('data-export-url', '/api/receipts/pnl/export?timeframe=1m&format=pdf')

    fireEvent.change(timeframeSelect, { target: { value: '3m' } })
    expect(exportButton).toHaveAttribute('data-export-url', '/api/receipts/pnl/export?timeframe=3m&format=pdf')

    fireEvent.change(timeframeSelect, { target: { value: '12m' } })
    expect(exportButton).toHaveAttribute('data-export-url', '/api/receipts/pnl/export?timeframe=12m&format=pdf')
  })

  it('renders business health and comparison sections', () => {
    render(<PnlClient initialData={createInitialDashboardData()} canExport />)

    expect(screen.getByText('Actual income')).toBeInTheDocument()
    expect(screen.getByText('Sales performance')).toBeInTheDocument()
    expect(screen.getByText('Expense performance')).toBeInTheDocument()
    expect(screen.getByText('Gross profit / operating profit')).toBeInTheDocument()
    expect(screen.getByText('Greene King benchmark')).toBeInTheDocument()
    expect(screen.getByText('Greene King benchmark target values')).toBeInTheDocument()
  })

  it('saves P&L inputs for the selected timeframe only', async () => {
    render(<PnlClient initialData={createInitialDashboardData()} canManage />)

    fireEvent.change(screen.getByLabelText('View timeframe'), { target: { value: '3m' } })
    fireEvent.change(screen.getAllByLabelText('Accommodation sales')[0], { target: { value: '123.45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save P&L inputs' }))

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
