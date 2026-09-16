/**
 * The trips page address (spec 7.1). Parsing never widens a financial selection by accident:
 * dates are checked as a pair and dropped together with a visible warning, and anything else
 * unrecognised falls back to its default.
 */

import { isValidIsoDate } from '@/lib/dateUtils'

export type MileageListSort = 'date' | 'miles' | 'amount'
export type MileageListDirection = 'asc' | 'desc'
export type MileageListSource = 'manual' | 'oj_projects'

export interface MileageListQuery {
  from: string | null
  to: string | null
  q: string
  placeId: string | null
  source: MileageListSource | null
  driverId: string | null
  sort: MileageListSort
  dir: MileageListDirection
  page: number
}

export const MILEAGE_LIST_PAGE_SIZE = 25

/** mileage_trips_page_v01 refuses search text longer than this, counted in characters. */
const MAX_SEARCH_CHARACTERS = 80

/**
 * mileage_trips_page_v01 refuses an offset above 1,000,000, so a later page would fail the whole
 * load instead of reaching the page-past-the-end redirect.
 */
const MAX_PAGE = Math.floor(1_000_000 / MILEAGE_LIST_PAGE_SIZE) + 1

const INVALID_DATES_WARNING = "Those dates weren't valid, so all dates are shown."

export const DEFAULT_MILEAGE_LIST_QUERY: MileageListQuery = {
  from: null,
  to: null,
  q: '',
  placeId: null,
  source: null,
  driverId: null,
  sort: 'date',
  dir: 'desc',
  page: 1,
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_PATTERN = /^[1-9][0-9]*$/

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Trims, then caps by character (not UTF-16 unit), so an emoji is never cut in half. */
function normaliseSearch(value: string | undefined): string {
  return Array.from((value ?? '').trim()).slice(0, MAX_SEARCH_CHARACTERS).join('').trim()
}

export function parseMileageListQuery(params: SearchParams): { query: MileageListQuery; warnings: string[] } {
  const warnings: string[] = []
  const query: MileageListQuery = { ...DEFAULT_MILEAGE_LIST_QUERY }

  const from = first(params.from)?.trim() || null
  const to = first(params.to)?.trim() || null
  if (from || to) {
    const valid =
      (from === null || isValidIsoDate(from)) && (to === null || isValidIsoDate(to)) && !(from && to && from > to)
    if (valid) {
      query.from = from
      query.to = to
    } else {
      warnings.push(INVALID_DATES_WARNING)
    }
  }

  query.q = normaliseSearch(first(params.q))

  const place = first(params.place)
  if (place && UUID_PATTERN.test(place)) query.placeId = place

  const driver = first(params.driver)
  if (driver && UUID_PATTERN.test(driver)) query.driverId = driver

  const source = first(params.source)
  if (source === 'manual') query.source = 'manual'
  if (source === 'oj') query.source = 'oj_projects'

  const sort = first(params.sort)
  if (sort === 'date' || sort === 'miles' || sort === 'amount') query.sort = sort

  const dir = first(params.dir)
  if (dir === 'asc' || dir === 'desc') query.dir = dir

  const page = first(params.page)
  if (page && PAGE_PATTERN.test(page) && Number(page) <= MAX_PAGE) query.page = Number(page)

  return { query, warnings }
}

export function serialiseMileageListQuery(query: MileageListQuery): string {
  const params = new URLSearchParams()
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.q) params.set('q', query.q)
  if (query.placeId) params.set('place', query.placeId)
  if (query.source) params.set('source', query.source === 'oj_projects' ? 'oj' : 'manual')
  if (query.driverId) params.set('driver', query.driverId)
  if (query.sort !== 'date') params.set('sort', query.sort)
  if (query.dir !== 'desc') params.set('dir', query.dir)
  if (query.page > 1) params.set('page', String(query.page))
  return params.toString()
}

export function hasActiveFilters(query: MileageListQuery): boolean {
  return Boolean(query.from || query.to || query.q || query.placeId || query.source || query.driverId)
}

/** Table filters the accountant PDF does not apply (spec D3). */
export function ignoredReportFilters(query: MileageListQuery): string[] {
  const ignored: string[] = []
  if (query.q) ignored.push('search')
  if (query.placeId) ignored.push('place')
  if (query.source) ignored.push('source')
  return ignored
}

/** The p_filters argument for mileage_trips_page_v01: only the filters that are set. */
export function toPageFilters(query: MileageListQuery): Record<string, string> {
  const filters: Record<string, string> = {}
  if (query.from) filters.from = query.from
  if (query.to) filters.to = query.to
  if (query.q) filters.search = query.q
  if (query.placeId) filters.place_id = query.placeId
  if (query.source) filters.source = query.source
  if (query.driverId) filters.driver_id = query.driverId
  return filters
}
