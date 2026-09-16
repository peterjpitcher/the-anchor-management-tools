import { beforeEach, describe, expect, it, vi } from 'vitest'

type MileageTripRow = {
  trip_date: string
  total_miles: number
  amount_due: number
}

const mileageRows: MileageTripRow[] = [
  { trip_date: '2026-04-29', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-04-14', total_miles: 40.2, amount_due: 18.09 },
  { trip_date: '2026-04-09', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-04-04', total_miles: 3.4, amount_due: 1.53 },
  { trip_date: '2026-03-12', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-03-06', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-26', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-19', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-13', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-12', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-02-11', total_miles: 110, amount_due: 49.5 },
  { trip_date: '2026-02-06', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-01-28', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-01-20', total_miles: 28, amount_due: 12.6 },
  { trip_date: '2026-01-15', total_miles: 28, amount_due: 12.6 },
  { trip_date: '2026-01-05', total_miles: 28, amount_due: 12.6 },
]

const queryRanges: Array<{ gte?: string; lte?: string }> = []
const mockRpc = vi.fn()

function createMileageTripsQuery(): Record<string, unknown> {
  const range: { gte?: string; lte?: string } = {}
  const chain: Record<string, unknown> = {}

  chain.select = vi.fn(() => chain)
  chain.gte = vi.fn((_column: string, value: string) => {
    range.gte = value
    return chain
  })
  chain.lte = vi.fn((_column: string, value: string) => {
    range.lte = value
    queryRanges.push(range)
    return chain
  })
  chain.then = (
    resolve: (value: { data: MileageTripRow[]; error: null }) => void,
    reject?: (reason: unknown) => void
  ) => {
    const data = mileageRows.filter(
      (row) => (!range.gte || row.trip_date >= range.gte) && (!range.lte || row.trip_date <= range.lte)
    )
    return Promise.resolve({ data, error: null }).then(resolve, reject)
  }

  return chain
}

const mockFrom = vi.fn(() => createMileageTripsQuery())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    user_id: 'test-user-id',
    user_email: 'test@example.com',
  }),
}))

vi.mock('@/lib/dateUtils', () => ({
  getTodayIsoDate: vi.fn(() => '2026-05-05'),
  formatDateInLondon: vi.fn((value: string) => value),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  createTrip,
  deleteTrip,
  getDestinations,
  getDistanceEntries,
  getMileageInsights,
  getTrips,
  getTripStats,
  updateTrip,
} from '../mileage'

const HOME_ID = '00000000-0000-4000-8000-000000000001'
const DEST_ID = '00000000-0000-4000-8000-000000000002'

function createSingleBuilder(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error })
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  return { select, eq, single }
}

describe('getTripStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation(() => createMileageTripsQuery())
    mockRpc.mockReset()
    queryRanges.length = 0
  })

  it('uses calendar-year totals for the annual stat while preserving tax-year threshold totals', async () => {
    const result = await getTripStats()

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      quarterTotalMiles: 98.8,
      quarterAmountDue: 44.46,
      calendarYear: 2026,
      calendarYearTotalMiles: 513.6,
      calendarYearAmountDue: 231.12,
      taxYearTotalMiles: 95.4,
      taxYearAmountDue: 42.93,
      milesToThreshold: 9904.6,
    })
    expect(queryRanges).toEqual([
      { gte: '2026-04-06', lte: '2027-04-05' },
      { gte: '2026-01-01', lte: '2026-12-31' },
    ])
  })
})

describe('getTrips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('uses counted pagination and hydrates legs for the current page', async () => {
    const tripRows = [
      {
        id: 'trip-1',
        trip_date: '2026-07-24',
        description: 'Supplier run',
        total_miles: 20,
        miles_at_standard_rate: 20,
        miles_at_reduced_rate: 0,
        amount_due: 11,
        source: 'manual',
        created_at: '2026-07-24T12:00:00Z',
      },
      {
        id: 'trip-2',
        trip_date: '2026-07-23',
        description: null,
        total_miles: 10,
        miles_at_standard_rate: 10,
        miles_at_reduced_rate: 0,
        amount_due: 5.5,
        source: 'manual',
        created_at: '2026-07-23T12:00:00Z',
      },
    ]
    const tripRange = vi.fn().mockResolvedValue({ data: tripRows, error: null, count: 52 })
    const tripOrder = vi.fn(() => tripBuilder)
    const tripSelect = vi.fn(() => tripBuilder)
    const tripBuilder = {
      select: tripSelect,
      order: tripOrder,
      range: tripRange,
    }

    const legsOrder = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'leg-1',
          trip_id: 'trip-1',
          leg_order: 1,
          from_destination_id: HOME_ID,
          to_destination_id: DEST_ID,
          miles: 10,
        },
        {
          id: 'leg-2',
          trip_id: 'trip-1',
          leg_order: 2,
          from_destination_id: DEST_ID,
          to_destination_id: HOME_ID,
          miles: 10,
        },
      ],
      error: null,
    })
    const legsIn = vi.fn(() => ({ order: legsOrder }))
    const legsSelect = vi.fn(() => ({ in: legsIn }))

    const destinationsIn = vi.fn().mockResolvedValue({
      data: [
        { id: HOME_ID, name: 'The Anchor' },
        { id: DEST_ID, name: 'Costco' },
      ],
      error: null,
    })
    const destinationsSelect = vi.fn(() => ({ in: destinationsIn }))

    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') return tripBuilder
      if (table === 'mileage_trip_legs') return { select: legsSelect }
      if (table === 'mileage_destinations') return { select: destinationsSelect }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await getTrips({ page: 2, pageSize: 25 })

    expect(result.success).toBe(true)
    expect(tripSelect).toHaveBeenCalledWith('*', { count: 'exact' })
    expect(tripRange).toHaveBeenCalledWith(25, 49)
    expect(result.pageInfo).toMatchObject({ total: 52, page: 2, pageSize: 25 })
    expect(result.data?.[0]?.routeSummary).toBe('The Anchor → Costco → The Anchor')
  })
})

describe('manual mileage trip mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation(() => createMileageTripsQuery())
    mockRpc.mockReset()
  })

  it('creates manual trips through the atomic mileage RPC', async () => {
    const upsertDistance = vi.fn().mockResolvedValue({ error: null })
    mockRpc.mockResolvedValue({ data: 'trip-1', error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_destinations') {
        return createSingleBuilder({ id: HOME_ID })
      }
      if (table === 'mileage_destination_distances') {
        return { upsert: upsertDistance }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await createTrip({
      tripDate: '2026-07-24',
      description: 'Supplier run',
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 10 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 10 },
      ],
    })

    expect(result).toEqual({ success: true, data: { id: 'trip-1' } })
    expect(mockRpc).toHaveBeenCalledWith('create_manual_mileage_trip_v01', {
      p_trip_date: '2026-07-24',
      p_description: 'Supplier run',
      p_total_miles: 20,
      p_created_by: 'test-user-id',
      p_legs: [
        { from_destination_id: HOME_ID, to_destination_id: DEST_ID, miles: 10 },
        { from_destination_id: DEST_ID, to_destination_id: HOME_ID, miles: 10 },
      ],
    })
    expect(mockFrom).not.toHaveBeenCalledWith('mileage_trip_legs')
  })

  it('updates manual trips through the atomic mileage RPC without deleting legs in the app', async () => {
    const upsertDistance = vi.fn().mockResolvedValue({ error: null })
    mockRpc.mockResolvedValue({ data: { id: 'trip-1' }, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') {
        return createSingleBuilder({
          id: 'trip-1',
          source: 'manual',
          trip_date: '2026-07-20',
          total_miles: 12,
        })
      }
      if (table === 'mileage_destinations') {
        return createSingleBuilder({ id: HOME_ID })
      }
      if (table === 'mileage_destination_distances') {
        return { upsert: upsertDistance }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await updateTrip({
      id: 'trip-1',
      tripDate: '2026-07-24',
      description: 'Updated run',
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 8 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 8 },
      ],
    })

    expect(result).toEqual({ success: true })
    expect(mockRpc).toHaveBeenCalledWith('update_manual_mileage_trip_v01', {
      p_trip_id: 'trip-1',
      p_trip_date: '2026-07-24',
      p_description: 'Updated run',
      p_total_miles: 16,
      p_legs: [
        { from_destination_id: HOME_ID, to_destination_id: DEST_ID, miles: 8 },
        { from_destination_id: DEST_ID, to_destination_id: HOME_ID, miles: 8 },
      ],
    })
    expect(mockFrom).not.toHaveBeenCalledWith('mileage_trip_legs')
  })
})

describe('deleteTrip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('deletes a logged trip and leaves recalculation to the database trigger', async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'mileage_trips') throw new Error(`Unexpected table: ${table}`)
      return {
        ...createSingleBuilder({ id: 'trip-1', source: 'manual', trip_date: '2026-04-04', total_miles: 3.4 }),
        delete: vi.fn(() => ({ eq: deleteEq })),
      }
    })

    const result = await deleteTrip('trip-1')

    expect(result).toEqual({ success: true })
    expect(deleteEq).toHaveBeenCalledWith('id', 'trip-1')
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

/**
 * A table that behaves like PostgREST: every request returns at most 1,000 rows, so
 * a read only sees every row if it pages with `.range()`. Awaiting the builder
 * without a range fails, rather than quietly handing back the first page.
 */
function pagedTable<T>(rows: T[]) {
  const range = vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + 1000)),
    error: null,
  }))
  const order = vi.fn(() => builder)
  const builder = { order, range }
  const select = vi.fn(() => builder)
  return { select, order, range }
}

const TESCO_ID = '00000000-0000-4000-8000-000000000003'

describe('getDestinations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('counts distinct trips from every leg, not the first 1,000', async () => {
    // 650 round trips = 1,300 legs, more than one Supabase page.
    const legs = Array.from({ length: 650 }).flatMap((_, index) => [
      { id: `leg-${index}-a`, trip_id: `trip-${index}`, from_destination_id: HOME_ID, to_destination_id: TESCO_ID },
      { id: `leg-${index}-b`, trip_id: `trip-${index}`, from_destination_id: TESCO_ID, to_destination_id: HOME_ID },
    ])
    const legsTable = pagedTable(legs)
    const destinationsTable = pagedTable([
      { id: HOME_ID, name: 'The Anchor', postcode: 'TW19 6AQ', is_home_base: true },
      { id: TESCO_ID, name: 'Tesco Ashford', postcode: null, is_home_base: false },
    ])
    const distancesTable = pagedTable([
      { id: 'distance-1', from_destination_id: HOME_ID, to_destination_id: TESCO_ID, miles: 1.7 },
    ])
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trip_legs') return legsTable
      if (table === 'mileage_destinations') return destinationsTable
      if (table === 'mileage_destination_distances') return distancesTable
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await getDestinations()

    expect(result.error).toBeUndefined()
    expect(legsTable.range).toHaveBeenCalledTimes(2)
    expect(legsTable.range).toHaveBeenNthCalledWith(2, 1000, 1999)
    // Pages only line up when the order is unique, so every paged read ends on the id.
    expect(legsTable.order).toHaveBeenLastCalledWith('id')
    expect(destinationsTable.order).toHaveBeenLastCalledWith('id')
    expect(distancesTable.order).toHaveBeenLastCalledWith('id')
    expect(result.data).toEqual([
      { id: HOME_ID, name: 'The Anchor', postcode: 'TW19 6AQ', isHomeBase: true, tripCount: 650, milesFromAnchor: 0 },
      { id: TESCO_ID, name: 'Tesco Ashford', postcode: null, isHomeBase: false, tripCount: 650, milesFromAnchor: 1.7 },
    ])
  })

  it('returns an error instead of partial counts when a page fails', async () => {
    const failing = {
      select: vi.fn(() => {
        const builder = {
          order: vi.fn(() => builder),
          range: vi.fn(async () => ({ data: null, error: { message: 'timeout' } })),
        }
        return builder
      }),
    }
    mockFrom.mockImplementation(() => failing)

    const result = await getDestinations()

    expect(result.data).toBeUndefined()
    expect(result.error).toContain('timeout')
  })
})

describe('getDistanceEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('reads every saved distance, most recently used first', async () => {
    const distances = Array.from({ length: 1001 }, (_, index) => ({
      id: `distance-${index}`,
      from_destination_id: HOME_ID,
      to_destination_id: TESCO_ID,
      miles: 1.7,
      last_used_at: '2026-09-01T10:00:00Z',
    }))
    const distancesTable = pagedTable(distances)
    const destinationsIn = vi.fn().mockResolvedValue({
      data: [
        { id: HOME_ID, name: 'The Anchor' },
        { id: TESCO_ID, name: 'Tesco Ashford' },
      ],
      error: null,
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_destination_distances') return distancesTable
      if (table === 'mileage_destinations') return { select: vi.fn(() => ({ in: destinationsIn })) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await getDistanceEntries()

    expect(result.error).toBeUndefined()
    expect(result.data).toHaveLength(1001)
    expect(distancesTable.range).toHaveBeenCalledTimes(2)
    expect(distancesTable.order).toHaveBeenNthCalledWith(1, 'last_used_at', { ascending: false })
    expect(distancesTable.order).toHaveBeenNthCalledWith(2, 'id')
    expect(result.data?.[1000]).toMatchObject({ fromDestinationName: 'The Anchor', toDestinationName: 'Tesco Ashford' })
  })
})

describe('getMileageInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('builds the totals and destination breakdown from every trip and leg', async () => {
    // 1,001 round trips (2,002 legs), so both reads need more than one page.
    const trips = Array.from({ length: 1001 }, (_, index) => ({
      id: `trip-${index}`,
      trip_date: '2026-05-01',
      total_miles: 3.4,
      amount_due: 1.8,
    }))
    const legs = trips.flatMap((trip) => [
      {
        id: `${trip.id}-a`,
        trip_id: trip.id,
        miles: 1.7,
        to_destination_id: TESCO_ID,
        mileage_destinations: { name: 'Tesco Ashford', is_home_base: false },
      },
      {
        id: `${trip.id}-b`,
        trip_id: trip.id,
        miles: 1.7,
        to_destination_id: HOME_ID,
        mileage_destinations: { name: 'The Anchor', is_home_base: true },
      },
    ])
    const tripsTable = pagedTable(trips)
    const legsTable = pagedTable(legs)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') return tripsTable
      if (table === 'mileage_trip_legs') return legsTable
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await getMileageInsights('monthly')

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(tripsTable.range).toHaveBeenCalledTimes(2)
    expect(legsTable.range).toHaveBeenCalledTimes(3)
    expect(tripsTable.order).toHaveBeenNthCalledWith(1, 'trip_date', { ascending: true })
    expect(tripsTable.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true })
    expect(legsTable.order).toHaveBeenLastCalledWith('id', { ascending: true })
    // Tesco's share of each trip is 1.7 of 3.4 miles, so half of £1.80.
    expect(result.data?.byDestination).toEqual([
      { destinationName: 'Tesco Ashford', totalMiles: 1701.7, amountDue: 900.9, tripCount: 1001 },
    ])
    expect(result.data?.totals.tripCount).toBe(1001)
    expect(result.data?.bars).toHaveLength(1)
  })

  it('returns an error instead of a partial breakdown when a page fails', async () => {
    const trips = Array.from({ length: 3 }, (_, index) => ({
      id: `trip-${index}`,
      trip_date: '2026-05-01',
      total_miles: 3.4,
      amount_due: 1.8,
    }))
    const tripsTable = pagedTable(trips)
    const failingLegs = {
      select: vi.fn(() => {
        const builder = {
          order: vi.fn(() => builder),
          range: vi.fn(async () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } })),
        }
        return builder
      }),
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') return tripsTable
      if (table === 'mileage_trip_legs') return failingLegs
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await getMileageInsights('monthly')

    expect(result.success).toBe(false)
    expect(result.data).toBeUndefined()
    expect(result.error).toContain('statement timeout')
  })
})
