import { describe, expect, it } from 'vitest'
import { buildDatasetJson, DRIVER_A_ID, DRIVER_B_ID } from '../../../fixtures/mileage/reportDataset'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildMileageReport } from '@/lib/mileage/report/model'
import { quarterPeriod } from '@/lib/mileage/periods'

const q2 = quarterPeriod(2026, 2)
const report = (json = buildDatasetJson(), driverId: string | null = null) =>
  buildMileageReport(parseMileageReportDataset(json), { period: q2, driverId })

describe('buildMileageReport', () => {
  it('totals the claim and splits it by person', () => {
    const model = report()
    expect(model.totals).toEqual({ trips: 3, milesTenths: 570, amountPence: 3101 })
    expect(model.byDriver).toEqual([
      { driverId: DRIVER_A_ID, driverName: 'Driver A', trips: 2, milesTenths: 434, amountPence: 2353 },
      { driverId: DRIVER_B_ID, driverName: 'Driver B', trips: 1, milesTenths: 136, amountPence: 748 },
    ])
  })

  it('breaks the claim into rate bands by tax year that add up to the total', () => {
    const model = report()
    expect(model.bands).toEqual([
      { taxYearStart: '2025-04-06', band: 'standard', ratePence: 45, milesTenths: 34, amountPence: 153 },
      { taxYearStart: '2026-04-06', band: 'standard', ratePence: 55, milesTenths: 536, amountPence: 2948 },
    ])
    expect(model.bands.reduce((sum, band) => sum + band.amountPence, 0)).toBe(model.totals.amountPence)
  })

  it('allocates a crossing trip between bands with the remainder in the reduced band', () => {
    const json = buildDatasetJson()
    Object.assign(json.trips[2], { total_miles_tenths: 20, standard_miles_tenths: 10, reduced_miles_tenths: 10, amount_pence: 80 })
    const model = report(json)
    expect(model.bands).toContainEqual({ taxYearStart: '2026-04-06', band: 'reduced', ratePence: 25, milesTenths: 10, amountPence: 25 })
    expect(model.log[2].rateLabel).toBe('55p and 25p')
  })

  it('shows the claim month by month', () => {
    expect(report().months).toEqual([
      { month: '2026-04', trips: 2, milesTenths: 170, amountPence: 901 },
      { month: '2026-05', trips: 1, milesTenths: 400, amountPence: 2200 },
    ])
  })

  it('prices VAT on the fuel element per person and rounds VAT down', () => {
    const model = report()
    expect(model.vat).toEqual({
      rows: [
        { driverId: DRIVER_A_ID, driverName: 'Driver A', pricedTrips: 2, pricedMilesTenths: 434, fuelPence: 608, vatPence: 101, excluded: [] },
        { driverId: DRIVER_B_ID, driverName: 'Driver B', pricedTrips: 1, pricedMilesTenths: 136, fuelPence: 177, vatPence: 29, excluded: [] },
      ],
      totalFuelPence: 785,
      totalVatPence: 130,
      complete: true,
    })
  })

  it('lists trips it cannot price for VAT and marks the section incomplete', () => {
    const json = buildDatasetJson({ vehicles: [{ driver_id: DRIVER_A_ID, valid_from: '2023-01-01', fuel_type: 'petrol', engine_cc: 1598 }] })
    Object.assign(json.trips[2], { trip_date: '2026-12-05' })
    const model = report(json)
    expect(model.vat.complete).toBe(false)
    expect(model.vat.rows[0].excluded).toEqual([{ tripId: json.trips[2].id, tripDate: '2026-12-05', reason: 'no_fuel_rate' }])
    expect(model.vat.rows[1]).toMatchObject({ fuelPence: 0, vatPence: 0, excluded: [{ tripId: json.trips[1].id, tripDate: '2026-04-06', reason: 'no_car_recorded' }] })
  })

  it('prices each trip at the car in force on its date', () => {
    const json = buildDatasetJson({
      vehicles: [
        { driver_id: DRIVER_A_ID, valid_from: '2023-01-01', fuel_type: 'petrol', engine_cc: 1598 },
        { driver_id: DRIVER_A_ID, valid_from: '2026-04-05', fuel_type: 'diesel', engine_cc: 2500 },
        { driver_id: DRIVER_B_ID, valid_from: '2026-04-07', fuel_type: 'diesel', engine_cc: 1995 },
      ],
    })
    const model = report(json)
    // Driver A: 4 April on the petrol car at 14p (48p), 1 May on the diesel car at 18p (720p).
    expect(model.vat.rows[0]).toMatchObject({ pricedTrips: 2, fuelPence: 768, vatPence: 128 })
    // Driver B's car starts the day after the trip.
    expect(model.vat.rows[1].excluded).toEqual([{ tripId: json.trips[1].id, tripDate: '2026-04-06', reason: 'no_car_recorded' }])
  })

  it('reports each person’s tax year position and flags a tax year that began before the log', () => {
    const json = buildDatasetJson()
    json.tax_year_positions.push({ driver_id: DRIVER_A_ID, tax_year_start: '2023-04-06', cutoff_date: '2024-04-05', miles_tenths_to_cutoff: 5000 })
    const model = report(json)
    expect(model.taxYearPositions).toContainEqual({
      driverId: DRIVER_A_ID, driverName: 'Driver A', taxYearStart: '2025-04-06', cutoffDate: '2026-04-05',
      milesTenthsToCutoff: 1034, standardMilesLeftTenths: 98966, logStartsPartWay: false,
    })
    expect(model.taxYearPositions.find((row) => row.taxYearStart === '2023-04-06')?.logStartsPartWay).toBe(true)
  })

  it('builds the trip log with routes, reasons and rates', () => {
    const model = report()
    expect(model.log[0]).toEqual({
      tripId: '00000000-0000-4000-8000-000000000101', tripDate: '2026-04-04', driverName: 'Driver A', basis: 'owner_statement',
      reason: 'Shop One', route: 'The Anchor → Shop One → The Anchor', milesTenths: 34, rateLabel: '45p', amountPence: 153,
    })
    expect(model.log[2].route).toBe('Not recorded (OJ Projects: Vision workshop, Client Ltd)')
  })

  it('counts places visited without adding the counts up', () => {
    expect(report().places).toEqual([
      { name: 'Shop One', postcode: 'TW15 1AA', trips: 1 },
      { name: 'Wholesaler', postcode: null, trips: 1 },
    ])
  })

  it('summarises OJ Projects client work without billing states', () => {
    expect(report().ojProjects).toEqual({ trips: 1, milesTenths: 400, amountPence: 2200 })
  })

  it('narrows to one driver and labels the subset', () => {
    const model = report(buildDatasetJson(), DRIVER_B_ID)
    expect(model.scope).toMatchObject({ driverId: DRIVER_B_ID, driverName: 'Driver B' })
    expect(model.totals).toEqual({ trips: 1, milesTenths: 136, amountPence: 748 })
    expect(model.vat.rows.map((row) => row.driverName)).toEqual(['Driver B'])
    expect(model.ojProjects).toBeNull()
    expect(model.taxYearPositions.every((row) => row.driverId === DRIVER_B_ID)).toBe(true)
  })

  it('produces a nil report for an empty period', () => {
    const model = report(buildDatasetJson({ trips: [] }))
    expect(model.totals).toEqual({ trips: 0, milesTenths: 0, amountPence: 0 })
    expect(model.log).toEqual([])
    expect(model.vat).toMatchObject({ rows: [], totalFuelPence: 0, totalVatPence: 0, complete: true })
  })

  it('refuses an unknown driver', () => {
    expect(() => report(buildDatasetJson(), '00000000-0000-4000-8000-00000000ffff')).toThrow('Choose a driver from the list.')
  })
})
