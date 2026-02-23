import { describe, expect, it } from 'vitest'

import { PNL_METRICS, PNL_TIMEFRAMES, MANUAL_METRIC_KEYS } from '@/lib/pnl/constants'
import { buildPnlReportViewModel } from '@/lib/pnl/report-view-model'
import type { PnlDashboardData } from '@/services/financials'

function createZeroMetricMap() {
  return PNL_METRICS.reduce<Record<string, number>>((acc, metric) => {
    acc[metric.key] = 0
    return acc
  }, {})
}

function createEmptyManualMap() {
  return MANUAL_METRIC_KEYS.reduce<Record<string, Partial<Record<'1m' | '3m' | '12m', number | null>>>>((acc, metric) => {
    acc[metric] = { '1m': null, '3m': null, '12m': null }
    return acc
  }, {})
}

function createDashboardData(): PnlDashboardData {
  return {
    metrics: PNL_METRICS,
    timeframes: PNL_TIMEFRAMES,
    actuals: {
      '1m': {
        ...createZeroMetricMap(),
        drinks_sales: 100,
        food_sales: 50,
        draught_beer_pct: 50,
        total_drinks_post_wastage: 70,
        rent: 120,
        royalty: 30,
        total_staff: 250,
      },
      '3m': {
        ...createZeroMetricMap(),
        drinks_sales: 300,
        food_sales: 170,
        draught_beer_pct: 52,
        total_drinks_post_wastage: 71,
        rent: 340,
        royalty: 90,
        total_staff: 700,
      },
      '12m': {
        ...createZeroMetricMap(),
        drinks_sales: 3650,
        food_sales: 730,
        draught_beer_pct: 55,
        total_drinks_post_wastage: 73,
        rent: 3500,
        royalty: 365,
        total_staff: 2800,
      },
    },
    targets: {
      drinks_sales: { '12m': 3650 },
      food_sales: { '12m': 7300 },
      draught_beer_pct: { '12m': 60 },
      total_drinks_post_wastage: { '12m': 80 },
      rent: { '12m': 3650 },
      total_staff: { '12m': 3650 },
    },
    manualActuals: createEmptyManualMap(),
    expenseTotals: {
      '1m': 250,
      '3m': 700,
      '12m': 2800,
    },
  }
}

function findRow(viewModel: ReturnType<typeof buildPnlReportViewModel>, key: string) {
  const row = viewModel.sections.flatMap((section) => section.rows).find((item) => item.key === key)
  if (!row) throw new Error(`Missing row for ${key}`)
  return row
}

function findSection(viewModel: ReturnType<typeof buildPnlReportViewModel>, key: string) {
  const section = viewModel.sections.find((item) => item.key === key)
  if (!section) throw new Error(`Missing section for ${key}`)
  return section
}

describe('buildPnlReportViewModel', () => {
  it('scales currency targets by timeframe and keeps percent targets unchanged', () => {
    const data = createDashboardData()

    const oneMonth = buildPnlReportViewModel(data, '1m', new Date('2026-02-23T12:00:00Z'))
    const threeMonths = buildPnlReportViewModel(data, '3m', new Date('2026-02-23T12:00:00Z'))
    const twelveMonths = buildPnlReportViewModel(data, '12m', new Date('2026-02-23T12:00:00Z'))

    expect(findRow(oneMonth, 'drinks_sales').timeframeTarget).toBe(300)
    expect(findRow(threeMonths, 'drinks_sales').timeframeTarget).toBe(900)
    expect(findRow(twelveMonths, 'drinks_sales').timeframeTarget).toBe(3650)

    expect(findRow(oneMonth, 'draught_beer_pct').timeframeTarget).toBe(60)
    expect(findRow(threeMonths, 'draught_beer_pct').timeframeTarget).toBe(60)
    expect(findRow(twelveMonths, 'draught_beer_pct').timeframeTarget).toBe(60)
  })

  it('matches sales mix and GP detail line calculations used in the UI', () => {
    const data = createDashboardData()
    const viewModel = buildPnlReportViewModel(data, '1m', new Date('2026-02-23T12:00:00Z'))

    expect(findRow(viewModel, 'draught_beer_pct').detailLines).toEqual([
      'Actual £50.00',
      'P&L Target £180.00',
    ])

    expect(findRow(viewModel, 'total_drinks_post_wastage').detailLines).toEqual([
      'Actual GP £70.00 · Cost £30.00',
      'P&L Target GP £240.00 · Cost £60.00',
    ])
  })

  it('computes totals using sales revenue and expenses + occupancy parity rules', () => {
    const data = createDashboardData()
    const viewModel = buildPnlReportViewModel(data, '1m', new Date('2026-02-23T12:00:00Z'))
    const salesSection = findSection(viewModel, 'sales')
    const expensesSection = findSection(viewModel, 'expenses')

    expect(viewModel.summary).toEqual({
      revenueActual: 150,
      revenueTarget: 900,
      revenueVariance: -750,
      expenseActual: 400,
      expenseTarget: 600,
      expenseVariance: -200,
      operatingProfitActual: -250,
      operatingProfitTarget: 300,
      operatingProfitVariance: -550,
    })

    expect(salesSection.subtotal).toEqual({
      label: 'Total sales',
      format: 'currency',
      actual: 150,
      annualTarget: 10950,
      timeframeTarget: 900,
      variance: -750,
    })

    expect(expensesSection.subtotal).toEqual({
      label: 'Total expenses (incl occupancy)',
      format: 'currency',
      actual: 400,
      annualTarget: 7300,
      timeframeTarget: 600,
      variance: -200,
      invertVariance: true,
    })
  })
})
