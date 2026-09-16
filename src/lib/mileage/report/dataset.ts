/**
 * Loads the report dataset (spec 6.1): one call to mileage_report_dataset_v01, parsed strictly.
 * Anything unexpected fails closed, so a report is never built from partial or misread data.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isValidIsoDate } from '@/lib/dateUtils'
import { FUEL_TYPES, type FuelType } from '@/lib/mileage/driver-setup'
import { daysBetween, MAX_REPORT_DAYS } from '@/lib/mileage/periods'
import { MileageReportError } from './errors'

export const MILEAGE_REPORT_MAX_TRIPS = 5000

export type MileageDriverBasis = 'entered' | 'owner_statement' | 'oj_projects'

export interface MileageReportLeg {
  legOrder: number
  fromId: string
  fromName: string
  fromPostcode: string | null
  fromIsHomeBase: boolean
  toId: string
  toName: string
  toPostcode: string | null
  toIsHomeBase: boolean
  milesTenths: number
}

export interface MileageReportTrip {
  id: string
  tripDate: string
  createdAt: string
  description: string | null
  totalMilesTenths: number
  standardMilesTenths: number
  reducedMilesTenths: number
  amountPence: number
  source: 'manual' | 'oj_projects'
  driverId: string
  driverName: string
  driverBasis: MileageDriverBasis
  ojProjectName: string | null
  ojClientName: string | null
  legs: MileageReportLeg[]
}

export interface MileageTaxYearPosition {
  driverId: string
  taxYearStart: string
  cutoffDate: string
  milesTenthsToCutoff: number
}

export interface MileageReportDriver {
  id: string
  displayName: string
}

export interface MileageReportVehicle {
  driverId: string
  validFrom: string
  fuelType: FuelType
  engineCc: number | null
}

export interface MileageReportDataset {
  generatedAt: string
  from: string
  to: string
  trips: MileageReportTrip[]
  taxYearPositions: MileageTaxYearPosition[]
  drivers: MileageReportDriver[]
  vehicles: MileageReportVehicle[]
}

/** A real calendar date: the format alone would let 2026-02-30 through. */
const isoDate = z.string().refine(isValidIsoDate, 'Expected a real YYYY-MM-DD date')

const legSchema = z.object({
  leg_order: z.number().int().positive(),
  from_id: z.string(),
  from_name: z.string(),
  from_postcode: z.string().nullable(),
  from_is_home_base: z.boolean(),
  to_id: z.string(),
  to_name: z.string(),
  to_postcode: z.string().nullable(),
  to_is_home_base: z.boolean(),
  miles_tenths: z.number().int().positive(),
})

const tripSchema = z.object({
  id: z.string(),
  trip_date: isoDate,
  created_at: z.string(),
  description: z.string().nullable(),
  total_miles_tenths: z.number().int().positive(),
  standard_miles_tenths: z.number().int().nonnegative(),
  reduced_miles_tenths: z.number().int().nonnegative(),
  amount_pence: z.number().int().nonnegative(),
  source: z.enum(['manual', 'oj_projects']),
  driver_id: z.string(),
  driver_name: z.string(),
  driver_basis: z.enum(['entered', 'owner_statement', 'oj_projects']),
  oj_project_name: z.string().nullable(),
  oj_client_name: z.string().nullable(),
  legs: z.array(legSchema),
})

const datasetSchema = z.object({
  generated_at: z.string(),
  from: isoDate,
  to: isoDate,
  trips: z.array(tripSchema),
  tax_year_positions: z.array(
    z.object({
      driver_id: z.string(),
      tax_year_start: isoDate,
      cutoff_date: isoDate,
      miles_tenths_to_cutoff: z.number().int().nonnegative(),
    })
  ),
  drivers: z.array(z.object({ id: z.string(), display_name: z.string() })),
  vehicles: z.array(
    z.object({
      driver_id: z.string(),
      valid_from: isoDate,
      fuel_type: z.enum(FUEL_TYPES),
      engine_cc: z.number().int().nullable(),
    })
  ),
})

function mapTrip(row: z.infer<typeof tripSchema>): MileageReportTrip {
  return {
    id: row.id,
    tripDate: row.trip_date,
    createdAt: row.created_at,
    description: row.description,
    totalMilesTenths: row.total_miles_tenths,
    standardMilesTenths: row.standard_miles_tenths,
    reducedMilesTenths: row.reduced_miles_tenths,
    amountPence: row.amount_pence,
    source: row.source,
    driverId: row.driver_id,
    driverName: row.driver_name,
    driverBasis: row.driver_basis,
    ojProjectName: row.oj_project_name,
    ojClientName: row.oj_client_name,
    legs: row.legs.map((leg) => ({
      legOrder: leg.leg_order,
      fromId: leg.from_id,
      fromName: leg.from_name,
      fromPostcode: leg.from_postcode,
      fromIsHomeBase: leg.from_is_home_base,
      toId: leg.to_id,
      toName: leg.to_name,
      toPostcode: leg.to_postcode,
      toIsHomeBase: leg.to_is_home_base,
      milesTenths: leg.miles_tenths,
    })),
  }
}

/** One trip row in the shared shape. Release 5's list reuses it for mileage_trips_page_v01. */
export function parseTripRow(row: unknown): MileageReportTrip {
  return mapTrip(tripSchema.parse(row))
}

export function parseMileageReportDataset(json: unknown): MileageReportDataset {
  const parsed = datasetSchema.parse(json)
  return {
    generatedAt: parsed.generated_at,
    from: parsed.from,
    to: parsed.to,
    trips: parsed.trips.map(mapTrip),
    taxYearPositions: parsed.tax_year_positions.map((position) => ({
      driverId: position.driver_id,
      taxYearStart: position.tax_year_start,
      cutoffDate: position.cutoff_date,
      milesTenthsToCutoff: position.miles_tenths_to_cutoff,
    })),
    drivers: parsed.drivers.map((driver) => ({ id: driver.id, displayName: driver.display_name })),
    vehicles: parsed.vehicles.map((vehicle) => ({
      driverId: vehicle.driver_id,
      validFrom: vehicle.valid_from,
      fuelType: vehicle.fuel_type,
      engineCc: vehicle.engine_cc,
    })),
  }
}

export function validateReportRange(from: string, to: string): void {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new MileageReportError('MILEAGE_REPORT_INVALID_RANGE', 'Choose a valid start and end date.')
  }
  if (from > to) {
    throw new MileageReportError('MILEAGE_REPORT_INVALID_RANGE', 'The start date must be on or before the end date.')
  }
  if (daysBetween(from, to) > MAX_REPORT_DAYS) {
    throw new MileageReportError('MILEAGE_REPORT_INVALID_RANGE', 'Choose dates no more than five years apart.')
  }
}

export async function loadMileageReportDataset(
  db: SupabaseClient,
  range: { from: string; to: string }
): Promise<MileageReportDataset> {
  validateReportRange(range.from, range.to)

  const { data, error } = await db.rpc('mileage_report_dataset_v01', { p_from: range.from, p_to: range.to })
  if (error) {
    // Includes MILEAGE_REPORT_TRIPS_WITHOUT_DRIVER, raised while a trip still has no driver.
    console.error('[mileage] report dataset query failed', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new MileageReportError('MILEAGE_REPORT_QUERY_FAILED')
  }

  let dataset: MileageReportDataset
  try {
    dataset = parseMileageReportDataset(data)
  } catch (parseError) {
    console.error('[mileage] report dataset had an unexpected shape', {
      message: parseError instanceof Error ? parseError.message.slice(0, 500) : String(parseError),
    })
    throw new MileageReportError('MILEAGE_REPORT_QUERY_FAILED')
  }

  if (dataset.trips.length > MILEAGE_REPORT_MAX_TRIPS) {
    throw new MileageReportError('MILEAGE_REPORT_TOO_LARGE')
  }
  return dataset
}
