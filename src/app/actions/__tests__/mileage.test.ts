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
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createTrip, getTripStats, updateTrip } from '../mileage'

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
