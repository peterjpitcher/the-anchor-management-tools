import { describe, it, expect } from 'vitest'
import {
  getTaxYearBounds,
  calculateHmrcRateSplit,
  recalculateAllSplits,
  STANDARD_RATE,
  REDUCED_RATE,
  THRESHOLD_MILES,
} from '../hmrcRates'

describe('getTaxYearBounds', () => {
  it('should return correct bounds for a date after 6 April', () => {
    const bounds = getTaxYearBounds('2026-06-15')
    expect(bounds).toEqual({
      start: '2026-04-06',
      end: '2027-04-05',
    })
  })

  it('should return correct bounds for a date before 6 April', () => {
    const bounds = getTaxYearBounds('2026-01-15')
    expect(bounds).toEqual({
      start: '2025-04-06',
      end: '2026-04-05',
    })
  })

  it('should treat 6 April as start of new tax year', () => {
    const bounds = getTaxYearBounds('2026-04-06')
    expect(bounds).toEqual({
      start: '2026-04-06',
      end: '2027-04-05',
    })
  })

  it('should treat 5 April as end of previous tax year', () => {
    const bounds = getTaxYearBounds('2026-04-05')
    expect(bounds).toEqual({
      start: '2025-04-06',
      end: '2026-04-05',
    })
  })

  it('should handle 1 January correctly', () => {
    const bounds = getTaxYearBounds('2026-01-01')
    expect(bounds).toEqual({
      start: '2025-04-06',
      end: '2026-04-05',
    })
  })

  it('should handle 31 December correctly', () => {
    const bounds = getTaxYearBounds('2025-12-31')
    expect(bounds).toEqual({
      start: '2025-04-06',
      end: '2026-04-05',
    })
  })
})

describe('calculateHmrcRateSplit', () => {
  it('should apply standard rate when entirely below threshold', () => {
    const result = calculateHmrcRateSplit(0, 100)
    expect(result.milesAtStandardRate).toBe(100)
    expect(result.milesAtReducedRate).toBe(0)
    expect(result.amountDue).toBe(45) // 100 * 0.45
  })

  it('should apply reduced rate when entirely above threshold', () => {
    const result = calculateHmrcRateSplit(10000, 50)
    expect(result.milesAtStandardRate).toBe(0)
    expect(result.milesAtReducedRate).toBe(50)
    expect(result.amountDue).toBe(12.5) // 50 * 0.25
  })

  it('should correctly split a trip that crosses the threshold', () => {
    const result = calculateHmrcRateSplit(9950, 100)
    expect(result.milesAtStandardRate).toBe(50) // 10000 - 9950
    expect(result.milesAtReducedRate).toBe(50) // 100 - 50
    expect(result.amountDue).toBe(50 * 0.45 + 50 * 0.25) // 22.5 + 12.5 = 35
  })

  it('should handle trip that lands exactly at threshold', () => {
    const result = calculateHmrcRateSplit(9900, 100)
    expect(result.milesAtStandardRate).toBe(100)
    expect(result.milesAtReducedRate).toBe(0)
    expect(result.amountDue).toBe(45)
  })

  it('should handle cumulative exactly at threshold', () => {
    const result = calculateHmrcRateSplit(10000, 100)
    expect(result.milesAtStandardRate).toBe(0)
    expect(result.milesAtReducedRate).toBe(100)
    expect(result.amountDue).toBe(25)
  })

  it('should handle small trips below threshold', () => {
    const result = calculateHmrcRateSplit(5000, 2.4)
    expect(result.milesAtStandardRate).toBe(2.4)
    expect(result.milesAtReducedRate).toBe(0)
    expect(result.amountDue).toBe(1.08)
  })

  it('should handle 0 cumulative with large trip crossing threshold', () => {
    const result = calculateHmrcRateSplit(0, 12000)
    expect(result.milesAtStandardRate).toBe(10000)
    expect(result.milesAtReducedRate).toBe(2000)
    expect(result.amountDue).toBe(10000 * 0.45 + 2000 * 0.25) // 4500 + 500 = 5000
  })
})

describe('recalculateAllSplits', () => {
  it('should correctly split across multiple trips', () => {
    const trips = [
      { totalMiles: 5000 },
      { totalMiles: 4000 },
      { totalMiles: 2000 }, // This crosses the 10k threshold
      { totalMiles: 1000 }, // Entirely at reduced rate
    ]
    const splits = recalculateAllSplits(trips)

    // Trip 1: 0 -> 5000, all standard
    expect(splits[0].milesAtStandardRate).toBe(5000)
    expect(splits[0].milesAtReducedRate).toBe(0)
    expect(splits[0].amountDue).toBe(2250)

    // Trip 2: 5000 -> 9000, all standard
    expect(splits[1].milesAtStandardRate).toBe(4000)
    expect(splits[1].milesAtReducedRate).toBe(0)
    expect(splits[1].amountDue).toBe(1800)

    // Trip 3: 9000 -> 11000, crosses threshold at 10000
    expect(splits[2].milesAtStandardRate).toBe(1000) // 10000 - 9000
    expect(splits[2].milesAtReducedRate).toBe(1000) // 2000 - 1000
    expect(splits[2].amountDue).toBe(1000 * 0.45 + 1000 * 0.25) // 450 + 250 = 700

    // Trip 4: 11000 -> 12000, all reduced
    expect(splits[3].milesAtStandardRate).toBe(0)
    expect(splits[3].milesAtReducedRate).toBe(1000)
    expect(splits[3].amountDue).toBe(250)
  })

  it('should handle empty array', () => {
    const splits = recalculateAllSplits([])
    expect(splits).toEqual([])
  })

  it('should handle single trip', () => {
    const splits = recalculateAllSplits([{ totalMiles: 100 }])
    expect(splits).toHaveLength(1)
    expect(splits[0].milesAtStandardRate).toBe(100)
    expect(splits[0].amountDue).toBe(45)
  })
})

describe('constants', () => {
  it('should have correct HMRC rates', () => {
    expect(STANDARD_RATE).toBe(0.45)
    expect(REDUCED_RATE).toBe(0.25)
    expect(THRESHOLD_MILES).toBe(10000)
  })
})
