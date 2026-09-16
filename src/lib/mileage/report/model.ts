/**
 * Turns the report dataset into every figure the PDF, CSV summary and claim summary print
 * (spec 4.2, 5.5 and 6.2). Pure: no database, no clock, no formatting. Every amount is a whole
 * number of tenths of a mile or pence, so the totals always add up.
 */

import {
  AMAP_RATE_PERIODS,
  allocateTripBandPence,
  getAmapRates,
  getTaxYearBounds,
  MileageRateMissingError,
  roundTenthPenceHalfUp,
} from '@/lib/mileage/hmrcRates'
import { getAdvisoryFuelRate } from '@/lib/mileage/advisoryFuelRates'
import type { ReportPeriod } from '@/lib/mileage/periods'
import type {
  MileageDriverBasis,
  MileageReportDataset,
  MileageReportTrip,
  MileageReportVehicle,
} from './dataset'
import { MileageReportError } from './errors'

/** VAT at the 20% standard rate is one sixth of a VAT-inclusive amount (VAT Notice 700/64, 9.8). */
export const VAT_FRACTION_DENOMINATOR = 6
export const LOG_START_DATE = '2024-01-01'

export interface ReportScope {
  period: ReportPeriod
  driverId: string | null
}

export interface ReportTotals {
  trips: number
  milesTenths: number
  amountPence: number
}

export interface ReportDriverSummary extends ReportTotals {
  driverId: string
  driverName: string
}

export interface ReportBandRow {
  taxYearStart: string
  band: 'standard' | 'reduced'
  ratePence: number
  milesTenths: number
  amountPence: number
}

export interface ReportMonthRow extends ReportTotals {
  /** YYYY-MM */
  month: string
}

export interface ReportTaxYearPositionRow {
  driverId: string
  driverName: string
  taxYearStart: string
  cutoffDate: string
  milesTenthsToCutoff: number
  standardMilesLeftTenths: number
  logStartsPartWay: boolean
}

export type VatExclusionReason = 'no_car_recorded' | 'no_fuel_rate'

export interface ReportVatDriverRow {
  driverId: string
  driverName: string
  pricedTrips: number
  pricedMilesTenths: number
  fuelPence: number
  vatPence: number
  excluded: Array<{ tripId: string; tripDate: string; reason: VatExclusionReason }>
}

export interface ReportVatSection {
  rows: ReportVatDriverRow[]
  totalFuelPence: number
  totalVatPence: number
  complete: boolean
}

export interface ReportLogRow {
  tripId: string
  tripDate: string
  driverName: string
  basis: MileageDriverBasis
  reason: string
  route: string
  milesTenths: number
  rateLabel: string
  amountPence: number
}

export interface ReportPlaceRow {
  name: string
  postcode: string | null
  trips: number
}

export interface MileageReportModel {
  scope: { period: ReportPeriod; driverId: string | null; driverName: string | null }
  generatedAt: string
  totals: ReportTotals
  byDriver: ReportDriverSummary[]
  bands: ReportBandRow[]
  months: ReportMonthRow[]
  taxYearPositions: ReportTaxYearPositionRow[]
  vat: ReportVatSection
  ojProjects: ReportTotals | null
  log: ReportLogRow[]
  places: ReportPlaceRow[]
}

function addTo(totals: ReportTotals, trip: MileageReportTrip): void {
  totals.trips += 1
  totals.milesTenths += trip.totalMilesTenths
  totals.amountPence += trip.amountPence
}

function emptyTotals(): ReportTotals {
  return { trips: 0, milesTenths: 0, amountPence: 0 }
}

function thresholdTenthsOn(date: string): number {
  try {
    return getAmapRates(date).thresholdMiles * 10
  } catch (error) {
    // The 10,000-mile threshold has not changed since the schedule starts; dates before it use the first period's.
    if (error instanceof MileageRateMissingError) return AMAP_RATE_PERIODS[0].thresholdMiles * 10
    throw error
  }
}

/** The car in force on a date: the driver's car with the latest start date on or before it (spec 5.1). */
function vehicleOn(vehicles: MileageReportVehicle[], driverId: string, tripDate: string): MileageReportVehicle | null {
  let match: MileageReportVehicle | null = null
  for (const vehicle of vehicles) {
    if (vehicle.driverId === driverId && vehicle.validFrom <= tripDate) {
      if (!match || vehicle.validFrom > match.validFrom) match = vehicle
    }
  }
  return match
}

/** The place names joined by arrows, or why the route is not recorded (spec 6.2). Shared with the CSV. */
export function describeTripRoute(trip: MileageReportTrip): string {
  if (trip.legs.length > 0) {
    return [trip.legs[0].fromName, ...trip.legs.map((leg) => leg.toName)].join(' → ')
  }
  if (trip.source === 'oj_projects') {
    const names = [trip.ojProjectName, trip.ojClientName].filter((name): name is string => Boolean(name))
    return names.length > 0 ? `Not recorded (OJ Projects: ${names.join(', ')})` : 'Not recorded (OJ Projects entry)'
  }
  return 'Not recorded'
}

/** The AMAP rate or rates a trip was paid at, for example "45p" or "45p and 25p". Shared with the trips table. */
export function describeTripRate(trip: MileageReportTrip): string {
  const rates = getAmapRates(trip.tripDate)
  if (trip.standardMilesTenths > 0 && trip.reducedMilesTenths > 0) {
    return `${rates.standardPence}p and ${rates.reducedPence}p`
  }
  return trip.reducedMilesTenths > 0 ? `${rates.reducedPence}p` : `${rates.standardPence}p`
}

export function buildMileageReport(dataset: MileageReportDataset, scope: ReportScope): MileageReportModel {
  const scopedDriver = scope.driverId ? dataset.drivers.find((driver) => driver.id === scope.driverId) : null
  if (scope.driverId && !scopedDriver) {
    throw new MileageReportError('MILEAGE_REPORT_INVALID_RANGE', 'Choose a driver from the list.')
  }

  const trips = scope.driverId ? dataset.trips.filter((trip) => trip.driverId === scope.driverId) : dataset.trips
  const drivers = scope.driverId ? dataset.drivers.filter((driver) => driver.id === scope.driverId) : dataset.drivers
  const driverName = new Map(dataset.drivers.map((driver) => [driver.id, driver.displayName]))

  const totals = emptyTotals()
  const byDriver = new Map<string, ReportTotals>()
  const bands = new Map<string, ReportBandRow>()
  const months = new Map<string, ReportTotals>()
  const ojTotals = emptyTotals()
  const vatByDriver = new Map<string, ReportVatDriverRow>()
  const places = new Map<string, { name: string; postcode: string | null; tripIds: Set<string> }>()

  for (const trip of trips) {
    addTo(totals, trip)

    const driverTotals = byDriver.get(trip.driverId) ?? emptyTotals()
    addTo(driverTotals, trip)
    byDriver.set(trip.driverId, driverTotals)

    const monthKey = trip.tripDate.slice(0, 7)
    const monthTotals = months.get(monthKey) ?? emptyTotals()
    addTo(monthTotals, trip)
    months.set(monthKey, monthTotals)

    if (trip.source === 'oj_projects') addTo(ojTotals, trip)

    const rates = getAmapRates(trip.tripDate)
    const taxYearStart = getTaxYearBounds(trip.tripDate).start
    const allocation = allocateTripBandPence({
      tripDate: trip.tripDate,
      standardTenths: trip.standardMilesTenths,
      amountPence: trip.amountPence,
    })
    const bandEntries: Array<[ReportBandRow['band'], number, number, number]> = [
      ['standard', rates.standardPence, trip.standardMilesTenths, allocation.standardBandPence],
      ['reduced', rates.reducedPence, trip.reducedMilesTenths, allocation.reducedBandPence],
    ]
    for (const [band, ratePence, milesTenths, amountPence] of bandEntries) {
      if (milesTenths === 0) continue
      const key = `${taxYearStart}|${band}|${ratePence}`
      const row = bands.get(key) ?? { taxYearStart, band, ratePence, milesTenths: 0, amountPence: 0 }
      row.milesTenths += milesTenths
      row.amountPence += amountPence
      bands.set(key, row)
    }

    const vatRow =
      vatByDriver.get(trip.driverId) ??
      {
        driverId: trip.driverId,
        driverName: trip.driverName,
        pricedTrips: 0,
        pricedMilesTenths: 0,
        fuelPence: 0,
        vatPence: 0,
        excluded: [],
      }
    const vehicle = vehicleOn(dataset.vehicles, trip.driverId, trip.tripDate)
    if (!vehicle) {
      vatRow.excluded.push({ tripId: trip.id, tripDate: trip.tripDate, reason: 'no_car_recorded' })
    } else {
      const rate = getAdvisoryFuelRate({ tripDate: trip.tripDate, fuelType: vehicle.fuelType, engineCc: vehicle.engineCc })
      if (rate.status === 'missing_rate') {
        vatRow.excluded.push({ tripId: trip.id, tripDate: trip.tripDate, reason: 'no_fuel_rate' })
      } else {
        vatRow.pricedTrips += 1
        vatRow.pricedMilesTenths += trip.totalMilesTenths
        vatRow.fuelPence += roundTenthPenceHalfUp(trip.totalMilesTenths * rate.pencePerMile)
      }
    }
    vatByDriver.set(trip.driverId, vatRow)

    for (const leg of trip.legs) {
      const ends: Array<[string, string, string | null, boolean]> = [
        [leg.fromId, leg.fromName, leg.fromPostcode, leg.fromIsHomeBase],
        [leg.toId, leg.toName, leg.toPostcode, leg.toIsHomeBase],
      ]
      for (const [id, name, postcode, isHomeBase] of ends) {
        if (isHomeBase) continue
        const place = places.get(id) ?? { name, postcode, tripIds: new Set<string>() }
        place.tripIds.add(trip.id)
        places.set(id, place)
      }
    }
  }

  const vatRows = drivers
    .map((driver) => vatByDriver.get(driver.id))
    .filter((row): row is ReportVatDriverRow => Boolean(row))
    .map((row) => ({ ...row, vatPence: Math.floor(row.fuelPence / VAT_FRACTION_DENOMINATOR) }))

  return {
    scope: { period: scope.period, driverId: scope.driverId, driverName: scopedDriver?.displayName ?? null },
    generatedAt: dataset.generatedAt,
    totals,
    byDriver: drivers
      .filter((driver) => byDriver.has(driver.id))
      .map((driver) => ({ driverId: driver.id, driverName: driver.displayName, ...byDriver.get(driver.id)! })),
    bands: [...bands.values()].sort(
      (a, b) => a.taxYearStart.localeCompare(b.taxYearStart) || (a.band === b.band ? 0 : a.band === 'standard' ? -1 : 1)
    ),
    months: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, monthTotals]) => ({ month, ...monthTotals })),
    taxYearPositions: dataset.taxYearPositions
      .filter((position) => !scope.driverId || position.driverId === scope.driverId)
      .map((position) => ({
        driverId: position.driverId,
        driverName: driverName.get(position.driverId) ?? 'Unknown driver',
        taxYearStart: position.taxYearStart,
        cutoffDate: position.cutoffDate,
        milesTenthsToCutoff: position.milesTenthsToCutoff,
        standardMilesLeftTenths: Math.max(0, thresholdTenthsOn(position.cutoffDate) - position.milesTenthsToCutoff),
        logStartsPartWay: position.taxYearStart < LOG_START_DATE,
      })),
    vat: {
      rows: vatRows,
      totalFuelPence: vatRows.reduce((sum, row) => sum + row.fuelPence, 0),
      totalVatPence: vatRows.reduce((sum, row) => sum + row.vatPence, 0),
      complete: vatRows.every((row) => row.excluded.length === 0),
    },
    ojProjects: ojTotals.trips > 0 ? ojTotals : null,
    log: trips.map((trip) => ({
      tripId: trip.id,
      tripDate: trip.tripDate,
      driverName: trip.driverName,
      basis: trip.driverBasis,
      reason: trip.description?.trim() || 'Not recorded',
      route: describeTripRoute(trip),
      milesTenths: trip.totalMilesTenths,
      rateLabel: describeTripRate(trip),
      amountPence: trip.amountPence,
    })),
    places: [...places.values()]
      .map((place) => ({ name: place.name, postcode: place.postcode, trips: place.tripIds.size }))
      .sort((a, b) => b.trips - a.trips || a.name.localeCompare(b.name)),
  }
}
