'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows, type PagedReadResult } from '@/lib/supabase/paged-read'
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils'
import {
  getTaxYearBounds,
  THRESHOLD_MILES,
  type TaxYearStats,
} from '@/lib/mileage/hmrcRates'

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const destinationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or less'),
  postcode: z
    .string()
    .max(10, 'Postcode must be 10 characters or less')
    .optional()
    .or(z.literal('')),
})

const tripLegSchema = z.object({
  fromDestinationId: z.string().uuid(),
  toDestinationId: z.string().uuid(),
  miles: z
    .number()
    .finite('Miles must be a valid number')
    .positive('Miles must be greater than 0')
    .refine(hasAtMostOneDecimalPlace, 'Miles must be rounded to 1 decimal place'),
})

const distanceCacheSchema = z.object({
  fromDestinationId: z.string().uuid(),
  toDestinationId: z.string().uuid(),
  miles: z
    .number()
    .finite('Miles must be a valid number')
    .positive('Miles must be greater than 0')
    .refine(hasAtMostOneDecimalPlace, 'Miles must be rounded to 1 decimal place'),
})

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')

const tripReasonSchema = z
  .string()
  .trim()
  .min(1, 'Enter the reason for the trip')
  .max(500, 'Keep the reason to 500 characters or fewer')

const createTripSchema = z.object({
  tripDate: isoDateSchema,
  description: tripReasonSchema,
  driverId: z.string().uuid('Choose who drove'),
  requestId: z.string().uuid('Reload the form and try again'),
  legs: z.array(tripLegSchema).min(1, 'At least one leg is required'),
})

const updateTripSchema = z.object({
  id: z.string().uuid(),
  tripDate: isoDateSchema,
  description: tripReasonSchema,
  driverId: z.string().uuid('Choose who drove'),
  expectedUpdatedAt: z.string().min(1, 'Reload the trip before editing it'),
  legs: z.array(tripLegSchema).min(1, 'At least one leg is required'),
})

// The v02 save functions raise these codes; anything else is logged and shown as a failed save.
const MILEAGE_SAVE_ERRORS: Record<string, string> = {
  MILEAGE_DRIVER_REQUIRED: 'Choose who drove.',
  MILEAGE_REASON_REQUIRED: 'Enter the reason for the trip.',
  MILEAGE_TRIP_DATE_IN_FUTURE: "Trips can't be dated in the future.",
  MILEAGE_TRIP_CONFLICT: 'This trip was changed elsewhere. Reload it and try again.',
  MILEAGE_TRIP_NOT_FOUND: 'Trip not found.',
  MILEAGE_OJ_TRIP_READ_ONLY: 'OJ Projects trips are changed in OJ Projects.',
  MILEAGE_APP_OUTDATED: 'Mileage was updated. Reload the page.',
}

function mapMileageSaveError(error: {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
}): string {
  const known = Object.keys(MILEAGE_SAVE_ERRORS).find((code) => error.message.includes(code))
  if (known) return MILEAGE_SAVE_ERRORS[known]
  console.error('[mileage] trip save failed', {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  })
  return 'Failed to save the trip. Nothing was changed. Try again.'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MileageDestination {
  id: string
  name: string
  postcode: string | null
  isHomeBase: boolean
  /** Distinct trips that visit this destination, whichever leg it appears on. */
  tripCount: number
  milesFromAnchor: number | null
}

interface MileageTripLeg {
  id: string
  legOrder: number
  fromDestinationId: string
  fromDestinationName: string
  toDestinationId: string
  toDestinationName: string
  miles: number
}

export type MileageDriverBasis = 'entered' | 'owner_statement' | 'oj_projects'

export interface MileageTrip {
  id: string
  tripDate: string
  description: string | null
  totalMiles: number
  milesAtStandardRate: number
  milesAtReducedRate: number
  amountDue: number
  source: 'manual' | 'oj_projects'
  createdAt: string
  legs: MileageTripLeg[]
  /** Human-readable route summary, e.g. "The Anchor -> Costco -> B&M -> The Anchor" */
  routeSummary: string
  /** Null until the historic backfill has set who drove. */
  driverId: string | null
  driverName: string | null
  driverBasis: MileageDriverBasis | null
  /** Exactly as PostgREST returned it; sent back unchanged for the stale-edit check. */
  updatedAt: string
}

export interface DistanceCacheEntry {
  fromDestinationId: string
  toDestinationId: string
  miles: number
}

export interface MileageDistance {
  fromDestinationId: string
  fromDestinationName: string
  toDestinationId: string
  toDestinationName: string
  miles: number
  lastUsedAt: string
}

// Row shapes for the paged reads. The admin client is untyped, and Postgres
// numeric columns can arrive as strings, so miles and money go through Number().
interface DestinationRow {
  id: string
  name: string
  postcode: string | null
  is_home_base: boolean
}

interface DestinationLegRow {
  id: string
  trip_id: string
  from_destination_id: string
  to_destination_id: string
}

interface DistanceRow {
  from_destination_id: string
  to_destination_id: string
  miles: number | string
}

interface DistanceEntryRow extends DistanceRow {
  last_used_at: string
}

interface InsightTripRow {
  id: string
  trip_date: string
  total_miles: number | string
  amount_due: number | string
}

interface InsightLegRow {
  id: string
  trip_id: string
  miles: number | string
  to_destination_id: string
  /** Embedded through the to_destination_id foreign key, so one object, not a list. */
  mileage_destinations: { name: string; is_home_base: boolean } | null
}

// ---------------------------------------------------------------------------
// Insight Types
// ---------------------------------------------------------------------------

export type MileageGranularity = 'monthly' | 'quarterly' | 'annually' | 'all'

interface MileageInsightBar {
  label: string
  periodStart: string
  totalMiles: number
  amountDue: number
}

interface MileageDestinationBreakdown {
  destinationName: string
  totalMiles: number
  amountDue: number
  tripCount: number
}

export interface MileageInsightsData {
  bars: MileageInsightBar[]
  totals: { totalMiles: number; totalAmountDue: number; tripCount: number }
  byDestination: MileageDestinationBreakdown[]
}

export interface MileageTripsPage {
  trips: MileageTrip[]
  total: number
  page: number
  pageSize: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireMileagePermission(action: 'view' | 'manage'): Promise<{
  userId: string
  userEmail: string
}> {
  const canAccess = await checkUserPermission('mileage', action)
  if (!canAccess) {
    throw new Error('Insufficient permissions')
  }
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) {
    throw new Error('Unauthorized')
  }
  return { userId: user_id, userEmail: user_email ?? '' }
}

function revalidateMileagePaths(): void {
  revalidatePath('/mileage')
  revalidatePath('/mileage/destinations')
}

/**
 * Canonical ordering for distance cache: smaller UUID first.
 */
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function hasAtMostOneDecimalPlace(miles: number): boolean {
  return Math.abs(Math.round(miles * 10) - miles * 10) < 0.000001
}

function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10
}

function sanitizeMileageSearchTerm(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function escapeCsvCell(rawValue: string): string {
  const safeValue = /^[=+\-@\t\r\n]/.test(rawValue) ? `'${rawValue}` : rawValue
  if (safeValue.includes(',') || safeValue.includes('"') || safeValue.includes('\n') || safeValue.includes('\r')) {
    return `"${safeValue.replace(/"/g, '""')}"`
  }
  return safeValue
}

function validateManualTripLegs(
  legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>,
  homeBaseId: string
): {
  error?: string
  legs?: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>
  totalMiles?: number
} {
  if (legs.length === 0) {
    return { error: 'At least one leg is required' }
  }

  if (legs[0].fromDestinationId !== homeBaseId) {
    return { error: 'First leg must start from The Anchor (home base)' }
  }
  if (legs[legs.length - 1].toDestinationId !== homeBaseId) {
    return { error: 'Last leg must end at The Anchor (home base)' }
  }

  const normalizedLegs = legs.map((leg, index) => {
    if (leg.fromDestinationId === leg.toDestinationId) {
      return { error: `Leg ${index + 1} must use two different destinations` }
    }
    if (!Number.isFinite(leg.miles) || leg.miles <= 0) {
      return { error: `Leg ${index + 1} miles must be greater than 0` }
    }
    if (!hasAtMostOneDecimalPlace(leg.miles)) {
      return { error: `Leg ${index + 1} miles must be rounded to 1 decimal place` }
    }
    return {
      fromDestinationId: leg.fromDestinationId,
      toDestinationId: leg.toDestinationId,
      miles: roundMiles(leg.miles),
    }
  })

  const firstError = normalizedLegs.find(
    (leg): leg is { error: string } => 'error' in leg
  )
  if (firstError) return { error: firstError.error }

  const typedLegs = normalizedLegs as Array<{
    fromDestinationId: string
    toDestinationId: string
    miles: number
  }>

  for (let i = 1; i < typedLegs.length; i++) {
    if (typedLegs[i].fromDestinationId !== typedLegs[i - 1].toDestinationId) {
      return { error: `Leg ${i + 1} must start where leg ${i} ends` }
    }
  }

  const totalMiles = roundMiles(typedLegs.reduce((sum, leg) => sum + leg.miles, 0))
  if (totalMiles <= 0) {
    return { error: 'Total miles must be greater than 0' }
  }

  return { legs: typedLegs, totalMiles }
}

function toMileageTripLegRpcPayload(
  legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>
) {
  return legs.map((leg) => ({
    from_destination_id: leg.fromDestinationId,
    to_destination_id: leg.toDestinationId,
    miles: leg.miles,
  }))
}

// ---------------------------------------------------------------------------
// QUERIES
// ---------------------------------------------------------------------------

export async function getDestinations(): Promise<{
  success?: boolean
  error?: string
  data?: MileageDestination[]
}> {
  try {
    await requireMileagePermission('view')
    const db = createAdminClient()

    // Every read below pages, because an unpaged select stops silently at 1,000 rows:
    // on 15 September 2026 Destinations counted 1,000 of 1,275 trip legs. Each order
    // ends on `id` so the page boundaries neither overlap nor skip.
    const destinations = await fetchAllRows<DestinationRow>(
      (from, to) =>
        db
          .from('mileage_destinations')
          .select('id, name, postcode, is_home_base')
          .order('name')
          .order('id')
          .range(from, to),
      { label: 'mileage destinations' }
    )

    // Get home base ID for distance lookups
    const homeBase = destinations.find((d) => d.is_home_base)

    const legs = await fetchAllRows<DestinationLegRow>(
      (from, to) =>
        db
          .from('mileage_trip_legs')
          .select('id, trip_id, from_destination_id, to_destination_id')
          .order('id')
          .range(from, to),
      { label: 'mileage trip legs' }
    )

    // Distinct trips per destination: a round trip visits its stop once, not twice.
    const tripsByDestination = new Map<string, Set<string>>()
    for (const leg of legs) {
      for (const destinationId of [leg.from_destination_id, leg.to_destination_id]) {
        const trips = tripsByDestination.get(destinationId) ?? new Set<string>()
        trips.add(leg.trip_id)
        tripsByDestination.set(destinationId, trips)
      }
    }

    // Get distance cache for Anchor -> each destination
    const distanceMap = new Map<string, number>()
    if (homeBase) {
      const distances = await fetchAllRows<DistanceRow>(
        (from, to) =>
          db
            .from('mileage_destination_distances')
            .select('from_destination_id, to_destination_id, miles')
            .order('id')
            .range(from, to),
        { label: 'mileage destination distances' }
      )

      for (const d of distances) {
        // Only care about distances involving the home base
        if (d.from_destination_id === homeBase.id) {
          distanceMap.set(d.to_destination_id, Number(d.miles))
        } else if (d.to_destination_id === homeBase.id) {
          distanceMap.set(d.from_destination_id, Number(d.miles))
        }
      }
    }

    const result: MileageDestination[] = destinations.map((d) => ({
      id: d.id,
      name: d.name,
      postcode: d.postcode,
      isHomeBase: d.is_home_base,
      tripCount: tripsByDestination.get(d.id)?.size ?? 0,
      milesFromAnchor: d.is_home_base ? 0 : (distanceMap.get(d.id) ?? null),
    }))

    return { success: true, data: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch destinations'
    return { error: message }
  }
}

export async function getTrips(filters?: {
  dateFrom?: string
  dateTo?: string
  searchTerm?: string
  page?: number
  pageSize?: number
}): Promise<{ success?: boolean; error?: string; data?: MileageTrip[]; pageInfo?: MileageTripsPage }> {
  try {
    await requireMileagePermission('view')
    const db = createAdminClient()
    const pageSize = Math.min(Math.max(Number(filters?.pageSize ?? 25), 1), 100)
    const page = Math.max(Number(filters?.page ?? 1), 1)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const searchTerm = sanitizeMileageSearchTerm(filters?.searchTerm)

    let matchingTripIds: string[] = []
    if (searchTerm) {
      const searchPattern = `%${searchTerm}%`
      const { data: matchingDestinations, error: destinationSearchError } = await db
        .from('mileage_destinations')
        .select('id')
        .ilike('name', searchPattern)
        .limit(100)

      if (destinationSearchError) throw destinationSearchError

      const destinationIds = (matchingDestinations ?? []).map((destination) => destination.id)
      if (destinationIds.length > 0) {
        const { data: matchingLegs, error: legSearchError } = await db
          .from('mileage_trip_legs')
          .select('trip_id')
          .or(
            `from_destination_id.in.(${destinationIds.join(',')}),to_destination_id.in.(${destinationIds.join(',')})`
          )

        if (legSearchError) throw legSearchError
        matchingTripIds = Array.from(new Set((matchingLegs ?? []).map((leg) => leg.trip_id)))
      }
    }

    let query = db
      .from('mileage_trips')
      .select('*, driver:mileage_drivers(display_name)', { count: 'exact' })
      .order('trip_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (filters?.dateFrom) {
      query = query.gte('trip_date', filters.dateFrom)
    }
    if (filters?.dateTo) {
      query = query.lte('trip_date', filters.dateTo)
    }
    if (searchTerm) {
      const searchPattern = `%${searchTerm}%`
      const clauses = [`description.ilike.${searchPattern}`]
      if (matchingTripIds.length > 0) {
        clauses.push(`id.in.(${matchingTripIds.join(',')})`)
      }
      query = query.or(clauses.join(','))
    }

    const { data: trips, error: tripError, count } = await query.range(from, to)
    if (tripError) throw tripError
    if (!trips || trips.length === 0) {
      return {
        success: true,
        data: [],
        pageInfo: { trips: [], total: count ?? 0, page, pageSize },
      }
    }

    // Fetch legs for all trips
    const tripIds = trips.map((t) => t.id)
    const { data: allLegs, error: legsError } = await db
      .from('mileage_trip_legs')
      .select('*')
      .in('trip_id', tripIds)
      .order('leg_order')

    if (legsError) throw legsError

    // Fetch destination names
    const destIds = new Set<string>()
    for (const leg of allLegs ?? []) {
      destIds.add(leg.from_destination_id)
      destIds.add(leg.to_destination_id)
    }

    const destNameMap = new Map<string, string>()
    if (destIds.size > 0) {
      const { data: dests, error: destsError } = await db
        .from('mileage_destinations')
        .select('id, name')
        .in('id', Array.from(destIds))

      if (destsError) throw destsError
      for (const d of dests ?? []) {
        destNameMap.set(d.id, d.name)
      }
    }

    // Group legs by trip
    const legsByTrip = new Map<string, MileageTripLeg[]>()
    for (const leg of allLegs ?? []) {
      const tripLegs = legsByTrip.get(leg.trip_id) ?? []
      tripLegs.push({
        id: leg.id,
        legOrder: leg.leg_order,
        fromDestinationId: leg.from_destination_id,
        fromDestinationName: destNameMap.get(leg.from_destination_id) ?? 'Unknown',
        toDestinationId: leg.to_destination_id,
        toDestinationName: destNameMap.get(leg.to_destination_id) ?? 'Unknown',
        miles: Number(leg.miles),
      })
      legsByTrip.set(leg.trip_id, tripLegs)
    }

    const result: MileageTrip[] = trips.map((t) => {
      const legs = legsByTrip.get(t.id) ?? []
      return {
        id: t.id,
        tripDate: t.trip_date,
        description: t.description,
        totalMiles: Number(t.total_miles),
        milesAtStandardRate: Number(t.miles_at_standard_rate),
        milesAtReducedRate: Number(t.miles_at_reduced_rate),
        amountDue: Number(t.amount_due),
        source: t.source as 'manual' | 'oj_projects',
        createdAt: t.created_at,
        legs,
        routeSummary: buildRouteSummary(legs, t.description),
        driverId: t.driver_id ?? null,
        // Embedded through the driver_id foreign key, so one object or null.
        driverName: (t.driver as { display_name: string } | null)?.display_name ?? null,
        driverBasis: (t.driver_basis as MileageDriverBasis | null) ?? null,
        updatedAt: t.updated_at,
      }
    })

    return {
      success: true,
      data: result,
      pageInfo: { trips: result, total: count ?? result.length, page, pageSize },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch trips'
    return { error: message }
  }
}

export async function exportMileageTripsCsv(filters?: {
  dateFrom?: string
  dateTo?: string
  searchTerm?: string
}): Promise<{ data?: string; filename?: string; error?: string }> {
  try {
    await requireMileagePermission('view')
    const result = await getTrips({
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo,
      searchTerm: filters?.searchTerm,
      page: 1,
      pageSize: 100,
    })

    if (result.error) return { error: result.error }

    const total = result.pageInfo?.total ?? result.data?.length ?? 0
    const pageSize = 100
    let trips = result.data ?? []

    if (total > pageSize) {
      const pageCount = Math.ceil(total / pageSize)
      const remainingPages = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, index) =>
          getTrips({
            dateFrom: filters?.dateFrom,
            dateTo: filters?.dateTo,
            searchTerm: filters?.searchTerm,
            page: index + 2,
            pageSize,
          })
        )
      )

      for (const pageResult of remainingPages) {
        if (pageResult.error) return { error: pageResult.error }
        trips = trips.concat(pageResult.data ?? [])
      }
    }

    const headers = [
      'Date',
      'Description',
      'Route',
      'Total Miles',
      'Standard Miles',
      'Reduced Miles',
      'Amount Due',
      'Source',
    ]
    const rows = trips.map((trip) => [
      formatDateInLondon(trip.tripDate, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      trip.description ?? '',
      trip.routeSummary,
      trip.totalMiles.toFixed(1),
      trip.milesAtStandardRate.toFixed(1),
      trip.milesAtReducedRate.toFixed(1),
      trip.amountDue.toFixed(2),
      trip.source === 'oj_projects' ? 'OJ Projects' : 'Manual',
    ])

    const csv = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    ].join('\n')

    return {
      data: csv,
      filename: `mileage-trips-${getTodayIsoDate()}.csv`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export trips'
    return { error: message }
  }
}

export async function getRatePreviewContext(input: {
  tripDate: string
  driverId: string | null
  excludeTripId?: string | null
}): Promise<{ data?: { cumulativeMilesBefore: number }; error?: string }> {
  try {
    await requireMileagePermission('view')
    const parsed = z
      .object({
        tripDate: isoDateSchema,
        driverId: z.string().uuid().nullable(),
        excludeTripId: z.string().uuid().optional().nullable(),
      })
      .safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid trip date' }
    }
    // The 10,000-mile limit is counted per driver, so there is nothing to count until one is chosen.
    if (!parsed.data.driverId) {
      return { data: { cumulativeMilesBefore: 0 } }
    }

    const db = createAdminClient()
    // p_trip_id defaults to null in the database; send it only when editing a saved trip.
    const { data, error } = await db.rpc('mileage_rate_preview_v01', {
      p_driver_id: parsed.data.driverId,
      p_trip_date: parsed.data.tripDate,
      ...(parsed.data.excludeTripId ? { p_trip_id: parsed.data.excludeTripId } : {}),
    })
    if (error) {
      console.error('[mileage] rate preview failed', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      return { error: 'Failed to calculate the rate preview' }
    }

    return { data: { cumulativeMilesBefore: roundMiles(Number(data ?? 0)) } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to calculate mileage preview'
    return { error: message }
  }
}

function buildRouteSummary(legs: MileageTripLeg[], description?: string | null): string {
  if (legs.length === 0) {
    return description ?? 'Trip'
  }
  const stops = [legs[0].fromDestinationName]
  for (const leg of legs) {
    stops.push(leg.toDestinationName)
  }
  return stops.join(' \u2192 ')
}

export async function getTripStats(): Promise<{
  success?: boolean
  error?: string
  data?: TaxYearStats
}> {
  try {
    await requireMileagePermission('view')
    const db = createAdminClient()

    const today = getTodayIsoDate()
    const { start: taxYearStart, end: taxYearEnd } = getTaxYearBounds(today)
    const calendarYear = Number(today.slice(0, 4))
    const calendarYearStart = `${calendarYear}-01-01`
    const calendarYearEnd = `${calendarYear}-12-31`

    // Tax year trips
    const { data: taxYearTrips, error: tyError } = await db
      .from('mileage_trips')
      .select('total_miles, amount_due, trip_date')
      .gte('trip_date', taxYearStart)
      .lte('trip_date', taxYearEnd)

    if (tyError) throw tyError

    const { data: calendarYearTrips, error: cyError } = await db
      .from('mileage_trips')
      .select('total_miles, amount_due, trip_date')
      .gte('trip_date', calendarYearStart)
      .lte('trip_date', calendarYearEnd)

    if (cyError) throw cyError

    const taxYearTotalMiles = (taxYearTrips ?? []).reduce(
      (sum, t) => sum + Number(t.total_miles),
      0
    )
    const taxYearAmountDue = (taxYearTrips ?? []).reduce(
      (sum, t) => sum + Number(t.amount_due),
      0
    )
    const calendarYearTotalMiles = (calendarYearTrips ?? []).reduce(
      (sum, t) => sum + Number(t.total_miles),
      0
    )
    const calendarYearAmountDue = (calendarYearTrips ?? []).reduce(
      (sum, t) => sum + Number(t.amount_due),
      0
    )

    // Current quarter: determine quarter boundaries
    const { quarterStart, quarterEnd } = getCurrentQuarter(today)

    const quarterMiles = (calendarYearTrips ?? [])
      .filter((t) => t.trip_date >= quarterStart && t.trip_date <= quarterEnd)
      .reduce((sum, t) => sum + Number(t.total_miles), 0)

    const quarterAmount = (calendarYearTrips ?? [])
      .filter((t) => t.trip_date >= quarterStart && t.trip_date <= quarterEnd)
      .reduce((sum, t) => sum + Number(t.amount_due), 0)

    return {
      success: true,
      data: {
        quarterTotalMiles: Math.round(quarterMiles * 10) / 10,
        quarterAmountDue: Math.round(quarterAmount * 100) / 100,
        calendarYear,
        calendarYearTotalMiles: Math.round(calendarYearTotalMiles * 10) / 10,
        calendarYearAmountDue: Math.round(calendarYearAmountDue * 100) / 100,
        taxYearTotalMiles: Math.round(taxYearTotalMiles * 10) / 10,
        taxYearAmountDue: Math.round(taxYearAmountDue * 100) / 100,
        milesToThreshold: Math.max(0, THRESHOLD_MILES - taxYearTotalMiles),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch trip stats'
    return { error: message }
  }
}

function getCurrentQuarter(
  isoDate: string
): { quarterStart: string; quarterEnd: string } {
  const [yearStr, monthStr] = isoDate.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)

  // Calendar quarters
  if (month <= 3) {
    return { quarterStart: `${year}-01-01`, quarterEnd: `${year}-03-31` }
  } else if (month <= 6) {
    return { quarterStart: `${year}-04-01`, quarterEnd: `${year}-06-30` }
  } else if (month <= 9) {
    return { quarterStart: `${year}-07-01`, quarterEnd: `${year}-09-30` }
  } else {
    return { quarterStart: `${year}-10-01`, quarterEnd: `${year}-12-31` }
  }
}

export async function getDistanceCache(
  fromId: string,
  toId: string
): Promise<{ success?: boolean; error?: string; data?: DistanceCacheEntry | null }> {
  try {
    await requireMileagePermission('view')
    const db = createAdminClient()
    const [canonFrom, canonTo] = canonicalPair(fromId, toId)

    const { data, error } = await db
      .from('mileage_destination_distances')
      .select('from_destination_id, to_destination_id, miles')
      .eq('from_destination_id', canonFrom)
      .eq('to_destination_id', canonTo)
      .maybeSingle()

    if (error) throw error
    if (!data) return { success: true, data: null }

    return {
      success: true,
      data: {
        fromDestinationId: data.from_destination_id,
        toDestinationId: data.to_destination_id,
        miles: Number(data.miles),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch distance'
    return { error: message }
  }
}

export async function getDistanceEntries(): Promise<{
  success?: boolean
  error?: string
  data?: MileageDistance[]
}> {
  try {
    await requireMileagePermission('view')
    const db = createAdminClient()

    // Paged, with `id` breaking ties in last_used_at so no distance is skipped or repeated.
    const distances = await fetchAllRows<DistanceEntryRow>(
      (from, to) =>
        db
          .from('mileage_destination_distances')
          .select('from_destination_id, to_destination_id, miles, last_used_at')
          .order('last_used_at', { ascending: false })
          .order('id')
          .range(from, to),
      { label: 'mileage destination distances' }
    )

    if (distances.length === 0) {
      return { success: true, data: [] }
    }

    const destinationIds = new Set<string>()
    for (const distance of distances) {
      destinationIds.add(distance.from_destination_id)
      destinationIds.add(distance.to_destination_id)
    }

    const { data: destinations, error: destinationError } = await db
      .from('mileage_destinations')
      .select('id, name')
      .in('id', Array.from(destinationIds))

    if (destinationError) throw destinationError

    const destinationNameMap = new Map<string, string>()
    for (const destination of destinations ?? []) {
      destinationNameMap.set(destination.id, destination.name)
    }

    const result: MileageDistance[] = distances.map((distance) => ({
      fromDestinationId: distance.from_destination_id,
      fromDestinationName:
        destinationNameMap.get(distance.from_destination_id) ?? 'Unknown destination',
      toDestinationId: distance.to_destination_id,
      toDestinationName:
        destinationNameMap.get(distance.to_destination_id) ?? 'Unknown destination',
      miles: Number(distance.miles),
      lastUsedAt: distance.last_used_at,
    }))

    return { success: true, data: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch distances'
    return { error: message }
  }
}

// ---------------------------------------------------------------------------
// MUTATIONS
// ---------------------------------------------------------------------------

export async function createDestination(input: {
  name: string
  postcode?: string
}): Promise<{ success?: boolean; error?: string; data?: { id: string } }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const db = createAdminClient()

    const parsed = destinationSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const { data: newDest, error: insertError } = await db
      .from('mileage_destinations')
      .insert({
        name: parsed.data.name.trim(),
        postcode: parsed.data.postcode?.trim() || null,
        is_home_base: false,
        created_by: userId,
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    await logAuditEvent({
      user_id: userId,
      operation_type: 'create',
      resource_type: 'mileage_destination',
      resource_id: newDest.id,
      operation_status: 'success',
      new_values: { name: parsed.data.name, postcode: parsed.data.postcode },
    })

    revalidateMileagePaths()
    return { success: true, data: { id: newDest.id } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create destination'
    return { error: message }
  }
}

export async function updateDestination(input: {
  id: string
  name: string
  postcode?: string
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const db = createAdminClient()

    const parsed = destinationSchema.safeParse({ name: input.name, postcode: input.postcode })
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    // Fetch existing to prevent home base changes
    const { data: existing, error: fetchError } = await db
      .from('mileage_destinations')
      .select('id, name, postcode, is_home_base')
      .eq('id', input.id)
      .single()

    if (fetchError || !existing) {
      return { error: 'Destination not found' }
    }

    const { error: updateError } = await db
      .from('mileage_destinations')
      .update({
        name: parsed.data.name.trim(),
        postcode: parsed.data.postcode?.trim() || null,
      })
      .eq('id', input.id)

    if (updateError) throw updateError

    await logAuditEvent({
      user_id: userId,
      operation_type: 'update',
      resource_type: 'mileage_destination',
      resource_id: input.id,
      operation_status: 'success',
      old_values: { name: existing.name, postcode: existing.postcode },
      new_values: { name: parsed.data.name, postcode: parsed.data.postcode },
    })

    revalidateMileagePaths()
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update destination'
    return { error: message }
  }
}

export async function upsertDistanceCache(input: {
  fromDestinationId: string
  toDestinationId: string
  miles: number
}): Promise<{ success?: boolean; error?: string; data?: DistanceCacheEntry }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const db = createAdminClient()

    const parsed = distanceCacheSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid distance' }
    }

    if (parsed.data.fromDestinationId === parsed.data.toDestinationId) {
      return { error: 'Choose two different destinations' }
    }

    const [canonFrom, canonTo] = canonicalPair(
      parsed.data.fromDestinationId,
      parsed.data.toDestinationId
    )
    const miles = roundMiles(parsed.data.miles)

    const { data: existing, error: existingError } = await db
      .from('mileage_destination_distances')
      .select('miles')
      .eq('from_destination_id', canonFrom)
      .eq('to_destination_id', canonTo)
      .maybeSingle()

    if (existingError) throw existingError

    const { error: upsertError } = await db
      .from('mileage_destination_distances')
      .upsert(
        {
          from_destination_id: canonFrom,
          to_destination_id: canonTo,
          miles,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'from_destination_id,to_destination_id' }
      )

    if (upsertError) throw upsertError

    await logAuditEvent({
      user_id: userId,
      operation_type: existing ? 'update' : 'create',
      resource_type: 'mileage_destination_distance',
      resource_id: `${canonFrom}:${canonTo}`,
      operation_status: 'success',
      old_values: existing ? { miles: Number(existing.miles) } : undefined,
      new_values: {
        from_destination_id: canonFrom,
        to_destination_id: canonTo,
        miles,
      },
    })

    revalidateMileagePaths()
    return {
      success: true,
      data: {
        fromDestinationId: canonFrom,
        toDestinationId: canonTo,
        miles,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save distance'
    return { error: message }
  }
}

export async function deleteDistanceCache(input: {
  fromDestinationId: string
  toDestinationId: string
}): Promise<{ success?: boolean; error?: string; data?: DistanceCacheEntry }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const parsed = z.object({
      fromDestinationId: z.string().uuid(),
      toDestinationId: z.string().uuid(),
    }).safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid distance' }
    }
    if (parsed.data.fromDestinationId === parsed.data.toDestinationId) {
      return { error: 'Choose two different destinations' }
    }

    const db = createAdminClient()
    const [canonFrom, canonTo] = canonicalPair(
      parsed.data.fromDestinationId,
      parsed.data.toDestinationId
    )

    const { data: existing, error: fetchError } = await db
      .from('mileage_destination_distances')
      .select('from_destination_id, to_destination_id, miles')
      .eq('from_destination_id', canonFrom)
      .eq('to_destination_id', canonTo)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!existing) return { error: 'Distance not found' }

    const { error: deleteError } = await db
      .from('mileage_destination_distances')
      .delete()
      .eq('from_destination_id', canonFrom)
      .eq('to_destination_id', canonTo)

    if (deleteError) throw deleteError

    await logAuditEvent({
      user_id: userId,
      operation_type: 'delete',
      resource_type: 'mileage_destination_distance',
      resource_id: `${canonFrom}:${canonTo}`,
      operation_status: 'success',
      old_values: {
        from_destination_id: canonFrom,
        to_destination_id: canonTo,
        miles: Number(existing.miles),
      },
    })

    revalidateMileagePaths()
    return {
      success: true,
      data: {
        fromDestinationId: canonFrom,
        toDestinationId: canonTo,
        miles: Number(existing.miles),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete distance'
    return { error: message }
  }
}

export async function deleteDestination(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const db = createAdminClient()

    // Check if destination is home base
    const { data: dest, error: fetchError } = await db
      .from('mileage_destinations')
      .select('id, name, is_home_base')
      .eq('id', id)
      .single()

    if (fetchError || !dest) {
      return { error: 'Destination not found' }
    }
    if (dest.is_home_base) {
      return { error: 'Cannot delete the home base destination' }
    }

    // Check if referenced by trip legs
    const { count, error: countError } = await db
      .from('mileage_trip_legs')
      .select('id', { count: 'exact', head: true })
      .or(`from_destination_id.eq.${id},to_destination_id.eq.${id}`)

    if (countError) throw countError
    if (count && count > 0) {
      return { error: `Cannot delete: destination is used in ${count} trip leg(s)` }
    }

    const { error: deleteError } = await db
      .from('mileage_destinations')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    await logAuditEvent({
      user_id: userId,
      operation_type: 'delete',
      resource_type: 'mileage_destination',
      resource_id: id,
      operation_status: 'success',
      old_values: { name: dest.name },
    })

    revalidateMileagePaths()
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete destination'
    return { error: message }
  }
}

export async function createTrip(input: {
  tripDate: string
  description: string
  driverId: string
  /** One per new trip form: a retried save with the same id returns the trip it created. */
  requestId: string
  legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>
}): Promise<{ success?: boolean; error?: string; data?: { id: string } }> {
  try {
    const { userId } = await requireMileagePermission('manage')

    const parsed = createTripSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const { tripDate, description, driverId, requestId } = parsed.data
    if (tripDate > getTodayIsoDate()) {
      return { error: "Trips can't be dated in the future." }
    }

    const db = createAdminClient()

    // Validate leg chain: first leg must start from home base, last must end at home base
    const { data: homeBase } = await db
      .from('mileage_destinations')
      .select('id')
      .eq('is_home_base', true)
      .single()

    if (!homeBase) {
      return { error: 'Home base destination not found' }
    }

    const validated = validateManualTripLegs(parsed.data.legs, homeBase.id)
    if (validated.error || !validated.legs || !validated.totalMiles) {
      return { error: validated.error ?? 'Invalid trip legs' }
    }
    const legs = validated.legs
    const totalMiles = validated.totalMiles

    // Cache leg distances before creating the trip so uncached pairs are saved
    // for future prefill and cache write failures do not leave a partial trip.
    await cacheDistances(db, legs)

    const { data, error: tripError } = await db.rpc('create_manual_mileage_trip_v02', {
      p_trip_date: tripDate,
      p_description: description,
      p_total_miles: totalMiles,
      p_created_by: userId,
      p_legs: toMileageTripLegRpcPayload(legs),
      p_driver_id: driverId,
      p_request_id: requestId,
    })

    if (tripError) {
      return { error: mapMileageSaveError(tripError) }
    }

    const saved = data as { id?: string; created?: boolean } | null
    if (!saved?.id) {
      return { error: 'Failed to save the trip. Nothing was changed. Try again.' }
    }

    // A retry that found the trip its first attempt created was already audited.
    if (saved.created) {
      await logAuditEvent({
        user_id: userId,
        operation_type: 'create',
        resource_type: 'mileage_trip',
        resource_id: saved.id,
        operation_status: 'success',
        new_values: {
          trip_date: tripDate,
          total_miles: totalMiles,
          legs: legs.length,
          driver_id: driverId,
        },
      })
    }

    revalidateMileagePaths()
    return { success: true, data: { id: saved.id } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create trip'
    return { error: message }
  }
}

export async function updateTrip(input: {
  id: string
  tripDate: string
  description: string
  driverId: string
  /** updated_at exactly as it was loaded. Never parse it into a Date, which drops microseconds. */
  expectedUpdatedAt: string
  legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireMileagePermission('manage')

    const parsed = updateTripSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const { id, tripDate, description, driverId, expectedUpdatedAt } = parsed.data
    if (tripDate > getTodayIsoDate()) {
      return { error: "Trips can't be dated in the future." }
    }

    const db = createAdminClient()

    // Check if trip exists and is editable
    const { data: existing, error: fetchError } = await db
      .from('mileage_trips')
      .select('id, source, trip_date, total_miles')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return { error: 'Trip not found.' }
    }
    if (existing.source === 'oj_projects') {
      return { error: 'OJ Projects trips are changed in OJ Projects.' }
    }

    // Validate chain (same as create)
    const { data: homeBase } = await db
      .from('mileage_destinations')
      .select('id')
      .eq('is_home_base', true)
      .single()

    if (!homeBase) return { error: 'Home base not found' }

    const validated = validateManualTripLegs(parsed.data.legs, homeBase.id)
    if (validated.error || !validated.legs || !validated.totalMiles) {
      return { error: validated.error ?? 'Invalid trip legs' }
    }
    const legs = validated.legs
    const totalMiles = validated.totalMiles

    // Cache leg distances before replacing the trip rows. If this fails, the
    // existing trip is left untouched and the user can retry.
    await cacheDistances(db, legs)

    const { error: updateError } = await db.rpc('update_manual_mileage_trip_v02', {
      p_trip_id: id,
      p_trip_date: tripDate,
      p_description: description,
      p_total_miles: totalMiles,
      p_legs: toMileageTripLegRpcPayload(legs),
      p_driver_id: driverId,
      p_expected_updated_at: expectedUpdatedAt,
    })

    if (updateError) {
      return { error: mapMileageSaveError(updateError) }
    }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'update',
      resource_type: 'mileage_trip',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        trip_date: existing.trip_date,
        total_miles: Number(existing.total_miles),
      },
      new_values: {
        trip_date: tripDate,
        total_miles: totalMiles,
        driver_id: driverId,
      },
    })

    revalidateMileagePaths()
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update trip'
    return { error: message }
  }
}

export async function deleteTrip(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const db = createAdminClient()

    const { data: existing, error: fetchError } = await db
      .from('mileage_trips')
      .select('id, source, trip_date, total_miles')
      .eq('id', id)
      .single()

    if (fetchError || !existing) return { error: 'Trip not found' }
    if (existing.source === 'oj_projects') {
      return { error: 'Cannot delete OJ Projects synced trips' }
    }

    const { error: deleteError } = await db
      .from('mileage_trips')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    // trg_mileage_trips_recalculate repriced the rest of the tax year inside the delete itself.
    await logAuditEvent({
      user_id: userId,
      operation_type: 'delete',
      resource_type: 'mileage_trip',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        trip_date: existing.trip_date,
        total_miles: Number(existing.total_miles),
      },
    })

    revalidateMileagePaths()
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete trip'
    return { error: message }
  }
}

// ---------------------------------------------------------------------------
// Distance cache helper
// ---------------------------------------------------------------------------

async function cacheDistances(
  db: ReturnType<typeof createAdminClient>,
  legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>
): Promise<void> {
  for (const leg of legs) {
    const [canonFrom, canonTo] = canonicalPair(leg.fromDestinationId, leg.toDestinationId)
    const { error } = await db
      .from('mileage_destination_distances')
      .upsert(
        {
          from_destination_id: canonFrom,
          to_destination_id: canonTo,
          miles: roundMiles(leg.miles),
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'from_destination_id,to_destination_id' }
      )

    if (error) {
      throw new Error(`Failed to save route distance: ${error.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// INSIGHTS
// ---------------------------------------------------------------------------

/**
 * Fetch mileage trip data aggregated by period for insights charts,
 * plus a breakdown by destination.
 */
export async function getMileageInsights(
  granularity: MileageGranularity = 'monthly'
): Promise<{ success: boolean; data?: MileageInsightsData; error?: string }> {
  try {
    await requireMileagePermission('view')
    const supabase = createAdminClient()

    // Every trip, read in pages: an unpaged select stops silently at 1,000 rows. `id`
    // breaks ties between trips on the same date so pages neither overlap nor skip.
    const trips = await fetchAllRows<InsightTripRow>(
      (from, to) =>
        supabase
          .from('mileage_trips')
          .select('id, trip_date, total_miles, amount_due')
          .order('trip_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'mileage trips' }
    )

    if (trips.length === 0) {
      return {
        success: true,
        data: {
          bars: [],
          totals: { totalMiles: 0, totalAmountDue: 0, tripCount: 0 },
          byDestination: [],
        },
      }
    }

    // Group trips into period buckets
    const buckets = new Map<string, { label: string; periodStart: string; totalMiles: number; amountDue: number }>()

    for (const trip of trips) {
      const dateStr = trip.trip_date as string
      const [y, m] = dateStr.split('-').map(Number)
      let key: string
      let label: string
      let periodStart: string

      if (granularity === 'annually') {
        key = `${y}`
        label = `${y}`
        periodStart = `${y}-01-01`
      } else if (granularity === 'quarterly') {
        const q = Math.ceil(m / 3)
        const qStart = (q - 1) * 3 + 1
        key = `${y}-Q${q}`
        label = `Q${q} ${y}`
        periodStart = `${y}-${String(qStart).padStart(2, '0')}-01`
      } else {
        // monthly (default) and 'all' both show monthly bars
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        key = `${y}-${String(m).padStart(2, '0')}`
        label = `${monthNames[m - 1]} ${y}`
        periodStart = `${y}-${String(m).padStart(2, '0')}-01`
      }

      const miles = Number(trip.total_miles)
      const amt = Number(trip.amount_due)

      const existing = buckets.get(key)
      if (existing) {
        existing.totalMiles += miles
        existing.amountDue += amt
      } else {
        buckets.set(key, { label, periodStart, totalMiles: miles, amountDue: amt })
      }
    }

    const bars: MileageInsightBar[] = Array.from(buckets.values()).sort(
      (a, b) => a.periodStart.localeCompare(b.periodStart)
    )

    // Every leg with its destination name, read in pages. The old `.in('trip_id', ids)`
    // filter was redundant (every leg belongs to a trip) and its list grew with every trip.
    const legs = await fetchAllRows<InsightLegRow>(
      (from, to) =>
        // The untyped client guesses the embed is a list; a to-one foreign key returns
        // one object, so the rows are cast to their real shape.
        supabase
          .from('mileage_trip_legs')
          .select(
            'id, trip_id, miles, to_destination_id, mileage_destinations!mileage_trip_legs_to_destination_id_fkey(name, is_home_base)'
          )
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<PagedReadResult<InsightLegRow>>,
      { label: 'mileage trip legs' }
    )

    // Build trip lookup for amount_due proportioning
    const tripLookup = new Map(trips.map((t) => [t.id as string, { totalMiles: Number(t.total_miles), amountDue: Number(t.amount_due) }]))

    // Group legs by destination (excluding home base)
    const destMap = new Map<string, { totalMiles: number; amountDue: number; tripIds: Set<string> }>()

    for (const leg of legs) {
      const dest = leg.mileage_destinations
      if (!dest || dest.is_home_base) continue

      const destName = dest.name
      const legMiles = Number(leg.miles)
      const trip = tripLookup.get(leg.trip_id as string)
      const legAmountDue = trip && trip.totalMiles > 0
        ? (legMiles / trip.totalMiles) * trip.amountDue
        : 0

      const existing = destMap.get(destName)
      if (existing) {
        existing.totalMiles += legMiles
        existing.amountDue += legAmountDue
        existing.tripIds.add(leg.trip_id as string)
      } else {
        destMap.set(destName, {
          totalMiles: legMiles,
          amountDue: legAmountDue,
          tripIds: new Set([leg.trip_id as string]),
        })
      }
    }

    const byDestination: MileageDestinationBreakdown[] = Array.from(destMap.entries())
      .map(([destinationName, vals]) => ({
        destinationName,
        totalMiles: Math.round(vals.totalMiles * 10) / 10,
        amountDue: Math.round(vals.amountDue * 100) / 100,
        tripCount: vals.tripIds.size,
      }))
      .sort((a, b) => b.totalMiles - a.totalMiles)

    const totals = {
      totalMiles: trips.reduce((sum, t) => sum + Number(t.total_miles), 0),
      totalAmountDue: trips.reduce((sum, t) => sum + Number(t.amount_due), 0),
      tripCount: trips.length,
    }

    return { success: true, data: { bars, totals, byDestination } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch mileage insights'
    return { success: false, error: message }
  }
}
