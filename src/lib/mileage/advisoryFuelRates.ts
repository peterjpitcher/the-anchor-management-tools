/**
 * HMRC advisory fuel rates in pence per mile. They are used only to work out the fuel element of
 * mileage for VAT (VAT Notice 700/64, section 9) and are never stored on trips.
 *
 * Sources (spec section 3.2): gov.uk "Advisory fuel rates" as published on 15 September 2026,
 * for December 2024 onwards, and the Internet Archive capture of that page from 20 November
 * 2024, for earlier periods.
 *
 * HMRC reviews the rates every quarter (1 March, 1 June, 1 September, 1 December), so the newest
 * period ends when its quarter ends. A trip after the last period gets no rate, and the report
 * lists it rather than reusing old rates. To add a quarter, append a period and change nothing
 * else. Before September 2025 HMRC published one electric rate, recorded here as both the home
 * and the public rate.
 */

import type { FuelType } from '@/lib/mileage/driver-setup'

export interface AdvisoryFuelRatePeriod {
  validFrom: string
  validTo: string
  /** 1400cc or less, 1401cc to 2000cc, over 2000cc. */
  petrol: readonly [number, number, number]
  /** 1400cc or less, 1401cc to 2000cc, over 2000cc. */
  lpg: readonly [number, number, number]
  /** 1600cc or less, 1601cc to 2000cc, over 2000cc. */
  diesel: readonly [number, number, number]
  electricHome: number
  electricPublic: number
}

export const ADVISORY_FUEL_RATE_PERIODS: readonly AdvisoryFuelRatePeriod[] = [
  { validFrom: '2023-12-01', validTo: '2024-02-29', petrol: [14, 16, 26], lpg: [10, 12, 18], diesel: [13, 15, 20], electricHome: 9, electricPublic: 9 },
  { validFrom: '2024-03-01', validTo: '2024-05-31', petrol: [13, 15, 24], lpg: [11, 13, 21], diesel: [12, 14, 19], electricHome: 9, electricPublic: 9 },
  { validFrom: '2024-06-01', validTo: '2024-08-31', petrol: [14, 16, 26], lpg: [11, 13, 21], diesel: [13, 15, 20], electricHome: 8, electricPublic: 8 },
  { validFrom: '2024-09-01', validTo: '2024-11-30', petrol: [13, 15, 24], lpg: [11, 13, 21], diesel: [12, 14, 18], electricHome: 7, electricPublic: 7 },
  { validFrom: '2024-12-01', validTo: '2025-02-28', petrol: [12, 14, 23], lpg: [11, 13, 21], diesel: [11, 13, 17], electricHome: 7, electricPublic: 7 },
  { validFrom: '2025-03-01', validTo: '2025-05-31', petrol: [12, 15, 23], lpg: [11, 13, 21], diesel: [12, 13, 17], electricHome: 7, electricPublic: 7 },
  { validFrom: '2025-06-01', validTo: '2025-08-31', petrol: [12, 14, 22], lpg: [11, 13, 21], diesel: [11, 13, 17], electricHome: 7, electricPublic: 7 },
  { validFrom: '2025-09-01', validTo: '2025-11-30', petrol: [12, 14, 22], lpg: [11, 13, 21], diesel: [12, 13, 18], electricHome: 8, electricPublic: 14 },
  { validFrom: '2025-12-01', validTo: '2026-02-28', petrol: [12, 14, 22], lpg: [11, 13, 21], diesel: [12, 13, 18], electricHome: 7, electricPublic: 14 },
  { validFrom: '2026-03-01', validTo: '2026-05-31', petrol: [12, 14, 22], lpg: [10, 12, 19], diesel: [12, 13, 18], electricHome: 7, electricPublic: 15 },
  { validFrom: '2026-06-01', validTo: '2026-08-31', petrol: [14, 17, 26], lpg: [11, 13, 21], diesel: [15, 17, 23], electricHome: 7, electricPublic: 15 },
  { validFrom: '2026-09-01', validTo: '2026-11-30', petrol: [14, 17, 27], lpg: [11, 13, 20], diesel: [15, 16, 22], electricHome: 7, electricPublic: 15 },
]

export type FuelRateLookup =
  | { status: 'priced'; pencePerMile: number; periodValidFrom: string }
  | { status: 'missing_rate' }

function requireEngineCc(fuelType: FuelType, engineCc: number | null): number {
  if (engineCc === null) {
    throw new Error(`A ${fuelType} car needs an engine size`)
  }
  return engineCc
}

export function getAdvisoryFuelRate(input: {
  tripDate: string
  fuelType: FuelType
  engineCc: number | null
}): FuelRateLookup {
  const period = ADVISORY_FUEL_RATE_PERIODS.find(
    (candidate) => candidate.validFrom <= input.tripDate && input.tripDate <= candidate.validTo
  )
  if (!period) return { status: 'missing_rate' }

  const priced = (pencePerMile: number): FuelRateLookup => ({
    status: 'priced',
    pencePerMile,
    periodValidFrom: period.validFrom,
  })

  switch (input.fuelType) {
    case 'electric_home':
      return priced(period.electricHome)
    case 'electric_public':
      return priced(period.electricPublic)
    case 'petrol':
    case 'lpg': {
      const cc = requireEngineCc(input.fuelType, input.engineCc)
      const band = cc <= 1400 ? 0 : cc <= 2000 ? 1 : 2
      return priced(period[input.fuelType][band])
    }
    case 'diesel': {
      const cc = requireEngineCc(input.fuelType, input.engineCc)
      const band = cc <= 1600 ? 0 : cc <= 2000 ? 1 : 2
      return priced(period.diesel[band])
    }
  }
}
