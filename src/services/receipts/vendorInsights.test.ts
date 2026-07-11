import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildReceiptVendorMovementSummaries } from './vendorInsights'
import type { ReceiptVendorTrendMonth } from './types'

function month(monthStart: string, totalOutgoing: number, transactionCount = 1): ReceiptVendorTrendMonth {
  return { monthStart, totalOutgoing, totalIncome: 0, transactionCount }
}

describe('buildReceiptVendorMovementSummaries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the latest completed month instead of a partial current month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'))

    const [summary] = buildReceiptVendorMovementSummaries([
      {
        vendorLabel: 'Supplier A',
        months: [
          month('2025-06-01', 500),
          month('2026-06-01', 750),
          month('2026-07-01', 20),
        ],
      },
    ], { comparison: 'yoy', range: '12m' })

    expect(summary.latestMonthStart).toBe('2026-06-01')
    expect(summary.latestOutgoing).toBe(750)
    expect(summary.baselineOutgoing).toBe(500)
    expect(summary.delta).toBe(250)
  })

  it('calculates the latest three-month average against the previous three months', () => {
    const [summary] = buildReceiptVendorMovementSummaries([
      {
        vendorLabel: 'Supplier A',
        months: [
          month('2026-01-01', 100),
          month('2026-02-01', 200),
          month('2026-03-01', 300),
          month('2026-04-01', 300),
          month('2026-05-01', 450),
          month('2026-06-01', 600),
        ],
      },
    ], {
      comparison: 'rolling_3m',
      range: '12m',
      referenceMonthStart: '2026-06-01',
    })

    expect(summary.latestOutgoing).toBe(450)
    expect(summary.baselineOutgoing).toBe(200)
    expect(summary.delta).toBe(250)
    expect(summary.percentageChange).toBe(125)
    expect(summary.latestTransactionCount).toBe(3)
  })

  it('ranks all vendors by absolute pound movement', () => {
    const summaries = buildReceiptVendorMovementSummaries([
      {
        vendorLabel: 'Small increase',
        months: [month('2025-06-01', 100), month('2026-06-01', 200)],
      },
      {
        vendorLabel: 'Large decrease',
        months: [month('2025-06-01', 1_000), month('2026-06-01', 400)],
      },
    ], {
      comparison: 'yoy',
      range: '12m',
      referenceMonthStart: '2026-06-01',
    })

    expect(summaries.map((summary) => summary.vendorLabel)).toEqual(['Large decrease', 'Small increase'])
  })
})
