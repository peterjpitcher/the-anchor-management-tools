/**
 * HMRC Mileage Rate Calculation Utility
 *
 * Tax year runs 6 April to 5 April (London timezone boundaries).
 * First 10,000 miles in a tax year: standard rate.
 * Miles above 10,000: reduced rate (£0.25/mile).
 *
 * The standard rate is date-aware:
 *   - Trips before 1 April 2026: £0.45/mile (legacy AMAP)
 *   - Trips on or after 1 April 2026: £0.55/mile
 */

/** Date from which the new HMRC standard rate applies (inclusive, YYYY-MM-DD). */
export const RATE_CHANGE_DATE = '2026-04-01'

/** Standard rate for trips before {@link RATE_CHANGE_DATE}. */
export const STANDARD_RATE_LEGACY = 0.45

/** Standard rate for trips on or after {@link RATE_CHANGE_DATE}. */
export const STANDARD_RATE_CURRENT = 0.55

const REDUCED_RATE = 0.25
const THRESHOLD_MILES = 10_000

/**
 * Current standard rate, retained for callers that unambiguously deal with new
 * trips (placeholders that will be overwritten by recalculation, "miles left"
 * hints, etc.). Date-sensitive call sites must use {@link getStandardRate}.
 */
const STANDARD_RATE = STANDARD_RATE_CURRENT

/**
 * Returns the HMRC standard rate that applies to a trip on the given date.
 * Relies on lexicographic comparison of zero-padded YYYY-MM-DD strings.
 */
export function getStandardRate(tripDate: string): number {
  return tripDate < RATE_CHANGE_DATE ? STANDARD_RATE_LEGACY : STANDARD_RATE_CURRENT
}

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
 * the miles for the current trip, and the trip date, calculate the HMRC rate
 * split. The trip's date selects the standard rate band (legacy vs current).
 */
export function calculateHmrcRateSplit(
  cumulativeMilesBefore: number,
  tripMiles: number,
  tripDate: string,
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

  const standardRate = getStandardRate(tripDate)
  const amountDue = round2(
    milesAtStandardRate * standardRate + milesAtReducedRate * REDUCED_RATE
  )

  return {
    milesAtStandardRate: round1(milesAtStandardRate),
    milesAtReducedRate: round1(milesAtReducedRate),
    amountDue,
  }
}

export interface RecalculateTripInput {
  totalMiles: number
  tripDate: string
}

/**
 * Recalculate rate splits for an ordered list of trips in a tax year.
 * Each trip receives updated milesAtStandardRate / milesAtReducedRate / amountDue,
 * applying the rate band appropriate to its trip date.
 * Returns a new array (does not mutate input).
 */
export function recalculateAllSplits(
  trips: ReadonlyArray<RecalculateTripInput>
): HmrcRateSplit[] {
  let cumulative = 0
  return trips.map((trip) => {
    const split = calculateHmrcRateSplit(cumulative, trip.totalMiles, trip.tripDate)
    cumulative += trip.totalMiles
    return split
  })
}

/** Stats about current tax year usage */
export interface TaxYearStats {
  quarterTotalMiles: number
  quarterAmountDue: number
  calendarYear: number
  calendarYearTotalMiles: number
  calendarYearAmountDue: number
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
