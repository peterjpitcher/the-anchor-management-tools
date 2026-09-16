import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DRIVER_BACKFILL_MUTATION_ENV,
  assertDriverBackfillMutationAllowed,
  planDriverBackfill,
  readDriverBackfillArgs,
  runDriverBackfill,
  type BackfillTrip,
  type DriverBackfillArgs,
} from '@/lib/mileage/driver-backfill'

const OJ_DRIVER = 'driver-oj'
const OTHER_DRIVER = 'driver-other'
const CUTOFF = '2026-10-01T09:00:00+00:00'

function trip(overrides: Partial<BackfillTrip>): BackfillTrip {
  return {
    id: 'trip',
    tripDate: '2025-09-17',
    createdAt: '2026-09-15T15:08:08.431218+00:00',
    source: 'manual',
    driverId: null,
    destinationNames: ['The Anchor', 'Shop One'],
    totalMilesTenths: 34,
    amountPence: 153,
    ...overrides,
  }
}

const input = {
  ojDriverId: OJ_DRIVER,
  otherDriverId: OTHER_DRIVER,
  roadshowDestinations: ['Leeds Royal Armouries'],
  knownDestinationNames: ['The Anchor', 'Shop One', 'Leeds Royal Armouries'],
  createdBefore: CUTOFF,
}

describe('planDriverBackfill', () => {
  it('applies the owner rule: OJ Projects and roadshows to the OJ driver, everything else to the other driver', () => {
    const plan = planDriverBackfill({
      ...input,
      trips: [
        trip({ id: 'oj', source: 'oj_projects', destinationNames: [], totalMilesTenths: 400, amountPence: 1800 }),
        trip({ id: 'roadshow', destinationNames: ['The Anchor', 'leeds royal armouries'], totalMilesTenths: 1940, amountPence: 8730 }),
        trip({ id: 'shop' }),
      ],
    })

    expect(plan.assignments).toEqual([
      { tripId: 'oj', driverId: OJ_DRIVER, basis: 'oj_projects', rule: 'oj_projects' },
      { tripId: 'roadshow', driverId: OJ_DRIVER, basis: 'owner_statement', rule: 'roadshow' },
      { tripId: 'shop', driverId: OTHER_DRIVER, basis: 'owner_statement', rule: 'everything_else' },
    ])
    expect(plan.roadshowTrips.map((row) => row.id)).toEqual(['roadshow'])
    expect(plan.summary).toEqual([
      { driverId: OJ_DRIVER, trips: 2, milesTenths: 2340, amountPence: 10530 },
      { driverId: OTHER_DRIVER, trips: 1, milesTenths: 34, amountPence: 153 },
    ])
  })

  it('leaves trips that already have a driver alone', () => {
    const plan = planDriverBackfill({ ...input, trips: [trip({ id: 'done', driverId: OTHER_DRIVER })] })
    expect(plan.assignments).toEqual([])
    expect(plan.alreadyAssigned).toBe(1)
  })

  it('holds back trips created after the new form went live', () => {
    const plan = planDriverBackfill({ ...input, trips: [trip({ id: 'late', createdAt: '2026-10-01T09:00:00.000001+00:00' })] })
    expect(plan.assignments).toEqual([])
    expect(plan.createdAfterCutoff.map((row) => row.id)).toEqual(['late'])
  })

  it('assigns a trip created just before the cutoff', () => {
    const plan = planDriverBackfill({ ...input, trips: [trip({ id: 'early', createdAt: '2026-10-01T08:59:59.998765+00:00' })] })
    expect(plan.assignments.map((row) => row.tripId)).toEqual(['early'])
  })

  it('reports roadshow destinations that do not exist', () => {
    const plan = planDriverBackfill({ ...input, roadshowDestinations: ['Leeds Royal Armouries', 'Leeds Armouries'], trips: [] })
    expect(plan.unknownRoadshowDestinations).toEqual(['Leeds Armouries'])
  })
})

describe('readDriverBackfillArgs', () => {
  const NOW = Date.parse('2026-10-02T12:00:00Z')
  const base = [
    '--oj-driver', 'Driver A',
    '--other-driver', 'Driver B',
    '--roadshow-destination', 'Leeds Royal Armouries',
    '--roadshow-destination', 'SEC Glasgow',
    '--created-before', '2026-10-01T09:00:00Z',
  ]

  it('reads the drivers, every roadshow destination and the cutoff, as a dry run by default', () => {
    expect(readDriverBackfillArgs(base, NOW)).toEqual({
      ojDriver: 'Driver A',
      otherDriver: 'Driver B',
      roadshowDestinations: ['Leeds Royal Armouries', 'SEC Glasgow'],
      createdBefore: '2026-10-01T09:00:00Z',
      confirm: false,
    })
    expect(readDriverBackfillArgs([...base, '--confirm'], NOW).confirm).toBe(true)
  })

  it('refuses missing values', () => {
    expect(() => readDriverBackfillArgs([], NOW)).toThrow('Pass --oj-driver')
    expect(() => readDriverBackfillArgs(['--oj-driver', '--other-driver', 'Driver B'], NOW)).toThrow('Pass --oj-driver')
    expect(() =>
      readDriverBackfillArgs(['--oj-driver', 'Driver A', '--other-driver', 'Driver B', '--created-before', '2026-10-01T09:00:00Z'], NOW)
    ).toThrow('Pass at least one --roadshow-destination')
  })

  it('refuses the same name for both drivers', () => {
    const args = [...base]
    args[3] = ' driver a '
    expect(() => readDriverBackfillArgs(args, NOW)).toThrow('--oj-driver and --other-driver must be different people')
  })

  it('refuses a cutoff with no time zone, or one in the future', () => {
    const noZone = [...base]
    noZone[noZone.length - 1] = '2026-10-01T09:00:00'
    expect(() => readDriverBackfillArgs(noZone, NOW)).toThrow('--created-before must be a timestamp with a time zone')

    const future = [...base]
    future[future.length - 1] = '2026-10-03T09:00:00Z'
    expect(() => readDriverBackfillArgs(future, NOW)).toThrow('--created-before is in the future')
  })
})

describe('assertDriverBackfillMutationAllowed', () => {
  const previous = process.env[DRIVER_BACKFILL_MUTATION_ENV]

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[DRIVER_BACKFILL_MUTATION_ENV]
    } else {
      process.env[DRIVER_BACKFILL_MUTATION_ENV] = previous
    }
  })

  it('blocks writes unless RUN_MILEAGE_DRIVER_BACKFILL_MUTATION is true', () => {
    expect(DRIVER_BACKFILL_MUTATION_ENV).toBe('RUN_MILEAGE_DRIVER_BACKFILL_MUTATION')
    delete process.env[DRIVER_BACKFILL_MUTATION_ENV]
    expect(() => assertDriverBackfillMutationAllowed()).toThrow(
      'mileage-driver-backfill blocked by safety guard. Set RUN_MILEAGE_DRIVER_BACKFILL_MUTATION=true to run this mutation script.'
    )
    process.env[DRIVER_BACKFILL_MUTATION_ENV] = 'true'
    expect(() => assertDriverBackfillMutationAllowed()).not.toThrow()
  })
})

type Row = Record<string, unknown>

/**
 * A fake Supabase client. Reads behave like PostgREST (at most 1,000 rows a request, so
 * they must page), and every write is recorded so a test can prove none happened.
 */
function fakeDb(tables: Record<string, Row[]>, options: { updatedCount?: (ids: string[]) => number } = {}) {
  const reads: Array<{ table: string; columns: string; orders: string[]; ranges: Array<[number, number]> }> = []
  const updates: Array<{ values: Row; ids: string[]; nullGuard: [string, unknown] | null }> = []
  const inserts: Array<{ table: string; row: Row }> = []

  const from = vi.fn((table: string) => ({
    select: (columns: string) => {
      const read = { table, columns, orders: [] as string[], ranges: [] as Array<[number, number]> }
      reads.push(read)
      const builder = {
        order: (column: string) => {
          read.orders.push(column)
          return builder
        },
        range: async (start: number, end: number) => {
          read.ranges.push([start, end])
          const rows = tables[table] ?? []
          return { data: rows.slice(start, Math.min(end + 1, start + 1000)), error: null }
        },
      }
      return builder
    },
    update: (values: Row) => {
      const update = { values, ids: [] as string[], nullGuard: null as [string, unknown] | null }
      updates.push(update)
      const builder = {
        in: (_column: string, ids: string[]) => {
          update.ids = ids
          return builder
        },
        is: (column: string, value: unknown) => {
          update.nullGuard = [column, value]
          return builder
        },
        select: async () => {
          const count = options.updatedCount ? options.updatedCount(update.ids) : update.ids.length
          return { data: update.ids.slice(0, count).map((id) => ({ id })), error: null }
        },
      }
      return builder
    },
    insert: async (row: Row) => {
      inserts.push({ table, row })
      return { error: null }
    },
  }))

  return { db: { from } as unknown as SupabaseClient, reads, updates, inserts }
}

const HOME = 'dest-home'
const SHOP = 'dest-shop'
const LEEDS = 'dest-leeds'

function productionLikeTables(): Record<string, Row[]> {
  // 1,200 shop runs, so the trip and leg reads both need more than one page.
  const shopTrips = Array.from({ length: 1200 }, (_, index) => ({
    id: `trip-shop-${String(index).padStart(4, '0')}`,
    trip_date: '2025-05-01',
    created_at: '2026-09-15T15:08:08.431218+00:00',
    source: 'manual',
    driver_id: null,
    total_miles: '3.4',
    amount_due: '1.53',
  }))
  const trips: Row[] = [
    ...shopTrips,
    { id: 'trip-leeds', trip_date: '2025-06-01', created_at: '2026-09-15T15:08:08+00:00', source: 'manual', driver_id: null, total_miles: 194, amount_due: 87.3 },
    { id: 'trip-oj', trip_date: '2025-07-01', created_at: '2026-04-05T10:00:00+00:00', source: 'oj_projects', driver_id: null, total_miles: 40, amount_due: 18 },
    { id: 'trip-done', trip_date: '2026-09-20', created_at: '2026-09-20T10:00:00+00:00', source: 'manual', driver_id: 'driver-b', total_miles: 10, amount_due: 4.5 },
  ]
  const legs: Row[] = [
    ...shopTrips.flatMap((row) => [
      { id: `${row.id}-a`, trip_id: row.id, from_destination_id: HOME, to_destination_id: SHOP },
      { id: `${row.id}-b`, trip_id: row.id, from_destination_id: SHOP, to_destination_id: HOME },
    ]),
    { id: 'leg-leeds', trip_id: 'trip-leeds', from_destination_id: HOME, to_destination_id: LEEDS },
  ]
  return {
    mileage_drivers: [
      { id: 'driver-a', display_name: 'Driver A', is_active: true, drives_oj_projects: true },
      { id: 'driver-b', display_name: 'Driver B', is_active: true, drives_oj_projects: false },
    ],
    mileage_destinations: [
      { id: HOME, name: 'The Anchor' },
      { id: SHOP, name: 'Shop One' },
      { id: LEEDS, name: 'Leeds Royal Armouries' },
    ],
    mileage_trips: trips,
    mileage_trip_legs: legs,
  }
}

const ARGS: DriverBackfillArgs = {
  ojDriver: 'Driver A',
  otherDriver: 'Driver B',
  roadshowDestinations: ['Leeds Royal Armouries'],
  createdBefore: '2026-10-01T09:00:00Z',
  confirm: false,
}

describe('runDriverBackfill', () => {
  const previous = process.env[DRIVER_BACKFILL_MUTATION_ENV]
  const log = vi.fn()

  beforeEach(() => {
    log.mockReset()
    delete process.env[DRIVER_BACKFILL_MUTATION_ENV]
  })

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[DRIVER_BACKFILL_MUTATION_ENV]
    } else {
      process.env[DRIVER_BACKFILL_MUTATION_ENV] = previous
    }
  })

  it('prints the plan from every trip and writes nothing on a dry run', async () => {
    const fake = fakeDb(productionLikeTables())

    await expect(runDriverBackfill(fake.db, ARGS, log)).resolves.toEqual({ assigned: 0, planned: 1202, dryRun: true })

    const rangesFor = (table: string) => fake.reads.filter((read) => read.table === table).flatMap((read) => read.ranges)
    expect(rangesFor('mileage_trips')).toEqual([[0, 999], [1000, 1999]])
    expect(rangesFor('mileage_trip_legs')).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    // Pages only line up when the order is unique, so every paged read ends on the id.
    for (const read of fake.reads) expect(read.orders.at(-1)).toBe('id')

    const output = log.mock.calls.map(([line]) => line).join('\n')
    expect(output).toContain('Driver A: 2 trips, 234.0 miles, GBP 105.30')
    expect(output).toContain('Driver B: 1200 trips, 4080.0 miles, GBP 1836.00')
    expect(output).toContain('2025-06-01  194.0 mi  The Anchor / Leeds Royal Armouries')
    expect(output).toContain('Dry run only. Nothing was written.')
    expect(fake.updates).toEqual([])
    expect(fake.inserts).toEqual([])
  })

  it('refuses to write without RUN_MILEAGE_DRIVER_BACKFILL_MUTATION, even with --confirm', async () => {
    const fake = fakeDb(productionLikeTables())

    await expect(runDriverBackfill(fake.db, { ...ARGS, confirm: true }, log)).rejects.toThrow('blocked by safety guard')
    expect(fake.updates).toEqual([])
    expect(fake.inserts).toEqual([])
  })

  it('assigns unassigned trips in batches, never overwriting a driver, with one audit row per batch', async () => {
    process.env[DRIVER_BACKFILL_MUTATION_ENV] = 'true'
    const fake = fakeDb(productionLikeTables())

    await expect(runDriverBackfill(fake.db, { ...ARGS, confirm: true }, log)).resolves.toEqual({
      assigned: 1202,
      planned: 1202,
      dryRun: false,
    })

    // One rule at a time: OJ Projects, then roadshows, then everything else.
    expect(fake.updates.map((update) => [update.values, update.ids.length])).toEqual([
      [{ driver_id: 'driver-a', driver_basis: 'oj_projects' }, 1],
      [{ driver_id: 'driver-a', driver_basis: 'owner_statement' }, 1],
      ...Array.from({ length: 12 }, () => [{ driver_id: 'driver-b', driver_basis: 'owner_statement' }, 100]),
    ])
    expect(fake.updates.every((update) => update.nullGuard?.[0] === 'driver_id' && update.nullGuard[1] === null)).toBe(true)
    expect(fake.updates.flatMap((update) => update.ids)).not.toContain('trip-done')

    expect(fake.inserts).toHaveLength(fake.updates.length)
    expect(fake.inserts[1]).toEqual({
      table: 'audit_logs',
      row: {
        operation_type: 'update',
        resource_type: 'mileage_trip',
        operation_status: 'success',
        additional_info: {
          change: 'mileage_driver_backfill_2026',
          rule: 'roadshow',
          basis: 'owner_statement',
          driver_id: 'driver-a',
          trip_ids: ['trip-leeds'],
        },
      },
    })
  })

  it('stops when a batch changes fewer trips than planned', async () => {
    process.env[DRIVER_BACKFILL_MUTATION_ENV] = 'true'
    // Someone chose a driver in the form between the dry run and the write.
    const fake = fakeDb(productionLikeTables(), { updatedCount: (ids) => ids.length - 1 })

    await expect(runDriverBackfill(fake.db, { ...ARGS, confirm: true }, log)).rejects.toThrow(
      'Assign oj_projects trips (batch 1) affected unexpected row count (expected 1, got 0)'
    )
    expect(fake.updates).toHaveLength(1)
    expect(fake.inserts).toEqual([])
  })

  it('refuses before writing when a roadshow destination does not exist', async () => {
    process.env[DRIVER_BACKFILL_MUTATION_ENV] = 'true'
    const fake = fakeDb(productionLikeTables())

    await expect(
      runDriverBackfill(fake.db, { ...ARGS, roadshowDestinations: ['Leeds Armouries'], confirm: true }, log)
    ).rejects.toThrow('Unknown roadshow destinations: Leeds Armouries')
    expect(fake.updates).toEqual([])
  })

  it('refuses before writing when a trip created after the cutoff has no driver', async () => {
    process.env[DRIVER_BACKFILL_MUTATION_ENV] = 'true'
    const tables = productionLikeTables()
    tables.mileage_trips.push({
      id: 'trip-late', trip_date: '2026-10-01', created_at: '2026-10-01T09:30:00+00:00', source: 'manual', driver_id: null, total_miles: 3.4, amount_due: 1.53,
    })
    const fake = fakeDb(tables)

    await expect(runDriverBackfill(fake.db, { ...ARGS, confirm: true }, log)).rejects.toThrow(
      '1 trip(s) created after the cutoff have no driver'
    )
    expect(fake.updates).toEqual([])
  })

  it('refuses when the named OJ driver is not the OJ Projects driver', async () => {
    const fake = fakeDb(productionLikeTables())

    await expect(
      runDriverBackfill(fake.db, { ...ARGS, ojDriver: 'Driver B', otherDriver: 'Driver A' }, log)
    ).rejects.toThrow('"Driver B" is not the OJ Projects driver')
    await expect(runDriverBackfill(fake.db, { ...ARGS, otherDriver: 'Driver C' }, log)).rejects.toThrow(
      'No active driver called "Driver C"'
    )
  })
})
