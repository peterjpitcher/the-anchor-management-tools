import { describe, it, expect } from 'vitest'
import {
  getTaxYearBounds,
  calculateHmrcRateSplit,
  recalculateAllSplits,
  getStandardRate,
  STANDARD_RATE,
  STANDARD_RATE_LEGACY,
  STANDARD_RATE_CURRENT,
  REDUCED_RATE,
  THRESHOLD_MILES,
  RATE_CHANGE_DATE,
} from '../hmrcRates'

// Convenience trip dates picked to stay clear of the 2026-04-01 rate change.
const LEGACY_DATE = '2025-09-15'
const CURRENT_DATE = '2026-06-15'

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

describe('getStandardRate', () => {
  it('returns legacy rate for dates before the change', () => {
    expect(getStandardRate('2025-01-01')).toBe(STANDARD_RATE_LEGACY)
    expect(getStandardRate('2026-03-31')).toBe(STANDARD_RATE_LEGACY)
  })

  it('returns current rate from the change date onwards', () => {
    expect(getStandardRate('2026-04-01')).toBe(STANDARD_RATE_CURRENT)
    expect(getStandardRate('2026-04-02')).toBe(STANDARD_RATE_CURRENT)
    expect(getStandardRate('2027-12-31')).toBe(STANDARD_RATE_CURRENT)
  })
})

describe('calculateHmrcRateSplit (legacy rate, before 2026-04-01)', () => {
  it('should apply legacy standard rate when entirely below threshold', () => {
    const result = calculateHmrcRateSplit(0, 100, LEGACY_DATE)
    expect(result.milesAtStandardRate).toBe(100)
    expect(result.milesAtReducedRate).toBe(0)
    expect(result.amountDue).toBe(45) // 100 * 0.45
  })

  it('should apply reduced rate when entirely above threshold', () => {
    const result = calculateHmrcRateSplit(10000, 50, LEGACY_DATE)
    expect(result.milesAtStandardRate).toBe(0)
    expect(result.milesAtReducedRate).toBe(50)
    expect(result.amountDue).toBe(12.5) // 50 * 0.25
  })

  it('should correctly split a trip that crosses the threshold', () => {
    const result = calculateHmrcRateSplit(9950, 100, LEGACY_DATE)
    expect(result.milesAtStandardRate).toBe(50)
    expect(result.milesAtReducedRate).toBe(50)
    expect(result.amountDue).toBe(50 * 0.45 + 50 * 0.25) // 22.5 + 12.5 = 35
  })

  it('should handle 0 cumulative with large trip crossing threshold', () => {
    const result = calculateHmrcRateSplit(0, 12000, LEGACY_DATE)
    expect(result.milesAtStandardRate).toBe(10000)
    expect(result.milesAtReducedRate).toBe(2000)
    expect(result.amountDue).toBe(10000 * 0.45 + 2000 * 0.25) // 4500 + 500 = 5000
  })
})

describe('calculateHmrcRateSplit (current rate, from 2026-04-01)', () => {
  it('should apply current standard rate when entirely below threshold', () => {
    const result = calculateHmrcRateSplit(0, 100, CURRENT_DATE)
    expect(result.milesAtStandardRate).toBe(100)
    expect(result.milesAtReducedRate).toBe(0)
    expect(result.amountDue).toBe(55) // 100 * 0.55
  })

  it('should still use reduced rate above the threshold', () => {
    const result = calculateHmrcRateSplit(10000, 50, CURRENT_DATE)
    expect(result.milesAtStandardRate).toBe(0)
    expect(result.milesAtReducedRate).toBe(50)
    expect(result.amountDue).toBe(12.5)
  })

  it('should split a threshold-crossing trip with the current rate', () => {
    const result = calculateHmrcRateSplit(9950, 100, CURRENT_DATE)
    expect(result.milesAtStandardRate).toBe(50)
    expect(result.milesAtReducedRate).toBe(50)
    expect(result.amountDue).toBe(50 * 0.55 + 50 * 0.25) // 27.5 + 12.5 = 40
  })

  it('handles 0 cumulative with large trip crossing threshold', () => {
    const result = calculateHmrcRateSplit(0, 12000, CURRENT_DATE)
    expect(result.milesAtStandardRate).toBe(10000)
    expect(result.milesAtReducedRate).toBe(2000)
    expect(result.amountDue).toBe(10000 * 0.55 + 2000 * 0.25) // 5500 + 500 = 6000
  })
})

describe('calculateHmrcRateSplit (rate change boundary)', () => {
  it('uses legacy rate on 31 March 2026', () => {
    const result = calculateHmrcRateSplit(0, 100, '2026-03-31')
    expect(result.amountDue).toBe(45)
  })

  it('uses current rate on 1 April 2026', () => {
    const result = calculateHmrcRateSplit(0, 100, '2026-04-01')
    expect(result.amountDue).toBe(55)
  })

  it('uses current rate on 2 April 2026', () => {
    const result = calculateHmrcRateSplit(0, 100, '2026-04-02')
    expect(result.amountDue).toBe(55)
  })
})

describe('recalculateAllSplits', () => {
  it('applies the legacy rate to all trips when every date is pre-change', () => {
    const trips = [
      { totalMiles: 5000, tripDate: '2025-05-01' },
      { totalMiles: 4000, tripDate: '2025-08-01' },
      { totalMiles: 2000, tripDate: '2025-11-15' }, // crosses threshold
      { totalMiles: 1000, tripDate: '2026-02-10' }, // all reduced
    ]
    const splits = recalculateAllSplits(trips)

    expect(splits[0].amountDue).toBe(2250) // 5000 * 0.45
    expect(splits[1].amountDue).toBe(1800) // 4000 * 0.45
    expect(splits[2].amountDue).toBe(1000 * 0.45 + 1000 * 0.25) // 700
    expect(splits[3].amountDue).toBe(250) // 1000 * 0.25
  })

  it('applies the current rate to all trips when every date is post-change', () => {
    const trips = [
      { totalMiles: 5000, tripDate: '2026-05-01' },
      { totalMiles: 4000, tripDate: '2026-07-01' },
      { totalMiles: 2000, tripDate: '2026-09-15' }, // crosses threshold
      { totalMiles: 1000, tripDate: '2026-12-10' }, // all reduced
    ]
    const splits = recalculateAllSplits(trips)

    expect(splits[0].amountDue).toBe(2750) // 5000 * 0.55
    expect(splits[1].amountDue).toBe(2200) // 4000 * 0.55
    expect(splits[2].amountDue).toBe(1000 * 0.55 + 1000 * 0.25) // 800
    expect(splits[3].amountDue).toBe(250) // 1000 * 0.25
  })

  it('mixes legacy and current rates within the same tax year', () => {
    // Tax year 2025/26 spans 6 April 2025 -> 5 April 2026; the rate change
    // happens on 1 April 2026, so the last 5 days of the year are at the new
    // standard rate.
    const trips = [
      { totalMiles: 100, tripDate: '2025-09-01' }, // legacy
      { totalMiles: 100, tripDate: '2026-04-02' }, // current
    ]
    const splits = recalculateAllSplits(trips)

    expect(splits[0].amountDue).toBe(45) // 100 * 0.45
    expect(splits[1].amountDue).toBe(55) // 100 * 0.55
  })

  it('handles empty array', () => {
    const splits = recalculateAllSplits([])
    expect(splits).toEqual([])
  })

  it('handles single legacy-rate trip', () => {
    const splits = recalculateAllSplits([{ totalMiles: 100, tripDate: LEGACY_DATE }])
    expect(splits).toHaveLength(1)
    expect(splits[0].milesAtStandardRate).toBe(100)
    expect(splits[0].amountDue).toBe(45)
  })

  it('handles single current-rate trip', () => {
    const splits = recalculateAllSplits([{ totalMiles: 100, tripDate: CURRENT_DATE }])
    expect(splits).toHaveLength(1)
    expect(splits[0].milesAtStandardRate).toBe(100)
    expect(splits[0].amountDue).toBe(55)
  })
})

describe('constants', () => {
  it('exposes the rate-change date', () => {
    expect(RATE_CHANGE_DATE).toBe('2026-04-01')
  })

  it('has correct HMRC rates', () => {
    expect(STANDARD_RATE_LEGACY).toBe(0.45)
    expect(STANDARD_RATE_CURRENT).toBe(0.55)
    expect(STANDARD_RATE).toBe(STANDARD_RATE_CURRENT)
    expect(REDUCED_RATE).toBe(0.25)
    expect(THRESHOLD_MILES).toBe(10000)
  })
})
