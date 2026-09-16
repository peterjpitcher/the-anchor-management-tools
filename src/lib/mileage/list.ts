/**
 * Loads trips (and their totals) through mileage_trips_page_v01 (spec 7.1): one page for the table,
 * or every matching trip for the CSV. Anything unexpected fails closed, so the table never shows a
 * partial or misread list as if it were complete.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { parseTripRow, type MileageReportTrip } from '@/lib/mileage/report/dataset'
import { MILEAGE_LIST_PAGE_SIZE, toPageFilters, type MileageListQuery } from './list-query'

export interface MileageTripsPageResult {
  rows: MileageReportTrip[]
  totalCount: number
  totals: { trips: number; milesTenths: number; amountPence: number }
}

export class MileageListError extends Error {
  constructor(message = "Couldn't load trips. Try again.") {
    super(message)
    this.name = 'MileageListError'
  }
}

/** Trips per call when reading every match. The function allows 5,000; smaller calls keep each response small. */
const EXPORT_PAGE_SIZE = 1000

const TOO_MANY_TRIPS_MESSAGE = 'Too many trips to export at once. Narrow the dates and try again.'
const CHANGED_WHILE_READING_MESSAGE = 'Trips changed while the file was being made. Try again.'

const pageSchema = z.object({
  rows: z.array(z.unknown()),
  total_count: z.number().int().nonnegative(),
  totals: z.object({
    trips: z.number().int().nonnegative(),
    miles_tenths: z.number().int().nonnegative(),
    amount_pence: z.number().int().nonnegative(),
  }),
})

export async function loadMileageTripsPage(
  db: SupabaseClient,
  query: MileageListQuery,
  options: { limit: number; offset: number } = {
    limit: MILEAGE_LIST_PAGE_SIZE,
    offset: (query.page - 1) * MILEAGE_LIST_PAGE_SIZE,
  }
): Promise<MileageTripsPageResult> {
  const { data, error } = await db.rpc('mileage_trips_page_v01', {
    p_filters: toPageFilters(query),
    p_sort: query.sort,
    p_direction: query.dir,
    p_limit: options.limit,
    p_offset: options.offset,
  })
  if (error) {
    console.error('[mileage] trips page failed', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new MileageListError()
  }

  try {
    const parsed = pageSchema.parse(data)
    return {
      rows: parsed.rows.map(parseTripRow),
      totalCount: parsed.total_count,
      totals: {
        trips: parsed.totals.trips,
        milesTenths: parsed.totals.miles_tenths,
        amountPence: parsed.totals.amount_pence,
      },
    }
  } catch (parseError) {
    // Paths and codes only: the values include driver names and trip reasons.
    console.error('[mileage] trips page had an unexpected shape', {
      issues:
        parseError instanceof z.ZodError
          ? parseError.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`)
          : [parseError instanceof Error ? parseError.name : 'unknown'],
    })
    throw new MileageListError()
  }
}

/**
 * Every trip matching the query, in the table's order, read a page at a time. Refuses more than
 * `maxTrips` before reading past the first page. The pages come from separate calls, so the rows
 * are checked against the first call's count and totals: a trip saved or deleted mid-read fails
 * the load instead of producing a file whose rows and summary disagree.
 */
export async function loadAllMileageTrips(
  db: SupabaseClient,
  query: MileageListQuery,
  maxTrips: number
): Promise<MileageTripsPageResult> {
  const first = await loadMileageTripsPage(db, query, { limit: EXPORT_PAGE_SIZE, offset: 0 })
  if (first.totalCount > maxTrips) {
    throw new MileageListError(TOO_MANY_TRIPS_MESSAGE)
  }

  const rows = [...first.rows]
  while (rows.length < first.totalCount) {
    const next = await loadMileageTripsPage(db, query, { limit: EXPORT_PAGE_SIZE, offset: rows.length })
    if (
      next.rows.length === 0 ||
      next.totalCount !== first.totalCount ||
      next.totals.milesTenths !== first.totals.milesTenths ||
      next.totals.amountPence !== first.totals.amountPence
    ) {
      throw new MileageListError(CHANGED_WHILE_READING_MESSAGE)
    }
    rows.push(...next.rows)
  }

  const milesTenths = rows.reduce((sum, trip) => sum + trip.totalMilesTenths, 0)
  const amountPence = rows.reduce((sum, trip) => sum + trip.amountPence, 0)
  if (
    rows.length !== first.totalCount ||
    rows.length !== first.totals.trips ||
    new Set(rows.map((trip) => trip.id)).size !== rows.length ||
    milesTenths !== first.totals.milesTenths ||
    amountPence !== first.totals.amountPence
  ) {
    throw new MileageListError(CHANGED_WHILE_READING_MESSAGE)
  }

  return { rows, totalCount: first.totalCount, totals: first.totals }
}
