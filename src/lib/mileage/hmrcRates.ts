/**
 * HMRC approved mileage allowance payments (AMAP) for cars and vans.
 *
 * Rates come from an append-only schedule. A new HMRC rate is a new period; old periods are
 * never edited, so every trip keeps the rate that applied on its date. The SQL function
 * mileage_amap_rates_v01 mirrors this schedule, and tests/fixtures/mileage/amap-rate-cases.json
 * checks both.
 *
 * Money is worked in whole numbers: tenths of a mile and pence (spec section 4.2).
 * Tax year: 6 April to 5 April. Source for 55p from 6 April 2026: gov.uk "Travel: mileage and
 * fuel rates and allowances", announced 21 May 2026.
 */

export interface AmapRatePeriod {
  /** First day the rates apply, YYYY-MM-DD, inclusive. */
  validFrom: string
  standardPence: number
  reducedPence: number
  thresholdMiles: number
}

export const AMAP_RATE_PERIODS: readonly AmapRatePeriod[] = [
  { validFrom: '2023-04-06', standardPence: 45, reducedPence: 25, thresholdMiles: 10_000 },
  { validFrom: '2026-04-06', standardPence: 55, reducedPence: 25, thresholdMiles: 10_000 },
]

const LATEST_PERIOD = AMAP_RATE_PERIODS[AMAP_RATE_PERIODS.length - 1]

/** First date priced at 55p. Kept for the export code that labels the two standard rates. */
export const RATE_CHANGE_DATE = LATEST_PERIOD.validFrom
export const STANDARD_RATE_LEGACY = AMAP_RATE_PERIODS[0].standardPence / 100
export const STANDARD_RATE_CURRENT = LATEST_PERIOD.standardPence / 100
export const REDUCED_RATE = LATEST_PERIOD.reducedPence / 100
export const THRESHOLD_MILES = LATEST_PERIOD.thresholdMiles

export class MileageRateMissingError extends Error {
  constructor(public readonly tripDate: string) {
    super(`No mileage allowance rate is defined for ${tripDate}`)
    this.name = 'MileageRateMissingError'
  }
}

/** The AMAP period in force on a trip date. Throws for dates before the schedule starts. */
export function getAmapRates(tripDate: string): AmapRatePeriod {
  let match: AmapRatePeriod | null = null
  for (const period of AMAP_RATE_PERIODS) {
    if (period.validFrom <= tripDate) match = period
  }
  if (!match) throw new MileageRateMissingError(tripDate)
  return match
}

/** Standard rate in pounds, for labels. 0.45 or 0.55. */
export function getStandardRate(tripDate: string): number {
  return getAmapRates(tripDate).standardPence / 100
}

export interface TaxYearBounds {
  /** YYYY-MM-DD, e.g. '2025-04-06' */
  start: string
  /** YYYY-MM-DD, e.g. '2026-04-05' */
  end: string
}

/** The tax year (6 April to 5 April) containing a YYYY-MM-DD date. */
export function getTaxYearBounds(tripDate: string): TaxYearBounds {
  const [yearStr, monthStr, dayStr] = tripDate.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)
  const startYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1
  return { start: `${startYear}-04-06`, end: `${startYear + 1}-04-05` }
}

/** Miles held to one decimal place, as whole tenths. 3.4 becomes 34. */
function milesToTenths(miles: number): number {
  return Math.round(miles * 10)
}

function tenthsToMiles(tenths: number): number {
  return tenths / 10
}

/** Rounds a non-negative whole number of tenths of a penny to pence, half up. */
export function roundTenthPenceHalfUp(tenthPence: number): number {
  if (!Number.isInteger(tenthPence) || tenthPence < 0) {
    throw new Error(`Expected a non-negative whole number of tenths of a penny, got ${tenthPence}`)
  }
  return Math.floor((tenthPence + 5) / 10)
}

export interface TripSplit {
  standardTenths: number
  reducedTenths: number
  amountPence: number
}

/**
 * Splits one trip at its group's 10,000-mile threshold and prices it (spec 4.2 steps 1 and 2).
 * `tenthsBefore` is the group's running total before this trip.
 */
export function calculateTripSplit(input: {
  tripDate: string
  tenthsBefore: number
  tripTenths: number
}): TripSplit {
  const rates = getAmapRates(input.tripDate)
  const thresholdTenths = rates.thresholdMiles * 10
  const standardTenths = Math.max(0, Math.min(input.tripTenths, thresholdTenths - input.tenthsBefore))
  const reducedTenths = input.tripTenths - standardTenths
  const amountPence = roundTenthPenceHalfUp(
    standardTenths * rates.standardPence + reducedTenths * rates.reducedPence
  )
  return { standardTenths, reducedTenths, amountPence }
}

export interface TripBandPence {
  standardBandPence: number
  reducedBandPence: number
}

/** Allocates a stored trip amount to its bands so band totals add up to the claim (spec 4.2 step 3). */
export function allocateTripBandPence(input: {
  tripDate: string
  standardTenths: number
  amountPence: number
}): TripBandPence {
  const rates = getAmapRates(input.tripDate)
  const standardBandPence = Math.min(
    input.amountPence,
    roundTenthPenceHalfUp(input.standardTenths * rates.standardPence)
  )
  return { standardBandPence, reducedBandPence: input.amountPence - standardBandPence }
}

export interface HmrcRateSplit {
  milesAtStandardRate: number
  milesAtReducedRate: number
  amountDue: number
}

/** The trip form preview in miles and pounds, derived from the whole-number rules. */
export function calculateHmrcRateSplit(
  cumulativeMilesBefore: number,
  tripMiles: number,
  tripDate: string
): HmrcRateSplit {
  const split = calculateTripSplit({
    tripDate,
    tenthsBefore: milesToTenths(cumulativeMilesBefore),
    tripTenths: milesToTenths(tripMiles),
  })
  return {
    milesAtStandardRate: tenthsToMiles(split.standardTenths),
    milesAtReducedRate: tenthsToMiles(split.reducedTenths),
    amountDue: split.amountPence / 100,
  }
}
