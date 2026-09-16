import { describe, expect, it } from 'vitest'
import { parseHeadlineStats } from '@/lib/mileage/stats'

// The shape mileage_headline_totals_v01 returns (see tests/sql/mileage/driver-cutover.test.sql).
function databaseTotals(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quarter: { from: '2026-04-01', to: '2026-06-30', trips: 3, miles_tenths: 130, amount_pence: 715 },
    financial_year: { from: '2026-01-01', to: '2026-12-31', trips: 6, miles_tenths: 220, amount_pence: 1150 },
    tax_year: { from: '2026-04-06', to: '2027-04-05', trips: 5, miles_tenths: 200, amount_pence: 1100 },
    drivers: [
      { driver_id: 'driver-one', display_name: 'Driver One', tax_year_miles_tenths: 140, standard_miles_left_tenths: 99860 },
      { driver_id: 'driver-two', display_name: 'Driver Two', tax_year_miles_tenths: 100005, standard_miles_left_tenths: 0 },
    ],
    ...overrides,
  }
}

describe('parseHeadlineStats', () => {
  it('maps the database totals to whole tenths and pence, keeping the drivers in order', () => {
    expect(parseHeadlineStats(databaseTotals())).toEqual({
      quarter: { from: '2026-04-01', to: '2026-06-30', trips: 3, milesTenths: 130, amountPence: 715 },
      financialYear: { from: '2026-01-01', to: '2026-12-31', trips: 6, milesTenths: 220, amountPence: 1150 },
      taxYear: { from: '2026-04-06', to: '2027-04-05', trips: 5, milesTenths: 200, amountPence: 1100 },
      drivers: [
        { driverId: 'driver-one', displayName: 'Driver One', taxYearMilesTenths: 140, standardMilesLeftTenths: 99860 },
        { driverId: 'driver-two', displayName: 'Driver Two', taxYearMilesTenths: 100005, standardMilesLeftTenths: 0 },
      ],
    })
  })

  it('accepts no active drivers', () => {
    expect(parseHeadlineStats(databaseTotals({ drivers: [] })).drivers).toEqual([])
  })

  it.each([
    ['nothing at all', null],
    ['a missing period', databaseTotals({ tax_year: undefined })],
    ['miles sent as text', databaseTotals({ quarter: { from: '2026-04-01', to: '2026-06-30', trips: 3, miles_tenths: '130', amount_pence: 715 } })],
    ['part of a penny', databaseTotals({ quarter: { from: '2026-04-01', to: '2026-06-30', trips: 3, miles_tenths: 130, amount_pence: 715.5 } })],
    ['a negative total', databaseTotals({ quarter: { from: '2026-04-01', to: '2026-06-30', trips: 3, miles_tenths: -1, amount_pence: 715 } })],
    ['a date that is not YYYY-MM-DD', databaseTotals({ quarter: { from: '1 April 2026', to: '2026-06-30', trips: 3, miles_tenths: 130, amount_pence: 715 } })],
    ['a driver without miles left', databaseTotals({ drivers: [{ driver_id: 'driver-one', display_name: 'Driver One', tax_year_miles_tenths: 140 }] })],
    ['a driver without a name', databaseTotals({ drivers: [{ driver_id: 'driver-one', display_name: '', tax_year_miles_tenths: 140, standard_miles_left_tenths: 99860 }] })],
  ])('refuses %s rather than showing a wrong or blank total', (_label, json) => {
    expect(() => parseHeadlineStats(json)).toThrow()
  })
})
