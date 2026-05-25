import { describe, expect, it } from 'vitest'
import {
  buildDeterministicVendorAiReview,
  buildReceiptVendorMovementMonthsForVendor,
  buildReceiptVendorMovementSummaries,
  buildReceiptVendorCostSignals,
  type ReceiptVendorSummary,
} from '@/services/receipts'

function vendor(vendorLabel: string, outgoingByMonth: Array<[string, number]>): ReceiptVendorSummary {
  const months = outgoingByMonth.map(([monthStart, totalOutgoing]) => ({
    monthStart,
    totalOutgoing,
    totalIncome: 0,
    transactionCount: totalOutgoing > 0 ? 1 : 0,
  }))

  return {
    vendorLabel,
    months,
    totalOutgoing: months.reduce((sum, month) => sum + month.totalOutgoing, 0),
    totalIncome: 0,
    recentAverageOutgoing: 0,
    previousAverageOutgoing: 0,
    changePercentage: 0,
  }
}

describe('receipt vendor cost signals', () => {
  const baseMonths = [
    '2026-01-01',
    '2026-02-01',
    '2026-03-01',
    '2026-04-01',
    '2026-05-01',
    '2026-06-01',
  ] as const

  it('flags material spend spikes', () => {
    const signals = buildReceiptVendorCostSignals([
      vendor('Brewery A', [
        [baseMonths[0], 100],
        [baseMonths[1], 100],
        [baseMonths[2], 100],
        [baseMonths[3], 300],
        [baseMonths[4], 300],
        [baseMonths[5], 300],
      ]),
    ], { monthWindow: 6, referenceMonthStart: '2026-06-01' })

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      vendorLabel: 'Brewery A',
      direction: 'spike',
      severity: 'high',
      recentAverageOutgoing: 300,
      previousAverageOutgoing: 100,
    })
  })

  it('flags material spend drops', () => {
    const signals = buildReceiptVendorCostSignals([
      vendor('Food Supplier', [
        [baseMonths[0], 400],
        [baseMonths[1], 400],
        [baseMonths[2], 400],
        [baseMonths[3], 100],
        [baseMonths[4], 100],
        [baseMonths[5], 100],
      ]),
    ], { monthWindow: 6, referenceMonthStart: '2026-06-01' })

    expect(signals[0]).toMatchObject({
      vendorLabel: 'Food Supplier',
      direction: 'drop',
      severity: 'high',
      recentAverageOutgoing: 100,
      previousAverageOutgoing: 400,
    })
  })

  it('flags new vendors when previous average is zero', () => {
    const signals = buildReceiptVendorCostSignals([
      vendor('New Supplier', [
        [baseMonths[3], 120],
        [baseMonths[4], 120],
        [baseMonths[5], 120],
      ]),
    ], { monthWindow: 6, referenceMonthStart: '2026-06-01' })

    expect(signals[0]).toMatchObject({
      vendorLabel: 'New Supplier',
      direction: 'new',
      severity: 'high',
      previousAverageOutgoing: 0,
      recentAverageOutgoing: 120,
    })
  })

  it('suppresses low-value noise below absolute threshold', () => {
    const signals = buildReceiptVendorCostSignals([
      vendor('Small Vendor', [
        [baseMonths[0], 10],
        [baseMonths[1], 10],
        [baseMonths[2], 10],
        [baseMonths[3], 40],
        [baseMonths[4], 40],
        [baseMonths[5], 40],
      ]),
    ], { monthWindow: 6, referenceMonthStart: '2026-06-01' })

    expect(signals).toHaveLength(0)
  })

  it('builds deterministic fallback review items from signals', () => {
    const signals = buildReceiptVendorCostSignals([
      vendor('Brewery A', [
        [baseMonths[0], 100],
        [baseMonths[1], 100],
        [baseMonths[2], 100],
        [baseMonths[3], 300],
        [baseMonths[4], 300],
        [baseMonths[5], 300],
      ]),
    ], { monthWindow: 6, referenceMonthStart: '2026-06-01' })

    const review = buildDeterministicVendorAiReview(signals, { generatedAt: '2026-06-30T00:00:00.000Z' })

    expect(review.source).toBe('deterministic')
    expect(review.reviewItems[0]).toMatchObject({
      vendorLabel: 'Brewery A',
      direction: 'spike',
      severity: 'high',
    })
  })
})

describe('receipt vendor movement signals', () => {
  it('flags MoM spikes and fills missing months as zero', () => {
    const movements = buildReceiptVendorMovementSummaries([
      vendor('Brewery A', [
        ['2026-04-01', 100],
        ['2026-06-01', 300],
      ]),
    ], {
      range: '12m',
      comparison: 'mom',
      referenceMonthStart: '2026-06-01',
    })

    expect(movements[0].months.find((month) => month.monthStart === '2026-05-01')).toMatchObject({
      totalOutgoing: 0,
      transactionCount: 0,
    })
    expect(movements[0]).toMatchObject({
      vendorLabel: 'Brewery A',
      latestOutgoing: 300,
      baselineOutgoing: 0,
      delta: 300,
      percentageChange: 100,
      signal: {
        comparison: 'mom',
        direction: 'resumed',
        severity: 'high',
      },
    })
  })

  it('flags YoY spikes and drops', () => {
    const movements = buildReceiptVendorMovementSummaries([
      vendor('Brewery A', [
        ['2025-06-01', 100],
        ['2026-06-01', 300],
      ]),
      vendor('Food Supplier', [
        ['2025-06-01', 400],
        ['2026-06-01', 100],
      ]),
    ], {
      range: '12m',
      comparison: 'yoy',
      referenceMonthStart: '2026-06-01',
    })

    expect(movements.map((movement) => movement.vendorLabel)).toEqual(['Food Supplier', 'Brewery A'])
    expect(movements[0].signal).toMatchObject({
      direction: 'drop',
      comparison: 'yoy',
      severity: 'high',
      absoluteDelta: 300,
    })
    expect(movements[1].signal).toMatchObject({
      direction: 'spike',
      comparison: 'yoy',
      severity: 'high',
      absoluteDelta: 200,
    })
  })

  it('suppresses low-value movement noise', () => {
    const movements = buildReceiptVendorMovementSummaries([
      vendor('Small Vendor', [
        ['2025-06-01', 20],
        ['2026-06-01', 60],
      ]),
    ], {
      range: '12m',
      comparison: 'yoy',
      referenceMonthStart: '2026-06-01',
    })

    expect(movements[0].signal).toBeNull()
  })

  it('returns all-history monthly movement for a vendor', () => {
    const months = buildReceiptVendorMovementMonthsForVendor('Brewery A', [
      { monthStart: '2025-12-01', totalOutgoing: 100, totalIncome: 0, transactionCount: 1 },
      { monthStart: '2026-02-01', totalOutgoing: 300, totalIncome: 0, transactionCount: 1 },
    ], { range: 'all' })

    expect(months.map((month) => month.monthStart)).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ])
    expect(months[1]).toMatchObject({ totalOutgoing: 0, momDelta: -100 })
    expect(months[2]).toMatchObject({ totalOutgoing: 300, momBaselineOutgoing: 0 })
  })
})
