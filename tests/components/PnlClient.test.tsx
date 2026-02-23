import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import type { PnlDashboardData } from '@/app/actions/pnl'
import { MANUAL_METRIC_KEYS, PNL_METRICS, PNL_TIMEFRAMES } from '@/lib/pnl/constants'

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
  }
}

describe('PnlClient currency detail formatting', () => {
  it('renders detail lines with a single currency symbol', () => {
    const { container } = render(<PnlClient initialData={createInitialDashboardData()} />)
    const text = container.textContent ?? ''

    expect(text).toContain('Actual £50.00')
    expect(text).toContain('Target £72.00')
    expect(text).toContain('Actual GP £70.00 · Cost £30.00')
    expect(text).toContain('Target GP £96.00 · Cost £24.00')
    expect(text).not.toContain('££')
  })
})
