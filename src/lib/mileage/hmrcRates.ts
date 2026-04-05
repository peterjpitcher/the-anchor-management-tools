/**
 * HMRC Mileage Rate Calculation Utility
 *
 * Tax year runs 6 April to 5 April (London timezone boundaries).
 * First 10,000 miles in a tax year: standard rate (£0.45/mile).
 * Miles above 10,000: reduced rate (£0.25/mile).
 */

const STANDARD_RATE = 0.45
const REDUCED_RATE = 0.25
const THRESHOLD_MILES = 10_000

export interface HmrcRateSplit {
  milesAtStandardRate: number
  milesAtReducedRate: number
  amountDue: number
}

export interface TaxYearBounds {
  /** YYYY-MM-DD, e.g. '2025-04-06' */
  start: string
  /** YYYY-MM-DD, e.g. '2026-04-05' */
  end: string
}

/**
 * Returns the tax year start/end dates for a given trip date (YYYY-MM-DD).
 * Tax year: 6 April to 5 April.
 * e.g. trip on 2026-01-15 => TY 2025-04-06 to 2026-04-05
 *      trip on 2026-04-06 => TY 2026-04-06 to 2027-04-05
 *      trip on 2026-04-05 => TY 2025-04-06 to 2026-04-05
 */
export function getTaxYearBounds(tripDate: string): TaxYearBounds {
  const [yearStr, monthStr, dayStr] = tripDate.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)

  // If date is on or after 6 April, the tax year started this calendar year.
  // If date is before 6 April, the tax year started last calendar year.
  const taxYearStartYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1

  return {
    start: `${taxYearStartYear}-04-06`,
    end: `${taxYearStartYear + 1}-04-05`,
  }
}

/**
 * Given cumulative miles already claimed in the tax year BEFORE this trip,
 * and the miles for the current trip, calculate the HMRC rate split.
 */
export function calculateHmrcRateSplit(
  cumulativeMilesBefore: number,
  tripMiles: number
): HmrcRateSplit {
  const totalAfter = cumulativeMilesBefore + tripMiles

  let milesAtStandardRate: number
  let milesAtReducedRate: number

  if (cumulativeMilesBefore >= THRESHOLD_MILES) {
    // Already past threshold: all at reduced rate
    milesAtStandardRate = 0
    milesAtReducedRate = tripMiles
  } else if (totalAfter <= THRESHOLD_MILES) {
    // Entirely within standard rate
    milesAtStandardRate = tripMiles
    milesAtReducedRate = 0
  } else {
    // Trip crosses the threshold
    milesAtStandardRate = THRESHOLD_MILES - cumulativeMilesBefore
    milesAtReducedRate = tripMiles - milesAtStandardRate
  }

  const amountDue = round2(
    milesAtStandardRate * STANDARD_RATE + milesAtReducedRate * REDUCED_RATE
  )

  return {
    milesAtStandardRate: round1(milesAtStandardRate),
    milesAtReducedRate: round1(milesAtReducedRate),
    amountDue,
  }
}

/**
 * Recalculate rate splits for an ordered list of trips in a tax year.
 * Each trip receives updated milesAtStandardRate / milesAtReducedRate / amountDue.
 * Returns a new array (does not mutate input).
 */
export function recalculateAllSplits(
  trips: Array<{ totalMiles: number }>
): HmrcRateSplit[] {
  let cumulative = 0
  return trips.map((trip) => {
    const split = calculateHmrcRateSplit(cumulative, trip.totalMiles)
    cumulative += trip.totalMiles
    return split
  })
}

/** Stats about current tax year usage */
export interface TaxYearStats {
  quarterTotalMiles: number
  quarterAmountDue: number
  taxYearTotalMiles: number
  taxYearAmountDue: number
  milesToThreshold: number
}

export { STANDARD_RATE, REDUCED_RATE, THRESHOLD_MILES }

// ---- helpers ----

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
