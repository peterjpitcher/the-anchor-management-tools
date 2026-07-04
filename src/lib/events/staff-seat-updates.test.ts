import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PartySizeUpdateFailedAfterMoveError,
  updateTableBookingPartySizeWithLinkedEventSeats
} from './staff-seat-updates'
import {
  getMoveTableAvailability,
  moveBookingAssignmentToTables
} from '@/lib/table-bookings/move-table'

vi.mock('@/lib/events/manage-booking', () => ({
  updateEventBookingSeatsById: vi.fn()
}))
vi.mock('@/lib/events/event-payments', () => ({
  sendEventBookingSeatUpdateSms: vi.fn()
}))
vi.mock('@/lib/google-calendar-events', () => ({
  syncPubOpsEventCalendarByEventId: vi.fn()
}))
vi.mock('@/lib/sms/safety-info', () => ({
  extractSmsSafetyInfo: vi.fn(() => ({ code: null, logFailure: false }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@/lib/table-bookings/move-table', () => ({
  getMoveTableAvailability: vi.fn(),
  moveBookingAssignmentToTables: vi.fn()
}))

const mockedGetAvailability = vi.mocked(getMoveTableAvailability)
const mockedMoveToTables = vi.mocked(moveBookingAssignmentToTables)

const bookingRow = {
  id: 'tb-1',
  status: 'confirmed',
  party_size: 6,
  event_booking_id: null,
  event_id: null,
  booking_date: '2026-07-10',
  booking_time: '18:00:00',
  start_datetime: '2026-07-10T17:00:00.000Z',
  end_datetime: '2026-07-10T19:00:00.000Z',
  duration_minutes: 120
}

type UpdateResult = { data: Record<string, unknown> | null; error: { message: string } | null }

function createSupabaseStub(updateResult: UpdateResult) {
  const updateMock = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => updateResult)
      }))
    }))
  }))

  const from = vi.fn((table: string) => {
    if (table === 'table_bookings') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: bookingRow, error: null }))
          }))
        })),
        update: updateMock
      }
    }
    if (table === 'booking_table_assignments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: [{ table_id: 'old-1', tables: { capacity: 6 } }],
            error: null
          }))
        }))
      }
    }
    throw new Error(`Unexpected table in stub: ${table}`)
  })

  return { client: { from } as never, updateMock }
}

const availability = {
  startIso: '2026-07-10T17:00:00.000Z',
  endIso: '2026-07-10T19:00:00.000Z',
  assignedTableIds: ['old-1'],
  tables: [
    { id: 'new-1', table_ids: ['new-1'], table_number: '9', name: 'Table 9', capacity: 8 },
    { id: 'combo', table_ids: ['new-2', 'new-3'], table_number: null, name: 'Table 2 + Table 3', capacity: 10 }
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetAvailability.mockResolvedValue(availability)
  mockedMoveToTables.mockResolvedValue({ ok: true })
})

describe('updateTableBookingPartySizeWithLinkedEventSeats (auto-move grow)', () => {
  it('should save the party size and report the auto-move when growth outstrips the table', async () => {
    const { client } = createSupabaseStub({
      data: { id: 'tb-1', party_size: 8, committed_party_size: 8, updated_at: '2026-07-04T10:00:00.000Z' },
      error: null
    })

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1',
      partySize: 8,
      autoMoveTable: true
    })

    expect(result.state).toBe('updated')
    expect(result.auto_moved_table_ids).toEqual(['new-1'])
    expect(result.updated_booking).toEqual({
      id: 'tb-1',
      party_size: 8,
      committed_party_size: 8,
      updated_at: '2026-07-04T10:00:00.000Z'
    })
    expect(mockedMoveToTables).toHaveBeenCalledTimes(1)
    expect(mockedMoveToTables.mock.calls[0][1]).toMatchObject({
      bookingId: 'tb-1',
      targetTableIds: ['new-1']
    })
  })

  it('should honour a staff-picked table setup when it is still available', async () => {
    const { client } = createSupabaseStub({
      data: { id: 'tb-1', party_size: 8, committed_party_size: 8, updated_at: null },
      error: null
    })

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1',
      partySize: 8,
      autoMoveTable: true,
      preferredTableIds: ['new-3', 'new-2']
    })

    expect(result.state).toBe('updated')
    expect(result.auto_moved_table_ids).toEqual(['new-2', 'new-3'])
    expect(mockedMoveToTables.mock.calls[0][1]).toMatchObject({
      targetTableIds: ['new-2', 'new-3']
    })
  })

  it('should move the booking back when the size write fails after the move committed', async () => {
    const { client } = createSupabaseStub({ data: null, error: { message: 'update failed' } })

    await expect(
      updateTableBookingPartySizeWithLinkedEventSeats(client, {
        tableBookingId: 'tb-1',
        partySize: 8,
        autoMoveTable: true
      })
    ).rejects.toMatchObject({
      name: 'PartySizeUpdateFailedAfterMoveError',
      movedBack: true
    })

    expect(mockedMoveToTables).toHaveBeenCalledTimes(2)
    expect(mockedMoveToTables.mock.calls[1][1]).toMatchObject({
      bookingId: 'tb-1',
      targetTableIds: ['old-1']
    })
  })

  it('should say the booking stayed on the new tables when compensation fails', async () => {
    const { client } = createSupabaseStub({ data: null, error: { message: 'update failed' } })
    mockedMoveToTables
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 409, error: 'taken' })

    let thrown: unknown
    try {
      await updateTableBookingPartySizeWithLinkedEventSeats(client, {
        tableBookingId: 'tb-1',
        partySize: 8,
        autoMoveTable: true
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PartySizeUpdateFailedAfterMoveError)
    expect((thrown as PartySizeUpdateFailedAfterMoveError).movedBack).toBe(false)
    expect((thrown as PartySizeUpdateFailedAfterMoveError).message).toContain('already moved')
  })

  it('should rethrow the raw update error when no auto-move happened', async () => {
    const { client } = createSupabaseStub({ data: null, error: { message: 'update failed' } })

    // Shrinking never triggers the capacity/auto-move path.
    await expect(
      updateTableBookingPartySizeWithLinkedEventSeats(client, {
        tableBookingId: 'tb-1',
        partySize: 3,
        autoMoveTable: true
      })
    ).rejects.toMatchObject({ message: 'update failed' })

    expect(mockedMoveToTables).not.toHaveBeenCalled()
  })
})
