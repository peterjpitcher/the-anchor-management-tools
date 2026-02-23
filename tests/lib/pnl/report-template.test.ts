import { describe, expect, it } from 'vitest'

import { generatePnlReportHTML } from '@/lib/pnl/report-template'
import type { PnlReportViewModel } from '@/lib/pnl/report-view-model'

const MOCK_VIEW_MODEL: PnlReportViewModel = {
  timeframe: '12m',
  timeframeLabel: 'Last 365 days',
  generatedAtIso: '2026-02-23T12:00:00.000Z',
  generatedAtLabel: '23 Feb 2026, 12:00 UTC',
  sections: [
    {
      key: 'sales',
      label: 'Sales',
      rows: [
        {
          key: 'drinks_sales',
          label: 'Drinks sales',
          group: 'sales',
          format: 'currency',
          actual: 100,
          annualTarget: 120,
          timeframeTarget: 120,
          variance: -20,
          detailLines: [],
        },
      ],
      subtotal: {
        label: 'Total sales',
        format: 'currency',
        actual: 100,
        annualTarget: 120,
        timeframeTarget: 120,
        variance: -20,
      },
    },
    {
      key: 'expenses',
      label: 'Expenses',
      rows: [
        {
          key: 'total_staff',
          label: 'Total Staff',
          group: 'expenses',
          format: 'currency',
          actual: 50,
          annualTarget: 60,
          timeframeTarget: 60,
          variance: -10,
          detailLines: [],
        },
      ],
      subtotal: {
        label: 'Total expenses (incl occupancy)',
        format: 'currency',
        actual: 70,
        annualTarget: 80,
        timeframeTarget: 80,
        variance: -10,
        invertVariance: true,
      },
    },
  ],
  summary: {
    revenueActual: 100,
    revenueTarget: 120,
    revenueVariance: -20,
    expenseActual: 70,
    expenseTarget: 80,
    expenseVariance: -10,
    operatingProfitActual: 30,
    operatingProfitTarget: 40,
    operatingProfitVariance: -10,
  },
}

describe('generatePnlReportHTML', () => {
  it('includes subtotal rows for sales and expenses sections', () => {
    const html = generatePnlReportHTML(MOCK_VIEW_MODEL)

    expect(html).toContain('Total sales')
    expect(html).toContain('Total expenses (incl occupancy)')
    expect(html).toContain('class="subtotal-row"')
    expect(html).toContain('Shadow P&amp;L')
    expect(html).toContain('Sales - LAST 365 DAYS VS. SHADOW P&amp;L')
    expect(html).toContain('Expenses - LAST 365 DAYS VS. SHADOW P&amp;L')
    expect(html).toContain('.report-header {')
    expect(html).toContain('background: #ffffff;')
    expect(html).toContain('P&amp;L Target')
  })
})
