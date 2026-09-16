/**
 * Plans and applies the historic driver backfill (spec 5.3). The owner's statement of 15 September
 * 2026 sets the rule: the OJ Projects driver drove every OJ Projects trip and the roadshows, and the
 * other driver drove everything else.
 *
 * `planDriverBackfill` is pure. `runDriverBackfill` loads every row through paged reads, prints the
 * plan, and writes only with --confirm and RUN_MILEAGE_DRIVER_BACKFILL_MUTATION=true. The script in
 * scripts/mileage/backfill-trip-drivers.ts only parses arguments and calls it. Driver names come
 * from the command line at run time and are never committed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
} from '@/lib/script-mutation-safety'

export const DRIVER_BACKFILL_SCRIPT_NAME = 'mileage-driver-backfill'
export const DRIVER_BACKFILL_MUTATION_ENV = 'RUN_MILEAGE_DRIVER_BACKFILL_MUTATION'
const AUDIT_CHANGE = 'mileage_driver_backfill_2026'
const BATCH_SIZE = 100

export interface BackfillTrip {
  id: string
  tripDate: string
  createdAt: string
  source: 'manual' | 'oj_projects'
  driverId: string | null
  destinationNames: string[]
  totalMilesTenths: number
  amountPence: number
}

export interface DriverBackfillInput {
  trips: BackfillTrip[]
  ojDriverId: string
  otherDriverId: string
  roadshowDestinations: string[]
  knownDestinationNames: string[]
  /** The moment the Release 3 app went live, as an ISO timestamp. Exclusive. */
  createdBefore: string
}

type BackfillRule = 'oj_projects' | 'roadshow' | 'everything_else'

interface BackfillAssignment {
  tripId: string
  driverId: string
  basis: 'owner_statement' | 'oj_projects'
  rule: BackfillRule
}

export interface DriverBackfillPlan {
  assignments: BackfillAssignment[]
  summary: Array<{ driverId: string; trips: number; milesTenths: number; amountPence: number }>
  roadshowTrips: BackfillTrip[]
  createdAfterCutoff: BackfillTrip[]
  unknownRoadshowDestinations: string[]
  /** Trips that already have a driver and are left alone. */
  alreadyAssigned: number
}

const normalise = (name: string): string => name.trim().toLowerCase()

export function planDriverBackfill(input: DriverBackfillInput): DriverBackfillPlan {
  const known = new Set(input.knownDestinationNames.map(normalise))
  const roadshow = new Set(input.roadshowDestinations.map(normalise))
  const cutoffMs = Date.parse(input.createdBefore)
  if (Number.isNaN(cutoffMs)) {
    throw new Error(`--created-before is not a timestamp: ${input.createdBefore}`)
  }

  const assignments: BackfillAssignment[] = []
  const roadshowTrips: BackfillTrip[] = []
  const createdAfterCutoff: BackfillTrip[] = []
  const summary = new Map<string, { driverId: string; trips: number; milesTenths: number; amountPence: number }>()
  let alreadyAssigned = 0

  for (const trip of input.trips) {
    if (trip.driverId !== null) {
      alreadyAssigned += 1
      continue
    }
    // Date.parse keeps milliseconds only, so a trip a microsecond after the cutoff compares
    // equal and is still held back: the cutoff is exclusive.
    if (Date.parse(trip.createdAt) >= cutoffMs) {
      createdAfterCutoff.push(trip)
      continue
    }

    let assignment: BackfillAssignment
    if (trip.source === 'oj_projects') {
      assignment = { tripId: trip.id, driverId: input.ojDriverId, basis: 'oj_projects', rule: 'oj_projects' }
    } else if (trip.destinationNames.some((name) => roadshow.has(normalise(name)))) {
      assignment = { tripId: trip.id, driverId: input.ojDriverId, basis: 'owner_statement', rule: 'roadshow' }
      roadshowTrips.push(trip)
    } else {
      assignment = { tripId: trip.id, driverId: input.otherDriverId, basis: 'owner_statement', rule: 'everything_else' }
    }
    assignments.push(assignment)

    const totals = summary.get(assignment.driverId) ?? { driverId: assignment.driverId, trips: 0, milesTenths: 0, amountPence: 0 }
    totals.trips += 1
    totals.milesTenths += trip.totalMilesTenths
    totals.amountPence += trip.amountPence
    summary.set(assignment.driverId, totals)
  }

  return {
    assignments,
    summary: [...summary.values()],
    roadshowTrips,
    createdAfterCutoff,
    unknownRoadshowDestinations: input.roadshowDestinations.filter((name) => !known.has(normalise(name))),
    alreadyAssigned,
  }
}

export interface DriverBackfillArgs {
  ojDriver: string
  otherDriver: string
  roadshowDestinations: string[]
  createdBefore: string
  confirm: boolean
}

// An explicit zone is required: without one, Date.parse reads the time in the machine's zone.
const TIMESTAMP_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/

/** Reads the script's arguments. A dry run unless --confirm is passed. */
export function readDriverBackfillArgs(argv: string[], nowMs: number = Date.now()): DriverBackfillArgs {
  const value = (flag: string): string => {
    const index = argv.indexOf(flag)
    const found = index === -1 ? undefined : argv[index + 1]
    if (!found || found.startsWith('--') || !found.trim()) throw new Error(`Pass ${flag}`)
    return found
  }

  const ojDriver = value('--oj-driver')
  const otherDriver = value('--other-driver')
  const createdBefore = value('--created-before')

  const roadshowDestinations: string[] = []
  argv.forEach((arg, index) => {
    if (arg !== '--roadshow-destination') return
    const name = argv[index + 1]
    if (!name || name.startsWith('--') || !name.trim()) {
      throw new Error('Pass a destination name after each --roadshow-destination')
    }
    roadshowDestinations.push(name)
  })
  // The owner's rule names the roadshows; running without them would give every roadshow to the other driver.
  if (roadshowDestinations.length === 0) {
    throw new Error('Pass at least one --roadshow-destination')
  }

  if (normalise(ojDriver) === normalise(otherDriver)) {
    throw new Error('--oj-driver and --other-driver must be different people')
  }
  if (!TIMESTAMP_WITH_ZONE.test(createdBefore) || Number.isNaN(Date.parse(createdBefore))) {
    throw new Error('--created-before must be a timestamp with a time zone, for example 2026-10-01T09:00:00Z')
  }
  if (Date.parse(createdBefore) > nowMs) {
    throw new Error('--created-before is in the future; use the time the Release 3 deployment went live')
  }

  return { ojDriver, otherDriver, roadshowDestinations, createdBefore, confirm: argv.includes('--confirm') }
}

/** Writes need RUN_MILEAGE_DRIVER_BACKFILL_MUTATION=true as well as --confirm. */
export function assertDriverBackfillMutationAllowed(): void {
  assertScriptMutationAllowed({ scriptName: DRIVER_BACKFILL_SCRIPT_NAME, envVar: DRIVER_BACKFILL_MUTATION_ENV })
}

// Row shapes for the paged reads. Numeric columns can arrive as strings, so they go through Number().
interface DriverRow {
  id: string
  display_name: string
  is_active: boolean
  drives_oj_projects: boolean
}

interface DestinationRow {
  id: string
  name: string
}

interface TripRow {
  id: string
  trip_date: string
  created_at: string
  source: string
  driver_id: string | null
  total_miles: number | string
  amount_due: number | string
}

interface LegRow {
  id: string
  trip_id: string
  from_destination_id: string
  to_destination_id: string
}

const RULE_ORDER: BackfillRule[] = ['oj_projects', 'roadshow', 'everything_else']

/**
 * Loads every trip, prints the plan, and applies it when confirmed. Returns how many trips were
 * planned and how many were written. Throws before any write if the plan cannot be trusted.
 */
export async function runDriverBackfill(
  db: SupabaseClient,
  args: DriverBackfillArgs,
  /** Where the plan is printed; the script passes console.log. */
  log: (line: string) => void
): Promise<{ planned: number; assigned: number; dryRun: boolean }> {
  // Every read pages and orders on id: an unpaged select stops silently at 1,000 rows.
  const drivers = await fetchAllRows<DriverRow>(
    (from, to) => db.from('mileage_drivers').select('id, display_name, is_active, drives_oj_projects').order('id').range(from, to),
    { label: 'mileage drivers' }
  )
  const findDriver = (name: string): DriverRow => {
    const match = drivers.find((driver) => driver.is_active && normalise(driver.display_name) === normalise(name))
    if (!match) throw new Error(`No active driver called "${name}"`)
    return match
  }
  const ojDriver = findDriver(args.ojDriver)
  const otherDriver = findDriver(args.otherDriver)
  if (!ojDriver.drives_oj_projects) throw new Error(`"${args.ojDriver}" is not the OJ Projects driver`)

  const destinations = await fetchAllRows<DestinationRow>(
    (from, to) => db.from('mileage_destinations').select('id, name').order('id').range(from, to),
    { label: 'mileage destinations' }
  )
  const destinationName = new Map(destinations.map((row) => [row.id, row.name]))

  const trips = await fetchAllRows<TripRow>(
    (from, to) =>
      db
        .from('mileage_trips')
        .select('id, trip_date, created_at, source, driver_id, total_miles, amount_due')
        .order('id')
        .range(from, to),
    { label: 'mileage trips' }
  )
  // A trip added or removed mid-read shifts the pages; refuse rather than plan from a torn read.
  if (new Set(trips.map((row) => row.id)).size !== trips.length) {
    throw new Error('Trips changed while they were being read. Run the dry run again.')
  }

  const legs = await fetchAllRows<LegRow>(
    (from, to) =>
      db.from('mileage_trip_legs').select('id, trip_id, from_destination_id, to_destination_id').order('id').range(from, to),
    { label: 'mileage trip legs' }
  )
  const namesByTrip = new Map<string, Set<string>>()
  for (const leg of legs) {
    const names = namesByTrip.get(leg.trip_id) ?? new Set<string>()
    for (const destinationId of [leg.from_destination_id, leg.to_destination_id]) {
      const name = destinationName.get(destinationId)
      if (name) names.add(name)
    }
    namesByTrip.set(leg.trip_id, names)
  }

  const plan = planDriverBackfill({
    trips: trips.map((row) => ({
      id: row.id,
      tripDate: row.trip_date,
      createdAt: row.created_at,
      source: row.source === 'oj_projects' ? 'oj_projects' : 'manual',
      driverId: row.driver_id ?? null,
      destinationNames: [...(namesByTrip.get(row.id) ?? [])],
      totalMilesTenths: Math.round(Number(row.total_miles) * 10),
      amountPence: Math.round(Number(row.amount_due) * 100),
    })),
    ojDriverId: ojDriver.id,
    otherDriverId: otherDriver.id,
    roadshowDestinations: args.roadshowDestinations,
    knownDestinationNames: destinations.map((row) => row.name),
    createdBefore: args.createdBefore,
  })

  const nameOf = (id: string): string => (id === ojDriver.id ? ojDriver.display_name : otherDriver.display_name)
  const countRule = (rule: BackfillRule): number => plan.assignments.filter((row) => row.rule === rule).length
  log(`${DRIVER_BACKFILL_SCRIPT_NAME}: ${trips.length} trip(s) read, ${plan.assignments.length} to assign`)
  log(`  Already have a driver (left alone): ${plan.alreadyAssigned}`)
  log(
    `  By rule: OJ Projects ${countRule('oj_projects')}, roadshow ${countRule('roadshow')}, everything else ${countRule('everything_else')}`
  )
  for (const row of plan.summary) {
    log(`  ${nameOf(row.driverId)}: ${row.trips} trips, ${(row.milesTenths / 10).toFixed(1)} miles, GBP ${(row.amountPence / 100).toFixed(2)}`)
  }
  log('  Roadshow trips:')
  for (const row of plan.roadshowTrips) {
    log(`    ${row.tripDate}  ${(row.totalMilesTenths / 10).toFixed(1)} mi  ${row.destinationNames.join(' / ')}`)
  }

  if (plan.unknownRoadshowDestinations.length > 0) {
    throw new Error(`Unknown roadshow destinations: ${plan.unknownRoadshowDestinations.join(', ')}`)
  }
  if (plan.createdAfterCutoff.length > 0) {
    throw new Error(
      `${plan.createdAfterCutoff.length} trip(s) created after the cutoff have no driver; they must be fixed in the form, not by this rule: ${plan.createdAfterCutoff.map((row) => row.id).join(', ')}`
    )
  }
  if (plan.assignments.length === 0) {
    log('Nothing to change.')
    return { planned: 0, assigned: 0, dryRun: !args.confirm }
  }
  if (!args.confirm) {
    log('Dry run only. Nothing was written.')
    return { planned: plan.assignments.length, assigned: 0, dryRun: true }
  }
  assertDriverBackfillMutationAllowed()

  let assigned = 0
  for (const rule of RULE_ORDER) {
    const ruleAssignments = plan.assignments.filter((row) => row.rule === rule)
    if (ruleAssignments.length === 0) continue
    const { driverId, basis } = ruleAssignments[0]

    for (let index = 0; index < ruleAssignments.length; index += BATCH_SIZE) {
      const ids = ruleAssignments.slice(index, index + BATCH_SIZE).map((row) => row.tripId)
      const operation = `Assign ${rule} trips (batch ${index / BATCH_SIZE + 1})`
      // Only trips still without a driver change, so a driver chosen in the form since the dry run is never overwritten.
      const result = await db
        .from('mileage_trips')
        .update({ driver_id: driverId, driver_basis: basis })
        .in('id', ids)
        .is('driver_id', null)
        .select('id')
      const { updatedCount } = assertScriptMutationSucceeded({
        operation,
        error: result.error,
        updatedRows: result.data,
        allowZeroRows: true,
      })
      assertScriptExpectedRowCount({ operation, expected: ids.length, actual: updatedCount })
      assigned += updatedCount

      const audit = await db.from('audit_logs').insert({
        operation_type: 'update',
        resource_type: 'mileage_trip',
        operation_status: 'success',
        additional_info: { change: AUDIT_CHANGE, rule, basis, driver_id: driverId, trip_ids: ids },
      })
      if (audit.error) {
        throw new Error(`${operation} was saved but its audit row failed: ${audit.error.message}. Record it by hand before re-running.`)
      }
    }
  }

  log(`${DRIVER_BACKFILL_SCRIPT_NAME}: assigned ${assigned} trip(s)`)
  return { planned: plan.assignments.length, assigned, dryRun: false }
}
