import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MILEAGE_LIST_QUERY,
  hasActiveFilters,
  ignoredReportFilters,
  nextSort,
  parseMileageListQuery,
  serialiseMileageListQuery,
  toPageFilters,
} from '@/lib/mileage/list-query'

const PLACE = '00000000-0000-4000-8000-000000000002'
const DRIVER = '00000000-0000-4000-8000-0000000000a1'

describe('parseMileageListQuery', () => {
  it('uses the defaults for an empty address', () => {
    expect(parseMileageListQuery({})).toEqual({ query: DEFAULT_MILEAGE_LIST_QUERY, warnings: [] })
  })

  it('reads every filter and round-trips it', () => {
    const address = `from=2026-04-01&to=2026-06-30&q=tesco&place=${PLACE}&source=oj&driver=${DRIVER}&sort=miles&dir=asc&page=2`
    const { query, warnings } = parseMileageListQuery(Object.fromEntries(new URLSearchParams(address)))
    expect(warnings).toEqual([])
    expect(query).toEqual({ from: '2026-04-01', to: '2026-06-30', q: 'tesco', placeId: PLACE, source: 'oj_projects', driverId: DRIVER, sort: 'miles', dir: 'asc', page: 2 })
    expect(serialiseMileageListQuery(query)).toBe(address)
  })

  it('round-trips search text that needs encoding', () => {
    const query = { ...DEFAULT_MILEAGE_LIST_QUERY, q: '100% & more?', source: 'manual' as const }
    const reparsed = parseMileageListQuery(Object.fromEntries(new URLSearchParams(serialiseMileageListQuery(query))))
    expect(reparsed).toEqual({ query, warnings: [] })
  })

  it('drops both dates, with a visible warning, when either is invalid or they are the wrong way round', () => {
    for (const params of [{ from: '2026-02-30', to: '2026-03-31' }, { from: '2026-06-30', to: '2026-04-01' }]) {
      const { query, warnings } = parseMileageListQuery(params)
      expect(query.from).toBeNull()
      expect(query.to).toBeNull()
      expect(warnings).toEqual(["Those dates weren't valid, so all dates are shown."])
    }
  })

  it('drops a lone date that is not a real YYYY-MM-DD date, with the same warning', () => {
    for (const params of [{ to: 'today' }, { from: '2026-5-1' }]) {
      const { query, warnings } = parseMileageListQuery(params)
      expect(query.from).toBeNull()
      expect(query.to).toBeNull()
      expect(warnings).toEqual(["Those dates weren't valid, so all dates are shown."])
    }
  })

  it('keeps a single valid date', () => {
    expect(parseMileageListQuery({ from: '2026-04-01' }).query).toMatchObject({ from: '2026-04-01', to: null })
  })

  it('keeps a one-day range', () => {
    expect(parseMileageListQuery({ from: '2026-04-01', to: '2026-04-01' }).query).toMatchObject({ from: '2026-04-01', to: '2026-04-01' })
  })

  it('ignores anything it does not recognise instead of widening or failing', () => {
    const { query } = parseMileageListQuery({ place: 'nope', driver: '1', source: 'email', sort: 'route', dir: 'up', page: '0' })
    expect(query).toEqual(DEFAULT_MILEAGE_LIST_QUERY)
  })

  it('only accepts whole page numbers the database can page to', () => {
    expect(parseMileageListQuery({ page: '2.5' }).query.page).toBe(1)
    expect(parseMileageListQuery({ page: '-3' }).query.page).toBe(1)
    expect(parseMileageListQuery({ page: '40001' }).query.page).toBe(40001)
    // Page 40,002 would start past the database's 1,000,000-row offset limit and fail the load.
    expect(parseMileageListQuery({ page: '40002' }).query.page).toBe(1)
  })

  it('trims and caps search text and takes the first of repeated values', () => {
    expect(parseMileageListQuery({ q: `  ${'x'.repeat(100)}  ` }).query.q).toHaveLength(80)
    expect(parseMileageListQuery({ sort: ['amount', 'miles'] }).query.sort).toBe('amount')
  })

  it('caps search text by character, never splitting one in half', () => {
    const q = parseMileageListQuery({ q: `a${'🚗'.repeat(100)}` }).query.q
    expect(Array.from(q)).toHaveLength(80)
    expect(q).toBe(`a${'🚗'.repeat(79)}`)
  })
})

describe('query helpers', () => {
  it('leaves defaults out of the address', () => {
    expect(serialiseMileageListQuery(DEFAULT_MILEAGE_LIST_QUERY)).toBe('')
  })

  it('knows when filters are active', () => {
    expect(hasActiveFilters(DEFAULT_MILEAGE_LIST_QUERY)).toBe(false)
    expect(hasActiveFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, q: 'x' })).toBe(true)
    expect(hasActiveFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, sort: 'miles', page: 3 })).toBe(false)
  })

  it('names the filters the PDF ignores', () => {
    expect(ignoredReportFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, q: 'x', placeId: PLACE, source: 'manual', driverId: DRIVER })).toEqual(['search', 'place', 'source'])
    expect(ignoredReportFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, from: '2026-04-01', driverId: DRIVER })).toEqual([])
  })

  it('maps the query to the database function filters', () => {
    expect(toPageFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, from: '2026-04-01', q: 'tesco', source: 'oj_projects', driverId: DRIVER })).toEqual({
      from: '2026-04-01',
      search: 'tesco',
      source: 'oj_projects',
      driver_id: DRIVER,
    })
    expect(toPageFilters(DEFAULT_MILEAGE_LIST_QUERY)).toEqual({})
  })
})

describe('nextSort', () => {
  it('flips the active column and starts another column with the newest or largest first', () => {
    expect(nextSort({ ...DEFAULT_MILEAGE_LIST_QUERY, page: 4 }, 'date')).toMatchObject({ sort: 'date', dir: 'asc', page: 1 })
    expect(nextSort({ ...DEFAULT_MILEAGE_LIST_QUERY, dir: 'asc' }, 'date')).toMatchObject({ sort: 'date', dir: 'desc', page: 1 })
    expect(nextSort({ ...DEFAULT_MILEAGE_LIST_QUERY, q: 'shop', page: 4 }, 'amount')).toEqual({
      ...DEFAULT_MILEAGE_LIST_QUERY,
      q: 'shop',
      sort: 'amount',
      dir: 'desc',
      page: 1,
    })
    expect(nextSort({ ...DEFAULT_MILEAGE_LIST_QUERY, sort: 'miles', dir: 'asc' }, 'amount')).toMatchObject({ sort: 'amount', dir: 'desc', page: 1 })
  })
})
