import { describe, expect, it } from 'vitest'
import { ADVISORY_FUEL_RATE_PERIODS, getAdvisoryFuelRate } from '@/lib/mileage/advisoryFuelRates'
import { shiftIsoDate } from '@/lib/dateUtils'

describe('advisory fuel rate periods', () => {
  it('run back to back with no gaps or overlaps', () => {
    for (let index = 1; index < ADVISORY_FUEL_RATE_PERIODS.length; index++) {
      expect(ADVISORY_FUEL_RATE_PERIODS[index].validFrom).toBe(
        shiftIsoDate(ADVISORY_FUEL_RATE_PERIODS[index - 1].validTo, 1)
      )
    }
  })

  it('cover every trip from 1 January 2024', () => {
    expect(ADVISORY_FUEL_RATE_PERIODS[0].validFrom <= '2024-01-01').toBe(true)
  })
})

describe('getAdvisoryFuelRate', () => {
  it.each([
    ['2026-09-15', 'petrol', 1598, 17],
    ['2026-09-15', 'diesel', 1995, 16],
    ['2026-09-15', 'lpg', 2500, 20],
    ['2023-12-25', 'lpg', 2500, 18],
    ['2024-07-01', 'diesel', 2200, 20],
    ['2025-10-01', 'electric_public', null, 14],
    ['2025-10-01', 'electric_home', null, 8],
    ['2025-08-31', 'electric_public', null, 7],
    ['2026-04-04', 'petrol', 1400, 12],
  ] as const)('on %s a %s car of %s cc is %i pence', (tripDate, fuelType, engineCc, pence) => {
    expect(getAdvisoryFuelRate({ tripDate, fuelType, engineCc })).toMatchObject({ status: 'priced', pencePerMile: pence })
  })

  it('puts petrol engines of 1400, 1401, 2000 and 2001 cc in the right bands', () => {
    const rate = (engineCc: number) => getAdvisoryFuelRate({ tripDate: '2026-09-15', fuelType: 'petrol', engineCc })
    expect([rate(1400), rate(1401), rate(2000), rate(2001)].map((lookup) => (lookup.status === 'priced' ? lookup.pencePerMile : null))).toEqual([14, 17, 17, 27])
  })

  it('puts diesel engines of 1600 and 1601 cc in different bands', () => {
    const rate = (engineCc: number) => getAdvisoryFuelRate({ tripDate: '2026-09-15', fuelType: 'diesel', engineCc })
    expect([rate(1600), rate(1601)].map((lookup) => (lookup.status === 'priced' ? lookup.pencePerMile : null))).toEqual([15, 16])
  })

  it('has no rate before the first period or after the last', () => {
    expect(getAdvisoryFuelRate({ tripDate: '2023-11-30', fuelType: 'petrol', engineCc: 1400 })).toEqual({ status: 'missing_rate' })
    expect(getAdvisoryFuelRate({ tripDate: '2026-12-01', fuelType: 'petrol', engineCc: 1400 })).toEqual({ status: 'missing_rate' })
  })

  it('refuses a petrol car without an engine size', () => {
    expect(() => getAdvisoryFuelRate({ tripDate: '2026-09-15', fuelType: 'petrol', engineCc: null })).toThrow('needs an engine size')
  })
})
