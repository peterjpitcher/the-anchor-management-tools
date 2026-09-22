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

const mockFrom = vi.fn((_table: string): Record<string, unknown> => createMileageTripsQuery())

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

// The real helpers stay available: the trip row parser checks dates with isValidIsoDate.
vi.mock('@/lib/dateUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dateUtils')>()),
  getTodayIsoDate: vi.fn(() => '2026-05-05'),
  formatDateInLondon: vi.fn((value: string) => value),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  createTrip,
  deleteTrip,
  exportMileageListCsv,
  getDestinations,
  getDistanceEntries,
  getMileageInsights,
  getRatePreviewContext,
  getTripDateRange,
  getTripForEdit,
  getTripStats,
  listMileageTrips,
  updateTrip,
} from '../mileage'
import { buildDatasetJson } from '../../../../tests/fixtures/mileage/reportDataset'

const HOME_ID = '00000000-0000-4000-8000-000000000001'
const DEST_ID = '00000000-0000-4000-8000-000000000002'
const DRIVER_ID = '00000000-0000-4000-8000-000000000010'
const REQUEST_ID = '00000000-0000-4000-8000-000000000011'

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
  })

  it('reads headline totals and miles left per driver from one database function', async () => {
    mockRpc.mockResolvedValue({
      data: {
        quarter: { from: '2026-04-01', to: '2026-06-30', trips: 4, miles_tenths: 988, amount_pence: 4446 },
        financial_year: { from: '2026-01-01', to: '2026-12-31', trips: 16, miles_tenths: 5136, amount_pence: 23112 },
        tax_year: { from: '2026-04-06', to: '2027-04-05', trips: 3, miles_tenths: 954, amount_pence: 4293 },
        drivers: [{ driver_id: 'd1', display_name: 'Driver A', tax_year_miles_tenths: 954, standard_miles_left_tenths: 99046 }],
      },
      error: null,
    })

    const result = await getTripStats()

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('mileage_headline_totals_v01', { p_today: '2026-05-05' })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      data: {
        quarter: { from: '2026-04-01', to: '2026-06-30', trips: 4, milesTenths: 988, amountPence: 4446 },
        financialYear: { from: '2026-01-01', to: '2026-12-31', trips: 16, milesTenths: 5136, amountPence: 23112 },
        taxYear: { from: '2026-04-06', to: '2027-04-05', trips: 3, milesTenths: 954, amountPence: 4293 },
        drivers: [{ driverId: 'd1', displayName: 'Driver A', taxYearMilesTenths: 954, standardMilesLeftTenths: 99046 }],
      },
    })
  })

  it('returns an error instead of zeros when the query fails, and logs each error field', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout', details: null, hint: null } })

    await expect(getTripStats()).resolves.toEqual({ error: 'Failed to fetch trip stats' })
    expect(consoleError).toHaveBeenCalledWith('[mileage] headline totals failed', {
      code: '57014',
      message: 'timeout',
      details: null,
      hint: null,
    })
    consoleError.mockRestore()
  })

  it('returns a plain error when the database sends totals in an unexpected shape', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRpc.mockResolvedValue({ data: { quarter: null }, error: null })

    await expect(getTripStats()).resolves.toEqual({ error: 'Failed to fetch trip stats' })
    expect(consoleError).toHaveBeenCalledWith('[mileage] headline totals had an unexpected shape', expect.any(Object))
    consoleError.mockRestore()
  })

  it('checks permission before reading anything', async () => {
    vi.mocked(checkUserPermission).mockResolvedValueOnce(false)

    await expect(getTripStats()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe('manual mileage trip mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation(() => createMileageTripsQuery())
    mockRpc.mockReset()
  })

  it('creates manual trips through the v02 RPC with the driver and request id', async () => {
    const upsertDistance = vi.fn().mockResolvedValue({ error: null })
    mockRpc.mockResolvedValue({ data: { id: 'trip-1', created: true }, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_destinations') return createSingleBuilder({ id: HOME_ID })
      if (table === 'mileage_destination_distances') return { upsert: upsertDistance }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await createTrip({
      tripDate: '2026-04-24',
      description: 'Supplier run',
      driverId: DRIVER_ID,
      requestId: REQUEST_ID,
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 10 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 10 },
      ],
    })

    expect(result).toEqual({ success: true, data: { id: 'trip-1' } })
    expect(mockRpc).toHaveBeenCalledWith('create_manual_mileage_trip_v02', {
      p_trip_date: '2026-04-24',
      p_description: 'Supplier run',
      p_total_miles: 20,
      p_created_by: 'test-user-id',
      p_legs: [
        { from_destination_id: HOME_ID, to_destination_id: DEST_ID, miles: 10 },
        { from_destination_id: DEST_ID, to_destination_id: HOME_ID, miles: 10 },
      ],
      p_driver_id: DRIVER_ID,
      p_request_id: REQUEST_ID,
    })
    expect(mockFrom).not.toHaveBeenCalledWith('mileage_trip_legs')
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ new_values: expect.objectContaining({ driver_id: DRIVER_ID }) })
    )
  })

  it('does not audit a retried create that returned the original trip', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'trip-1', created: false }, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_destinations') return createSingleBuilder({ id: HOME_ID })
      if (table === 'mileage_destination_distances') return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await createTrip({
      tripDate: '2026-04-24',
      description: 'Supplier run',
      driverId: DRIVER_ID,
      requestId: REQUEST_ID,
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 10 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 10 },
      ],
    })

    expect(result).toEqual({ success: true, data: { id: 'trip-1' } })
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled()
  })

  it('refuses a trip dated after today', async () => {
    const result = await createTrip({
      tripDate: '2026-05-06',
      description: 'Supplier run',
      driverId: DRIVER_ID,
      requestId: REQUEST_ID,
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 10 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 10 },
      ],
    })
    expect(result).toEqual({ error: "Trips can't be dated in the future." })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('asks who drove and for a reason before saving', async () => {
    const legs = [
      { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 10 },
      { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 10 },
    ]

    await expect(
      createTrip({ tripDate: '2026-04-24', description: 'Supplier run', driverId: '', requestId: REQUEST_ID, legs })
    ).resolves.toEqual({ error: 'Choose who drove' })
    await expect(
      createTrip({ tripDate: '2026-04-24', description: '   ', driverId: DRIVER_ID, requestId: REQUEST_ID, legs })
    ).resolves.toEqual({ error: 'Enter the reason for the trip' })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('maps a database refusal to plain words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'MILEAGE_DRIVER_REQUIRED', details: null, hint: null } })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_destinations') return createSingleBuilder({ id: HOME_ID })
      if (table === 'mileage_destination_distances') return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await createTrip({
      tripDate: '2026-04-24',
      description: 'Supplier run',
      driverId: DRIVER_ID,
      requestId: REQUEST_ID,
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 10 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 10 },
      ],
    })

    expect(result).toEqual({ error: 'Choose who drove.' })
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled()
  })

  it('updates through the v02 RPC with the loaded updated_at', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'trip-1' }, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') {
        return createSingleBuilder({ id: 'trip-1', source: 'manual', trip_date: '2026-04-20', total_miles: 12 })
      }
      if (table === 'mileage_destinations') return createSingleBuilder({ id: HOME_ID })
      if (table === 'mileage_destination_distances') return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await updateTrip({
      id: '00000000-0000-4000-8000-000000000020',
      tripDate: '2026-04-24',
      description: 'Updated run',
      driverId: DRIVER_ID,
      expectedUpdatedAt: '2026-09-15T15:08:08.431218+00:00',
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 8 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 8 },
      ],
    })

    expect(result).toEqual({ success: true })
    expect(mockRpc).toHaveBeenCalledWith('update_manual_mileage_trip_v02', {
      p_trip_id: '00000000-0000-4000-8000-000000000020',
      p_trip_date: '2026-04-24',
      p_description: 'Updated run',
      p_total_miles: 16,
      p_legs: [
        { from_destination_id: HOME_ID, to_destination_id: DEST_ID, miles: 8 },
        { from_destination_id: DEST_ID, to_destination_id: HOME_ID, miles: 8 },
      ],
      p_driver_id: DRIVER_ID,
      p_expected_updated_at: '2026-09-15T15:08:08.431218+00:00',
    })
    expect(mockFrom).not.toHaveBeenCalledWith('mileage_trip_legs')
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledTimes(1)
  })

  it('maps a stale edit to a reload message and does not audit it', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'MILEAGE_TRIP_CONFLICT', details: null, hint: null } })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') {
        return createSingleBuilder({ id: 'trip-1', source: 'manual', trip_date: '2026-04-20', total_miles: 12 })
      }
      if (table === 'mileage_destinations') return createSingleBuilder({ id: HOME_ID })
      if (table === 'mileage_destination_distances') return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await updateTrip({
      id: '00000000-0000-4000-8000-000000000020',
      tripDate: '2026-04-24',
      description: 'Updated run',
      driverId: DRIVER_ID,
      expectedUpdatedAt: '2026-09-15T15:08:08.431218+00:00',
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 8 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 8 },
      ],
    })

    expect(result).toEqual({ error: 'This trip was changed elsewhere. Reload it and try again.' })
    expect(mockRpc).toHaveBeenCalledWith(
      'update_manual_mileage_trip_v02',
      expect.objectContaining({ p_expected_updated_at: '2026-09-15T15:08:08.431218+00:00', p_driver_id: DRIVER_ID })
    )
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled()
  })

  it('logs an unknown save failure field by field and tells the user nothing changed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'new row violates check constraint', details: 'Failing row', hint: null },
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_destinations') return createSingleBuilder({ id: HOME_ID })
      if (table === 'mileage_destination_distances') return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await createTrip({
      tripDate: '2026-04-24',
      description: 'Supplier run',
      driverId: DRIVER_ID,
      requestId: REQUEST_ID,
      legs: [
        { fromDestinationId: HOME_ID, toDestinationId: DEST_ID, miles: 10 },
        { fromDestinationId: DEST_ID, toDestinationId: HOME_ID, miles: 10 },
      ],
    })

    expect(result).toEqual({ error: 'Failed to save the trip. Nothing was changed. Try again.' })
    expect(consoleError).toHaveBeenCalledWith('[mileage] trip save failed', {
      code: '23514',
      message: 'new row violates check constraint',
      details: 'Failing row',
      hint: null,
    })
    consoleError.mockRestore()
  })
})

describe('getRatePreviewContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('counts nothing until a driver is chosen', async () => {
    await expect(getRatePreviewContext({ tripDate: '2026-04-24', driverId: null })).resolves.toEqual({
      data: { cumulativeMilesBefore: 0 },
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('leaves the trip id out for a new trip', async () => {
    mockRpc.mockResolvedValue({ data: 9876.54, error: null })

    await expect(getRatePreviewContext({ tripDate: '2026-04-24', driverId: DRIVER_ID })).resolves.toEqual({
      data: { cumulativeMilesBefore: 9876.5 },
    })
    expect(mockRpc).toHaveBeenCalledWith('mileage_rate_preview_v01', {
      p_driver_id: DRIVER_ID,
      p_trip_date: '2026-04-24',
    })
  })

  it('passes the trip id when editing', async () => {
    mockRpc.mockResolvedValue({ data: '120.0', error: null })
    const tripId = '00000000-0000-4000-8000-000000000020'

    await expect(
      getRatePreviewContext({ tripDate: '2026-04-24', driverId: DRIVER_ID, excludeTripId: tripId })
    ).resolves.toEqual({ data: { cumulativeMilesBefore: 120 } })
    expect(mockRpc).toHaveBeenCalledWith('mileage_rate_preview_v01', {
      p_driver_id: DRIVER_ID,
      p_trip_date: '2026-04-24',
      p_trip_id: tripId,
    })
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

const TRIP_ID = '00000000-0000-4000-8000-000000000101'

/** A query chain that resolves to the given rows, whatever filters are applied. */
function createResolvedChain(data: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'eq', 'order']) chain[method] = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve, reject)
  return chain
}

function createMaybeSingleBuilder(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  return { select, eq, maybeSingle }
}

const NO_FILTERS = { from: null, to: null, q: '', placeId: null, source: null, driverId: null, sort: 'date', dir: 'desc', page: 1 } as const

function fixturePage() {
  const json = buildDatasetJson()
  return { data: { rows: json.trips, total_count: 3, totals: { trips: 3, miles_tenths: 570, amount_pence: 3101 } }, error: null }
}

describe('listMileageTrips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('loads the requested page and the totals of every matching trip', async () => {
    mockRpc.mockResolvedValue(fixturePage())

    const result = await listMileageTrips({ ...NO_FILTERS, driverId: DRIVER_ID, sort: 'miles', page: 2 })

    expect(mockRpc).toHaveBeenCalledWith('mileage_trips_page_v01', {
      p_filters: { driver_id: DRIVER_ID },
      p_sort: 'miles',
      p_direction: 'desc',
      p_limit: 25,
      p_offset: 25,
    })
    expect(result.success).toBe(true)
    expect(result.data?.rows).toHaveLength(3)
    expect(result.data?.totals).toEqual({ trips: 3, milesTenths: 570, amountPence: 3101 })
  })

  it('returns a plain error, not an empty list, when the database refuses', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout', details: null, hint: null } })

    await expect(listMileageTrips(NO_FILTERS)).resolves.toEqual({ error: "Couldn't load trips. Try again." })
    consoleError.mockRestore()
  })

  it('refuses a malformed query without reading anything', async () => {
    const result = await listMileageTrips({ ...NO_FILTERS, sort: 'route' } as never)

    expect(result).toEqual({ error: "Couldn't load trips. Try again." })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('checks permission before reading anything', async () => {
    vi.mocked(checkUserPermission).mockResolvedValueOnce(false)

    await expect(listMileageTrips(NO_FILTERS)).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe('exportMileageListCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockReset()
  })

  it('exports every matching trip in the table order and names the filters in the summary', async () => {
    mockRpc.mockResolvedValue(fixturePage())

    const result = await exportMileageListCsv({ ...NO_FILTERS, from: '2026-04-01', to: '2026-06-30', q: 'shop', page: 4 })

    // Every matching trip from the first row, whatever page the table is on.
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('mileage_trips_page_v01', {
      p_filters: { from: '2026-04-01', to: '2026-06-30', search: 'shop' },
      p_sort: 'date',
      p_direction: 'desc',
      p_limit: 1000,
      p_offset: 0,
    })
    expect(result.error).toBeUndefined()
    expect(result.filename).toBe('Mileage_Trips_2026-05-05.csv')
    expect(result.data).toContain('Period,1 April 2026 to 30 June 2026')
    expect(result.data).toContain('Scope,Dates: 1 April 2026 to 30 June 2026; Search: shop')
    expect(result.data).toContain('Total claim (£),31.01')
    expect(result.data).toContain('Claim for Driver A (£),23.53')
    expect(result.data).toContain('Claim for Driver B (£),7.48')
  })

  it('names the place, source and driver it was filtered to', async () => {
    mockRpc.mockResolvedValue(fixturePage())
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_destinations') return createMaybeSingleBuilder({ name: 'Shop One' })
      if (table === 'mileage_drivers') return createMaybeSingleBuilder({ display_name: 'Driver A' })
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await exportMileageListCsv({ ...NO_FILTERS, placeId: DEST_ID, source: 'manual', driverId: DRIVER_ID })

    expect(result.data).toContain('Period,All dates')
    expect(result.data).toContain('Scope,Place: Shop One; Source: Logged; Driver: Driver A')
  })

  it('returns an error instead of a file when a filter name cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRpc.mockResolvedValue(fixturePage())
    mockFrom.mockImplementation(() =>
      createMaybeSingleBuilder(null, { code: '57014', message: 'timeout', details: null, hint: null })
    )

    const result = await exportMileageListCsv({ ...NO_FILTERS, placeId: DEST_ID })

    expect(result).toEqual({ error: "Couldn't load trips. Try again." })
    expect(consoleError).toHaveBeenCalledWith('[mileage] export place name failed', {
      code: '57014',
      message: 'timeout',
      details: null,
      hint: null,
    })
    consoleError.mockRestore()
  })

  it('refuses more trips than one export supports', async () => {
    mockRpc.mockResolvedValue({ data: { rows: [], total_count: 5001, totals: { trips: 5001, miles_tenths: 1, amount_pence: 1 } }, error: null })

    const result = await exportMileageListCsv(NO_FILTERS)

    expect(result.data).toBeUndefined()
    expect(result.error).toBe('Too many trips to export at once. Narrow the dates and try again.')
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('returns an error instead of an empty file when the database refuses', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'MILEAGE_LIST_INVALID_FILTERS', details: null, hint: null } })

    const result = await exportMileageListCsv(NO_FILTERS)

    expect(result.data).toBeUndefined()
    expect(result.error).toBe("Couldn't load trips. Try again.")
    consoleError.mockRestore()
  })

  it('returns an error instead of a partial file when a row is malformed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const [good, bad] = buildDatasetJson().trips
    mockRpc.mockResolvedValue({
      data: { rows: [good, { ...bad, amount_pence: 'lots' }], total_count: 2, totals: { trips: 2, miles_tenths: 170, amount_pence: 901 } },
      error: null,
    })

    const result = await exportMileageListCsv(NO_FILTERS)

    expect(result).toEqual({ error: "Couldn't load trips. Try again." })
    consoleError.mockRestore()
  })
})

describe('getTripForEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses an id that is not a UUID without querying', async () => {
    const result = await getTripForEdit('not-a-uuid')
    expect(result.error).toBe('Trip not found.')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('loads the trip with its legs, driver and exact updated_at', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mileage_trips') {
        return createSingleBuilder({
          id: TRIP_ID, trip_date: '2026-04-04', description: 'Shop One', total_miles: 3.4, miles_at_standard_rate: 3.4,
          miles_at_reduced_rate: 0, amount_due: 1.53, source: 'manual', created_at: '2026-04-04T10:00:00+00:00',
          driver_id: 'driver-1', driver_basis: 'entered', updated_at: '2026-09-15T15:08:08.431218+00:00',
          driver: { display_name: 'Driver A' },
        })
      }
      if (table === 'mileage_trip_legs') {
        return createResolvedChain([
          { id: 'leg-1', trip_id: TRIP_ID, leg_order: 1, from_destination_id: HOME_ID, to_destination_id: DEST_ID, miles: 1.7 },
          { id: 'leg-2', trip_id: TRIP_ID, leg_order: 2, from_destination_id: DEST_ID, to_destination_id: HOME_ID, miles: 1.7 },
        ])
      }
      return createResolvedChain([{ id: HOME_ID, name: 'The Anchor' }, { id: DEST_ID, name: 'Shop One' }])
    })

    const result = await getTripForEdit(TRIP_ID)

    expect(result.error).toBeUndefined()
    expect(result.data).toMatchObject({
      id: TRIP_ID,
      driverName: 'Driver A',
      driverBasis: 'entered',
      updatedAt: '2026-09-15T15:08:08.431218+00:00',
      routeSummary: 'The Anchor → Shop One → The Anchor',
      legs: [
        { fromDestinationName: 'The Anchor', toDestinationName: 'Shop One', miles: 1.7 },
        { fromDestinationName: 'Shop One', toDestinationName: 'The Anchor', miles: 1.7 },
      ],
    })
  })

  it('says the trip is gone when it was deleted after the list loaded', async () => {
    mockFrom.mockImplementation(() =>
      createSingleBuilder(null, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null })
    )

    await expect(getTripForEdit(TRIP_ID)).resolves.toEqual({ error: 'Trip not found.' })
  })

  it('reports a failed read as a failure, not as a missing trip', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFrom.mockImplementation(() =>
      createSingleBuilder(null, { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null })
    )

    await expect(getTripForEdit(TRIP_ID)).resolves.toEqual({ error: "Couldn't load the trip. Try again." })
    expect(consoleError).toHaveBeenCalledWith('[mileage] trip for edit failed', {
      code: '57014',
      message: 'canceling statement due to statement timeout',
      details: null,
      hint: null,
    })
    consoleError.mockRestore()
  })

  it('checks the manage permission before reading anything', async () => {
    vi.mocked(checkUserPermission).mockResolvedValueOnce(false)

    await expect(getTripForEdit(TRIP_ID)).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(vi.mocked(checkUserPermission)).toHaveBeenCalledWith('mileage', 'manage')
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

function createDateRangeQuery(result: (ascending: boolean) => { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  let ascending = true
  chain.select = vi.fn(() => chain)
  chain.order = vi.fn((_column: string, options: { ascending: boolean }) => {
    ascending = options.ascending
    return chain
  })
  chain.limit = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => result(ascending))
  return chain
}

describe('getTripDateRange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the first and latest trip dates', async () => {
    mockFrom.mockImplementation(() =>
      createDateRangeQuery((ascending) => ({ data: { trip_date: ascending ? '2024-01-05' : '2026-09-14' }, error: null }))
    )
    expect(await getTripDateRange()).toEqual({ success: true, data: { first: '2024-01-05', last: '2026-09-14' } })
    expect(mockFrom).toHaveBeenCalledWith('mileage_trips')
  })

  it('returns no dates when there are no trips', async () => {
    mockFrom.mockImplementation(() => createDateRangeQuery(() => ({ data: null, error: null })))
    expect(await getTripDateRange()).toEqual({ success: true, data: { first: null, last: null } })
  })

  it('returns an error rather than empty dates when the query fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFrom.mockImplementation(() =>
      createDateRangeQuery(() => ({ data: null, error: { code: '08006', message: 'connection reset', details: null, hint: null } }))
    )
    expect(await getTripDateRange()).toEqual({ error: 'Failed to load trip dates' })
    expect(consoleError).toHaveBeenCalledWith('[mileage] trip date range failed', {
      code: '08006',
      message: 'connection reset',
      details: null,
      hint: null,
    })
    consoleError.mockRestore()
  })

  it('checks permission before reading anything', async () => {
    vi.mocked(checkUserPermission).mockResolvedValueOnce(false)

    await expect(getTripDateRange()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
