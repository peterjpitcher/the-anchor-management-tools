import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  AMAP_RATE_PERIODS,
  allocateTripBandPence,
  calculateHmrcRateSplit,
  calculateTripSplit,
  getAmapRates,
  getStandardRate,
  getTaxYearBounds,
  MileageRateMissingError,
  RATE_CHANGE_DATE,
  roundTenthPenceHalfUp,
} from '../hmrcRates'

interface RateCase {
  tripDate: string
  standardPence: number | null
  reducedPence: number | null
  thresholdMiles: number | null
}

interface SplitCase {
  name: string
  tripDate: string
  tenthsBefore: number
  tripTenths: number
  standardTenths: number
  reducedTenths: number
  amountPence: number
  standardBandPence: number
  reducedBandPence: number
}

const fixture = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/mileage/amap-rate-cases.json'), 'utf8')
) as { rates: RateCase[]; splits: SplitCase[] }

describe('AMAP rate schedule', () => {
  it('starts 55p on 6 April 2026, not 1 April', () => {
    expect(RATE_CHANGE_DATE).toBe('2026-04-06')
    expect(getStandardRate('2026-04-05')).toBe(0.45)
    expect(getStandardRate('2026-04-06')).toBe(0.55)
  })

  it('keeps periods in ascending date order', () => {
    const dates = AMAP_RATE_PERIODS.map((period) => period.validFrom)
    expect([...dates].sort()).toEqual(dates)
  })

  it.each(fixture.rates)('matches the shared fixture on $tripDate', (rateCase) => {
    if (rateCase.standardPence === null) {
      expect(() => getAmapRates(rateCase.tripDate)).toThrow(MileageRateMissingError)
      return
    }
    expect(getAmapRates(rateCase.tripDate)).toMatchObject({
      standardPence: rateCase.standardPence,
      reducedPence: rateCase.reducedPence,
      thresholdMiles: rateCase.thresholdMiles,
    })
  })
})

describe('whole-number arithmetic', () => {
  it('rounds half a penny up', () => {
    expect(roundTenthPenceHalfUp(45)).toBe(5)
    expect(roundTenthPenceHalfUp(44)).toBe(4)
    expect(roundTenthPenceHalfUp(55)).toBe(6)
    expect(roundTenthPenceHalfUp(0)).toBe(0)
  })

  it('refuses fractions and negatives', () => {
    expect(() => roundTenthPenceHalfUp(4.5)).toThrow()
    expect(() => roundTenthPenceHalfUp(-1)).toThrow()
  })

  it.each(fixture.splits)('$name', (splitCase) => {
    const split = calculateTripSplit({
      tripDate: splitCase.tripDate,
      tenthsBefore: splitCase.tenthsBefore,
      tripTenths: splitCase.tripTenths,
    })
    expect(split).toEqual({
      standardTenths: splitCase.standardTenths,
      reducedTenths: splitCase.reducedTenths,
      amountPence: splitCase.amountPence,
    })
    expect(
      allocateTripBandPence({
        tripDate: splitCase.tripDate,
        standardTenths: split.standardTenths,
        amountPence: split.amountPence,
      })
    ).toEqual({
      standardBandPence: splitCase.standardBandPence,
      reducedBandPence: splitCase.reducedBandPence,
    })
  })

  it('keeps the trip form preview in miles and pounds', () => {
    expect(calculateHmrcRateSplit(9999, 2, '2026-05-01')).toEqual({
      milesAtStandardRate: 1,
      milesAtReducedRate: 1,
      amountDue: 0.8,
    })
  })
})

describe('getTaxYearBounds', () => {
  it('starts the tax year on 6 April', () => {
    expect(getTaxYearBounds('2026-04-06')).toEqual({ start: '2026-04-06', end: '2027-04-05' })
  })

  it('ends the tax year on 5 April', () => {
    expect(getTaxYearBounds('2026-04-05')).toEqual({ start: '2025-04-06', end: '2026-04-05' })
  })

  it('handles a January date', () => {
    expect(getTaxYearBounds('2026-01-15')).toEqual({ start: '2025-04-06', end: '2026-04-05' })
  })
})
