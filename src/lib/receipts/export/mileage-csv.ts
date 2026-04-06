/**
 * Mileage CSV generation for quarterly export.
 *
 * Queries mileage_trips + mileage_trip_legs for the calendar quarter and
 * produces a CSV with route descriptions, mileage splits, and a summary header.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  escapeCsvCell,
  formatDateDdMmYyyy,
  formatCurrency,
  buildCsvBuffer,
} from './csv-helpers'
import { getTaxYearBounds, STANDARD_RATE, REDUCED_RATE } from '@/lib/mileage/hmrcRates'

export interface MileageTripRow {
  id: string
  trip_date: string
  description: string | null
  total_miles: number
  miles_at_standard_rate: number
  miles_at_reduced_rate: number
  amount_due: number
  source: string
  mileage_trip_legs?: MileageTripLegRow[] | null
}

export interface MileageTripLegRow {
  id: string
  leg_order: number
  from_destination: { name: string } | { name: string }[] | null
  to_destination: { name: string } | { name: string }[] | null
}

export interface MileageSummary {
  totalTrips: number
  totalMiles: number
  totalMilesAtStandard: number
  totalMilesAtReduced: number
  totalClaimAmount: number
  taxYearTotalMiles: number
}

/**
 * Queries mileage data for the quarter and returns a CSV buffer + summary stats.
 */
export async function buildMileageCsv(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
  year: number,
  quarter: number
): Promise<{ csv: Buffer; summary: MileageSummary; rows: MileageTripRow[] }> {
  // Fetch trips with legs (including destination names)
  const { data: trips, error } = await supabase
    .from('mileage_trips')
    .select(`
      id,
      trip_date,
      created_at,
      description,
      total_miles,
      miles_at_standard_rate,
      miles_at_reduced_rate,
      amount_due,
      source,
      mileage_trip_legs (
        id,
        leg_order,
        from_destination:mileage_destinations!mileage_trip_legs_from_destination_id_fkey ( name ),
        to_destination:mileage_destinations!mileage_trip_legs_to_destination_id_fkey ( name )
      )
    `)
    .gte('trip_date', startDate)
    .lte('trip_date', endDate)
    .order('trip_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch mileage trips for export:', error)
    throw new Error('Failed to load mileage data for export')
  }

  const rows = (trips ?? []) as MileageTripRow[]

  // Calculate tax year cumulative miles for the summary header.
  // Use the start of the quarter to find the relevant tax year.
  const taxYear = getTaxYearBounds(startDate)
  const { data: taxYearTrips } = await supabase
    .from('mileage_trips')
    .select('total_miles')
    .gte('trip_date', taxYear.start)
    .lte('trip_date', taxYear.end)

  const taxYearTotalMiles = (taxYearTrips ?? []).reduce(
    (sum, t) => sum + Number(t.total_miles),
    0
  )

  // Aggregate quarter stats
  const totalTrips = rows.length
  const totalMiles = rows.reduce((sum, t) => sum + Number(t.total_miles), 0)
  const totalMilesAtStandard = rows.reduce(
    (sum, t) => sum + Number(t.miles_at_standard_rate),
    0
  )
  const totalMilesAtReduced = rows.reduce(
    (sum, t) => sum + Number(t.miles_at_reduced_rate),
    0
  )
  const totalClaimAmount = rows.reduce((sum, t) => sum + Number(t.amount_due), 0)

  const summary: MileageSummary = {
    totalTrips,
    totalMiles,
    totalMilesAtStandard,
    totalMilesAtReduced,
    totalClaimAmount,
    taxYearTotalMiles,
  }

  // Build CSV rows
  const summaryRows: string[][] = [
    ['Quarter', `Q${quarter} ${year}`],
    ['Total Trips', String(totalTrips)],
    ['Total Miles', formatCurrency(totalMiles)],
    ['Total Claim (GBP)', formatCurrency(totalClaimAmount)],
    ['Tax Year Miles (cumulative)', formatCurrency(taxYearTotalMiles)],
    [
      'Rates Applied',
      `${formatCurrency(totalMilesAtStandard)} miles @ \u00A3${STANDARD_RATE.toFixed(2)}, ${formatCurrency(totalMilesAtReduced)} miles @ \u00A3${REDUCED_RATE.toFixed(2)}`,
    ],
    [],
  ]

  const headerRow = [
    'Date',
    'Route',
    'Total Miles',
    'Miles @ \u00A30.45',
    'Miles @ \u00A30.25',
    'Amount (\u00A3)',
    'Source',
  ]

  const dataRows = rows.map((trip) => {
    const route = buildRouteDescription(trip)
    const source = trip.source === 'oj_projects' ? 'OJ Projects' : 'Manual'

    return [
      formatDateDdMmYyyy(trip.trip_date),
      escapeCsvCell(route),
      Number(trip.total_miles).toFixed(1),
      Number(trip.miles_at_standard_rate).toFixed(1),
      Number(trip.miles_at_reduced_rate).toFixed(1),
      Number(trip.amount_due).toFixed(2),
      source,
    ]
  })

  const csvRows = [...summaryRows, headerRow, ...dataRows]
  const csv = buildCsvBuffer(csvRows)

  return { csv, summary, rows }
}

/**
 * Builds a human-readable route description.
 * - Legged trips: "Anchor -> Stop 1 -> Stop 2 -> Anchor"
 * - OJ Projects trips (no legs): "OJ Projects -- [description]"
 */
function buildRouteDescription(trip: MileageTripRow): string {
  const legs = trip.mileage_trip_legs ?? []

  if (legs.length === 0) {
    // OJ Projects synced trip or manual trip with no legs
    if (trip.source === 'oj_projects') {
      return `OJ Projects \u2014 ${trip.description ?? 'Trip'}`
    }
    return trip.description ?? 'Trip'
  }

  // Sort legs by order
  const sorted = [...legs].sort((a, b) => a.leg_order - b.leg_order)

  // Build route chain: from of first leg, then to of each leg
  const stops: string[] = []
  const firstName = resolveDestinationName(sorted[0]?.from_destination)
  if (firstName) {
    stops.push(firstName)
  }
  for (const leg of sorted) {
    const toName = resolveDestinationName(leg.to_destination)
    if (toName) {
      stops.push(toName)
    }
  }

  return stops.join(' \u2192 ')
}

/**
 * Supabase foreign key joins can return either a single object or an array.
 * This helper normalises to a single name string.
 */
function resolveDestinationName(
  dest: { name: string } | { name: string }[] | null | undefined
): string | null {
  if (!dest) return null
  if (Array.isArray(dest)) return dest[0]?.name ?? null
  return dest.name
}
