import { describe, expect, it, vi } from 'vitest'
import { buildDatasetJson, DRIVER_A_ID } from '../../../fixtures/mileage/reportDataset'
import {
  loadMileageReportDataset,
  MILEAGE_REPORT_MAX_TRIPS,
  parseMileageReportDataset,
  validateReportRange,
} from '@/lib/mileage/report/dataset'
import { MileageReportError } from '@/lib/mileage/report/errors'

function fakeDb(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) } as never
}

describe('parseMileageReportDataset', () => {
  it('maps the database JSON to typed camelCase data', () => {
    const dataset = parseMileageReportDataset(buildDatasetJson())
    expect(dataset.trips).toHaveLength(3)
    expect(dataset.trips[0]).toMatchObject({
      tripDate: '2026-04-04',
      totalMilesTenths: 34,
      amountPence: 153,
      driverId: DRIVER_A_ID,
      driverBasis: 'owner_statement',
    })
    expect(dataset.trips[0].legs[0]).toMatchObject({ fromName: 'The Anchor', toName: 'Shop One', toPostcode: 'TW15 1AA', milesTenths: 17 })
    expect(dataset.taxYearPositions[0]).toEqual({ driverId: DRIVER_A_ID, taxYearStart: '2025-04-06', cutoffDate: '2026-04-05', milesTenthsToCutoff: 1034 })
    expect(dataset.vehicles[0]).toEqual({ driverId: DRIVER_A_ID, validFrom: '2023-01-01', fuelType: 'petrol', engineCc: 1598 })
  })

  it('rejects a trip without a driver', () => {
    const json = buildDatasetJson()
    ;(json.trips[0] as Record<string, unknown>).driver_id = null
    expect(() => parseMileageReportDataset(json)).toThrow()
  })

  it('rejects a trip with an impossible date', () => {
    const json = buildDatasetJson()
    json.trips[0].trip_date = '2026-02-30'
    expect(() => parseMileageReportDataset(json)).toThrow()
  })
})

describe('validateReportRange', () => {
  it('accepts the catch-up from 1 January 2024', () => {
    expect(() => validateReportRange('2024-01-01', '2026-09-30')).not.toThrow()
  })

  it.each([
    ['2026-02-30', '2026-03-31', 'Choose a valid start and end date.'],
    ['2026-07-01', '2026-06-30', 'The start date must be on or before the end date.'],
    ['2020-01-01', '2026-09-30', 'Choose dates no more than five years apart.'],
  ])('refuses %s to %s', (from, to, message) => {
    expect(() => validateReportRange(from, to)).toThrow(message)
  })
})

describe('loadMileageReportDataset', () => {
  it('calls the dataset function once and returns parsed data', async () => {
    const db = fakeDb({ data: buildDatasetJson(), error: null })
    const dataset = await loadMileageReportDataset(db, { from: '2026-04-01', to: '2026-06-30' })
    expect((db as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('mileage_report_dataset_v01', { p_from: '2026-04-01', p_to: '2026-06-30' })
    expect(dataset.trips).toHaveLength(3)
  })

  it('refuses invalid dates before querying', async () => {
    const db = fakeDb({ data: buildDatasetJson(), error: null })
    await expect(loadMileageReportDataset(db, { from: '2026-07-01', to: '2026-06-30' })).rejects.toMatchObject({
      code: 'MILEAGE_REPORT_INVALID_RANGE',
    })
    expect((db as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })

  it('fails closed when the query fails', async () => {
    const db = fakeDb({ data: null, error: { code: '57014', message: 'timeout', details: null, hint: null } })
    await expect(loadMileageReportDataset(db, { from: '2026-04-01', to: '2026-06-30' })).rejects.toMatchObject({
      code: 'MILEAGE_REPORT_QUERY_FAILED',
    })
  })

  it('fails closed when the data has an unexpected shape', async () => {
    const db = fakeDb({ data: { trips: 'nope' }, error: null })
    await expect(loadMileageReportDataset(db, { from: '2026-04-01', to: '2026-06-30' })).rejects.toBeInstanceOf(MileageReportError)
  })

  it('refuses more than the supported number of trips', async () => {
    const base = buildDatasetJson()
    const trips = Array.from({ length: MILEAGE_REPORT_MAX_TRIPS + 1 }, (_, index) => ({ ...base.trips[1], id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }))
    const db = fakeDb({ data: { ...base, trips }, error: null })
    await expect(loadMileageReportDataset(db, { from: '2026-04-01', to: '2026-06-30' })).rejects.toMatchObject({
      code: 'MILEAGE_REPORT_TOO_LARGE',
    })
  })
})
