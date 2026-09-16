import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDatasetJson } from '../../fixtures/mileage/reportDataset'
import { DEFAULT_MILEAGE_LIST_QUERY } from '@/lib/mileage/list-query'
import { loadAllMileageTrips, loadMileageTripsPage, MileageListError } from '@/lib/mileage/list'

function fakeDb(...results: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn()
  for (const result of results) rpc.mockResolvedValueOnce(result)
  return { db: { rpc } as never, rpc }
}

/** `count` copies of the fixture's first trip, each with its own id: 34 tenths and 153p each. */
function tripRows(count: number, startAt = 0) {
  const [template] = buildDatasetJson().trips
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `00000000-0000-4000-8000-${String(startAt + index).padStart(12, '0')}`,
  }))
}

function pageOf(rows: unknown[], totalCount: number, totals = { trips: totalCount, miles_tenths: totalCount * 34, amount_pence: totalCount * 153 }) {
  return { data: { rows, total_count: totalCount, totals }, error: null }
}

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
  consoleError.mockClear()
})

afterAll(() => {
  consoleError.mockRestore()
})

describe('loadMileageTripsPage', () => {
  it('asks for one page with the mapped filters and parses the rows', async () => {
    const json = buildDatasetJson()
    const { db, rpc } = fakeDb({
      data: { rows: json.trips, total_count: 53, totals: { trips: 53, miles_tenths: 9000, amount_pence: 42000 } },
      error: null,
    })

    const result = await loadMileageTripsPage(db, { ...DEFAULT_MILEAGE_LIST_QUERY, q: 'shop', sort: 'amount', dir: 'asc', page: 3 })

    expect(rpc).toHaveBeenCalledWith('mileage_trips_page_v01', {
      p_filters: { search: 'shop' },
      p_sort: 'amount',
      p_direction: 'asc',
      p_limit: 25,
      p_offset: 50,
    })
    expect(result.totalCount).toBe(53)
    expect(result.totals).toEqual({ trips: 53, milesTenths: 9000, amountPence: 42000 })
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0].driverName).toBe('Driver A')
  })

  it('fails closed when the database refuses the request, logging each error field', async () => {
    const { db } = fakeDb({ data: null, error: { code: 'P0001', message: 'MILEAGE_LIST_INVALID_SORT', details: null, hint: null } })

    await expect(loadMileageTripsPage(db, DEFAULT_MILEAGE_LIST_QUERY)).rejects.toBeInstanceOf(MileageListError)
    expect(consoleError).toHaveBeenCalledWith('[mileage] trips page failed', {
      code: 'P0001',
      message: 'MILEAGE_LIST_INVALID_SORT',
      details: null,
      hint: null,
    })
  })

  it('fails closed when the response is not the expected shape', async () => {
    const { db } = fakeDb({ data: { rows: [], totals: { trips: 0, miles_tenths: 0, amount_pence: 0 } }, error: null })

    await expect(loadMileageTripsPage(db, DEFAULT_MILEAGE_LIST_QUERY)).rejects.toThrow("Couldn't load trips. Try again.")
    expect(consoleError).toHaveBeenCalledWith('[mileage] trips page had an unexpected shape', {
      issues: ['total_count: invalid_type'],
    })
  })

  it('fails the whole page when one row is malformed, instead of dropping it', async () => {
    const [good, bad] = buildDatasetJson().trips
    const { db } = fakeDb(pageOf([good, { ...bad, driver_name: null }], 2))

    await expect(loadMileageTripsPage(db, DEFAULT_MILEAGE_LIST_QUERY)).rejects.toBeInstanceOf(MileageListError)
  })
})

describe('loadAllMileageTrips', () => {
  it('reads a page at a time until every matching trip is loaded', async () => {
    const { db, rpc } = fakeDb(pageOf(tripRows(1000), 1001), pageOf(tripRows(1, 1000), 1001))

    const result = await loadAllMileageTrips(db, { ...DEFAULT_MILEAGE_LIST_QUERY, from: '2026-04-01', page: 7 }, 5000)

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(1, 'mileage_trips_page_v01', {
      p_filters: { from: '2026-04-01' },
      p_sort: 'date',
      p_direction: 'desc',
      p_limit: 1000,
      p_offset: 0,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'mileage_trips_page_v01', expect.objectContaining({ p_limit: 1000, p_offset: 1000 }))
    expect(result.rows).toHaveLength(1001)
    expect(result.totals).toEqual({ trips: 1001, milesTenths: 34034, amountPence: 153153 })
  })

  it('refuses more trips than allowed without reading past the first page', async () => {
    const { db, rpc } = fakeDb(pageOf(tripRows(1000), 5001))

    await expect(loadAllMileageTrips(db, DEFAULT_MILEAGE_LIST_QUERY, 5000)).rejects.toThrow(
      'Too many trips to export at once. Narrow the dates and try again.'
    )
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('fails when the trips change between pages', async () => {
    const { db } = fakeDb(pageOf(tripRows(1000), 1001), pageOf(tripRows(2, 1000), 1002))

    await expect(loadAllMileageTrips(db, DEFAULT_MILEAGE_LIST_QUERY, 5000)).rejects.toThrow(
      'Trips changed while the file was being made. Try again.'
    )
  })

  it('fails when a trip moved between pages and appears twice', async () => {
    const { db } = fakeDb(pageOf(tripRows(1000), 1001), pageOf(tripRows(1, 999), 1001))

    await expect(loadAllMileageTrips(db, DEFAULT_MILEAGE_LIST_QUERY, 5000)).rejects.toThrow(
      'Trips changed while the file was being made. Try again.'
    )
  })

  it('fails when the rows do not add up to the totals', async () => {
    const { db } = fakeDb(pageOf(tripRows(2), 2, { trips: 2, miles_tenths: 68, amount_pence: 999 }))

    await expect(loadAllMileageTrips(db, DEFAULT_MILEAGE_LIST_QUERY, 5000)).rejects.toThrow(
      'Trips changed while the file was being made. Try again.'
    )
  })

  it('stops instead of looping when a later page comes back empty', async () => {
    const { db, rpc } = fakeDb(pageOf(tripRows(1000), 1001), pageOf([], 1001))

    await expect(loadAllMileageTrips(db, DEFAULT_MILEAGE_LIST_QUERY, 5000)).rejects.toBeInstanceOf(MileageListError)
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
