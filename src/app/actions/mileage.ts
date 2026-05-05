'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import {
  getTaxYearBounds,
  THRESHOLD_MILES,
  STANDARD_RATE,
  type TaxYearStats,
} from '@/lib/mileage/hmrcRates'
import { recalculateTaxYearMileage } from '@/lib/mileage/recalculateTaxYear'

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

const createTripSchema = z.object({
  tripDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  description: z.string().optional().or(z.literal('')),
  legs: z.array(tripLegSchema).min(1, 'At least one leg is required'),
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MileageDestination {
  id: string
  name: string
  postcode: string | null
  isHomeBase: boolean
  tripCount: number
  milesFromAnchor: number | null
}

export interface MileageTripLeg {
  id: string
  legOrder: number
  fromDestinationId: string
  fromDestinationName: string
  toDestinationId: string
  toDestinationName: string
  miles: number
}

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

// ---------------------------------------------------------------------------
// Insight Types
// ---------------------------------------------------------------------------

export type MileageGranularity = 'monthly' | 'quarterly' | 'annually' | 'all'

export interface MileageInsightBar {
  label: string
  periodStart: string
  totalMiles: number
  amountDue: number
}

export interface MileageDestinationBreakdown {
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

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100
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

    // Get all destinations
    const { data: destinations, error: destError } = await db
      .from('mileage_destinations')
      .select('id, name, postcode, is_home_base')
      .order('name')

    if (destError) throw destError
    if (!destinations) return { success: true, data: [] }

    // Get home base ID for distance lookups
    const homeBase = destinations.find((d) => d.is_home_base)

    // Get trip counts per destination (count legs referencing each destination)
    const { data: legCounts, error: legError } = await db
      .from('mileage_trip_legs')
      .select('from_destination_id, to_destination_id')

    if (legError) throw legError

    // Count how many legs reference each destination
    const tripCountMap = new Map<string, number>()
    for (const leg of legCounts ?? []) {
      tripCountMap.set(
        leg.from_destination_id,
        (tripCountMap.get(leg.from_destination_id) ?? 0) + 1
      )
      tripCountMap.set(
        leg.to_destination_id,
        (tripCountMap.get(leg.to_destination_id) ?? 0) + 1
      )
    }

    // Get distance cache for Anchor -> each destination
    const distanceMap = new Map<string, number>()
    if (homeBase) {
      const { data: distances } = await db
        .from('mileage_destination_distances')
        .select('from_destination_id, to_destination_id, miles')

      for (const d of distances ?? []) {
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
      tripCount: tripCountMap.get(d.id) ?? 0,
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
}): Promise<{ success?: boolean; error?: string; data?: MileageTrip[] }> {
  try {
    await requireMileagePermission('view')
    const db = createAdminClient()

    let query = db
      .from('mileage_trips')
      .select('*')
      .order('trip_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (filters?.dateFrom) {
      query = query.gte('trip_date', filters.dateFrom)
    }
    if (filters?.dateTo) {
      query = query.lte('trip_date', filters.dateTo)
    }

    const { data: trips, error: tripError } = await query
    if (tripError) throw tripError
    if (!trips || trips.length === 0) return { success: true, data: [] }

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
      }
    })

    return { success: true, data: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch trips'
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

    // Tax year trips
    const { data: taxYearTrips, error: tyError } = await db
      .from('mileage_trips')
      .select('total_miles, amount_due, trip_date')
      .gte('trip_date', taxYearStart)
      .lte('trip_date', taxYearEnd)

    if (tyError) throw tyError

    const taxYearTotalMiles = (taxYearTrips ?? []).reduce(
      (sum, t) => sum + Number(t.total_miles),
      0
    )
    const taxYearAmountDue = (taxYearTrips ?? []).reduce(
      (sum, t) => sum + Number(t.amount_due),
      0
    )

    // Current quarter: determine quarter boundaries
    const { quarterStart, quarterEnd } = getCurrentQuarter(today)

    const quarterMiles = (taxYearTrips ?? [])
      .filter((t) => t.trip_date >= quarterStart && t.trip_date <= quarterEnd)
      .reduce((sum, t) => sum + Number(t.total_miles), 0)

    const quarterAmount = (taxYearTrips ?? [])
      .filter((t) => t.trip_date >= quarterStart && t.trip_date <= quarterEnd)
      .reduce((sum, t) => sum + Number(t.amount_due), 0)

    return {
      success: true,
      data: {
        quarterTotalMiles: Math.round(quarterMiles * 10) / 10,
        quarterAmountDue: Math.round(quarterAmount * 100) / 100,
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

    const { data: distances, error: distanceError } = await db
      .from('mileage_destination_distances')
      .select('from_destination_id, to_destination_id, miles, last_used_at')
      .order('last_used_at', { ascending: false })

    if (distanceError) throw distanceError
    if (!distances || distances.length === 0) {
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
  description?: string
  legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>
}): Promise<{ success?: boolean; error?: string; data?: { id: string } }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const db = createAdminClient()

    const parsed = createTripSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const { tripDate, description } = parsed.data

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

    // Insert trip with default rates; the shared recalculation below will
    // apply the correct cumulative HMRC threshold split for the whole tax year.
    const { data: newTrip, error: tripError } = await db
      .from('mileage_trips')
      .insert({
        trip_date: tripDate,
        description: description?.trim() || null,
        total_miles: totalMiles,
        miles_at_standard_rate: totalMiles,
        miles_at_reduced_rate: 0,
        amount_due: roundCurrency(totalMiles * STANDARD_RATE),
        source: 'manual',
        created_by: userId,
      })
      .select('id')
      .single()

    if (tripError) throw tripError

    // Insert legs
    const legInserts = legs.map((leg, index) => ({
      trip_id: newTrip.id,
      leg_order: index + 1,
      from_destination_id: leg.fromDestinationId,
      to_destination_id: leg.toDestinationId,
      miles: leg.miles,
    }))

    const { error: legsError } = await db
      .from('mileage_trip_legs')
      .insert(legInserts)

    if (legsError) throw legsError

    // Recalculate HMRC rate splits for all trips in the affected tax year
    await recalculateTaxYearMileage(tripDate)

    await logAuditEvent({
      user_id: userId,
      operation_type: 'create',
      resource_type: 'mileage_trip',
      resource_id: newTrip.id,
      operation_status: 'success',
      new_values: {
        trip_date: tripDate,
        total_miles: totalMiles,
        legs: legs.length,
      },
    })

    revalidateMileagePaths()
    return { success: true, data: { id: newTrip.id } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create trip'
    return { error: message }
  }
}

export async function updateTrip(input: {
  id: string
  tripDate: string
  description?: string
  legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }>
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireMileagePermission('manage')
    const db = createAdminClient()

    // Check if trip exists and is editable
    const { data: existing, error: fetchError } = await db
      .from('mileage_trips')
      .select('id, source, trip_date, total_miles')
      .eq('id', input.id)
      .single()

    if (fetchError || !existing) {
      return { error: 'Trip not found' }
    }
    if (existing.source === 'oj_projects') {
      return { error: 'Cannot edit OJ Projects synced trips' }
    }

    const parsed = createTripSchema.safeParse({
      tripDate: input.tripDate,
      description: input.description,
      legs: input.legs,
    })
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const { tripDate, description } = parsed.data

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

    // Save the old trip date before updating, so we can recalculate BOTH tax years
    // if the date moved across the 6 April boundary.
    const oldTripDate = existing.trip_date

    // Cache leg distances before replacing the trip rows. If this fails, the
    // existing trip is left untouched and the user can retry.
    await cacheDistances(db, legs)

    // Update trip with default rates; the shared recalculation below will
    // apply the correct cumulative HMRC threshold split for the whole tax year.
    const { error: updateError } = await db
      .from('mileage_trips')
      .update({
        trip_date: tripDate,
        description: description?.trim() || null,
        total_miles: totalMiles,
        miles_at_standard_rate: totalMiles,
        miles_at_reduced_rate: 0,
        amount_due: roundCurrency(totalMiles * STANDARD_RATE),
      })
      .eq('id', input.id)

    if (updateError) throw updateError

    // Replace legs: delete existing, insert new
    const { error: deleteLegsError } = await db
      .from('mileage_trip_legs')
      .delete()
      .eq('trip_id', input.id)

    if (deleteLegsError) throw deleteLegsError

    const legInserts = legs.map((leg, index) => ({
      trip_id: input.id,
      leg_order: index + 1,
      from_destination_id: leg.fromDestinationId,
      to_destination_id: leg.toDestinationId,
      miles: leg.miles,
    }))

    const { error: insertLegsError } = await db
      .from('mileage_trip_legs')
      .insert(legInserts)

    if (insertLegsError) throw insertLegsError

    // Recalculate HMRC rate splits for the new tax year
    await recalculateTaxYearMileage(tripDate)

    // If the date changed across a tax year boundary, also recalculate the old tax year
    const oldTaxYear = getTaxYearBounds(oldTripDate)
    const newTaxYear = getTaxYearBounds(tripDate)
    if (oldTaxYear.start !== newTaxYear.start) {
      await recalculateTaxYearMileage(oldTripDate)
    }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'update',
      resource_type: 'mileage_trip',
      resource_id: input.id,
      operation_status: 'success',
      old_values: {
        trip_date: existing.trip_date,
        total_miles: Number(existing.total_miles),
      },
      new_values: {
        trip_date: tripDate,
        total_miles: totalMiles,
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

    // Recalculate HMRC rate splits for remaining trips in the affected tax year
    await recalculateTaxYearMileage(existing.trip_date)

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

    // Fetch all trips
    const { data: trips, error: tripError } = await supabase
      .from('mileage_trips')
      .select('id, trip_date, total_miles, amount_due')
      .order('trip_date', { ascending: true })

    if (tripError) return { success: false, error: 'Failed to fetch mileage trips' }

    if (!trips || trips.length === 0) {
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

    // Fetch trip legs with destination names for breakdown
    const tripIds = trips.map((t) => t.id as string)
    const { data: legs, error: legError } = await supabase
      .from('mileage_trip_legs')
      .select('trip_id, miles, to_destination_id, mileage_destinations!mileage_trip_legs_to_destination_id_fkey(name, is_home_base)')
      .in('trip_id', tripIds)

    if (legError) return { success: false, error: 'Failed to fetch trip legs' }

    // Build trip lookup for amount_due proportioning
    const tripLookup = new Map(trips.map((t) => [t.id as string, { totalMiles: Number(t.total_miles), amountDue: Number(t.amount_due) }]))

    // Group legs by destination (excluding home base)
    const destMap = new Map<string, { totalMiles: number; amountDue: number; tripIds: Set<string> }>()

    for (const leg of legs ?? []) {
      const dest = leg.mileage_destinations as unknown as { name: string; is_home_base: boolean } | null
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
