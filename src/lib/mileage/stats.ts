/**
 * Headline mileage totals for the trips page (spec 7.1): this quarter, this financial year
 * (1 January to 31 December), this tax year, and each active driver's miles left at the standard
 * rate. Never filtered, and always from one call to mileage_headline_totals_v01.
 *
 * Figures are whole tenths of a mile and whole pence (spec 4.2). The parser refuses anything
 * else, so the page shows an error rather than a wrong or blank total.
 */
import { z } from 'zod'

const wholeCount = z.number().int().nonnegative()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const periodSchema = z.object({
  from: isoDate,
  to: isoDate,
  trips: wholeCount,
  miles_tenths: wholeCount,
  amount_pence: wholeCount,
})

const statsSchema = z.object({
  quarter: periodSchema,
  financial_year: periodSchema,
  tax_year: periodSchema,
  drivers: z.array(
    z.object({
      driver_id: z.string().min(1),
      display_name: z.string().min(1),
      tax_year_miles_tenths: wholeCount,
      standard_miles_left_tenths: wholeCount,
    })
  ),
})

interface MileagePeriodTotals {
  /** First day, YYYY-MM-DD, inclusive. */
  from: string
  /** Last day, YYYY-MM-DD, inclusive. */
  to: string
  trips: number
  milesTenths: number
  amountPence: number
}

interface MileageDriverAllowance {
  driverId: string
  displayName: string
  taxYearMilesTenths: number
  standardMilesLeftTenths: number
}

export interface MileageHeadlineStats {
  quarter: MileagePeriodTotals
  financialYear: MileagePeriodTotals
  taxYear: MileagePeriodTotals
  /** Active drivers, ordered by name then id. */
  drivers: MileageDriverAllowance[]
}

function mapPeriod(period: z.infer<typeof periodSchema>): MileagePeriodTotals {
  return {
    from: period.from,
    to: period.to,
    trips: period.trips,
    milesTenths: period.miles_tenths,
    amountPence: period.amount_pence,
  }
}

/** Throws a ZodError when the database sends anything other than the expected shape. */
export function parseHeadlineStats(json: unknown): MileageHeadlineStats {
  const parsed = statsSchema.parse(json)
  return {
    quarter: mapPeriod(parsed.quarter),
    financialYear: mapPeriod(parsed.financial_year),
    taxYear: mapPeriod(parsed.tax_year),
    drivers: parsed.drivers.map((driver) => ({
      driverId: driver.driver_id,
      displayName: driver.display_name,
      taxYearMilesTenths: driver.tax_year_miles_tenths,
      standardMilesLeftTenths: driver.standard_miles_left_tenths,
    })),
  }
}
