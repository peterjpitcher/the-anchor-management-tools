/**
 * Mileage CSV (spec 6.3), used by the receipts pack and the /mileage export. The caller passes
 * the trips to export and their totals, so the summary always reconciles to the rows below it.
 */

import { buildCsvBuffer, escapeCsvCell, formatDateDdMmYyyy } from '@/lib/receipts/export/csv-helpers'
import { getAmapRates } from '@/lib/mileage/hmrcRates'
import type { MileageDriverBasis, MileageReportTrip } from './dataset'
import { describeTripRoute, type ReportDriverSummary, type ReportTotals } from './model'
import { formatGeneratedAt, formatPlainMiles, formatPlainPounds } from './format'

/** Report wording for how each trip's driver is known (spec 5.2). */
export const DRIVER_BASIS_LABELS: Record<MileageDriverBasis, string> = {
  entered: 'Recorded when logged',
  owner_statement: "Owner's statement, 15 Sep 2026",
  oj_projects: 'OJ Projects trip',
}

export interface MileageCsvInput {
  periodLabel: string
  generatedAt: string
  scopeLines: string[]
  trips: MileageReportTrip[]
  totals: ReportTotals
  byDriver: ReportDriverSummary[]
}

const HEADER = [
  'Date', 'Driver', 'Driver basis', 'Reason', 'Route', 'Start postcode', 'End postcode', 'Total miles',
  'Standard-rate miles', 'Standard rate (p)', 'Reduced-rate miles', 'Reduced rate (p)', 'Amount (£)', 'Source',
  'OJ project', 'OJ client',
]

export function buildMileageCsv(input: MileageCsvInput): Buffer {
  const summary: string[][] = [
    ['Report', 'Mileage claim report'],
    ['Period', input.periodLabel],
    ['Generated', formatGeneratedAt(input.generatedAt)],
    // Scope lines can carry driver names and Release 5 search text, so they are protected too.
    ['Scope', escapeCsvCell(input.scopeLines.join('; '))],
    ['Trips', String(input.totals.trips)],
    ['Total miles', formatPlainMiles(input.totals.milesTenths)],
    ['Total claim (£)', formatPlainPounds(input.totals.amountPence)],
    ...input.byDriver.map((driver) => [`Claim for ${escapeCsvCell(driver.driverName)} (£)`, formatPlainPounds(driver.amountPence)]),
    [],
  ]

  const rows = input.trips.map((trip) => {
    const rates = getAmapRates(trip.tripDate)
    const firstLeg = trip.legs[0]
    const lastLeg = trip.legs[trip.legs.length - 1]
    return [
      formatDateDdMmYyyy(trip.tripDate),
      escapeCsvCell(trip.driverName),
      DRIVER_BASIS_LABELS[trip.driverBasis],
      escapeCsvCell(trip.description?.trim() || 'Not recorded'),
      escapeCsvCell(describeTripRoute(trip)),
      escapeCsvCell(firstLeg?.fromPostcode ?? ''),
      escapeCsvCell(lastLeg?.toPostcode ?? ''),
      formatPlainMiles(trip.totalMilesTenths),
      formatPlainMiles(trip.standardMilesTenths),
      String(rates.standardPence),
      formatPlainMiles(trip.reducedMilesTenths),
      String(rates.reducedPence),
      formatPlainPounds(trip.amountPence),
      trip.source === 'oj_projects' ? 'OJ Projects' : 'Logged',
      escapeCsvCell(trip.ojProjectName ?? ''),
      escapeCsvCell(trip.ojClientName ?? ''),
    ]
  })

  return buildCsvBuffer([...summary, HEADER, ...rows])
}
