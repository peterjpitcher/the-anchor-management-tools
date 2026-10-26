import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHRISTMAS_LATE_MANAGER_MESSAGE,
  CHRISTMAS_LATE_TIER_MESSAGE,
  PartySizeUpdateFailedAfterMoveError,
  christmasSeatsMovingUp,
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
  duration_minutes: 120,
  christmas_course_counts: undefined as number[] | undefined,
  booking_type: 'regular' as string,
  booking_period_answer: null as boolean | null
}

type UpdateResult = { data: Record<string, unknown> | null; error: { message: string; code?: string } | null }

type PreorderFixture = {
  covers: Array<{ id: string; ordinal: number }>
  selections: Array<{ id: string; cover_id: string; course: string }>
}

/**
 * `policy` is what christmas_course_policy_v01 answers: open before the pre-order deadline, closed
 * after it, null for a date with no Christmas course policy. A Christmas write goes through
 * change_christmas_party_v01, which answers with `updateResult` too. `preorder` is the booking's
 * seats and dishes, read when courses are recorded for the first time.
 */
function createSupabaseStub(
  updateResult: UpdateResult,
  policy: 'open' | 'closed' | null = 'open',
  preorder: PreorderFixture = { covers: [], selections: [] }
) {
  const deleteIn = vi.fn(async (_column: string, _ids: string[]) => ({ error: null }))
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
    if (table === 'booking_preorder_covers') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: preorder.covers, error: null })) }))
      }
    }
    if (table === 'booking_preorder_selections') {
      return {
        select: vi.fn(() => ({ in: vi.fn(async () => ({ data: preorder.selections, error: null })) })),
        delete: vi.fn(() => ({ in: deleteIn }))
      }
    }
    throw new Error(`Unexpected table in stub: ${table}`)
  })

  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (name === 'christmas_course_policy_v01') {
      return { data: policy === null ? null : { multiple_courses_available: policy === 'open' }, error: null }
    }
    if (name === 'change_christmas_party_v01') return updateResult
    throw new Error(`Unexpected rpc in stub: ${name}`)
  })

  return { client: { from, rpc } as never, updateMock, rpc, deleteIn }
}

/** The change_christmas_party_v01 calls a stub received. */
function christmasWrites(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.filter(([name]) => name === 'change_christmas_party_v01').map(([, args]) => args)
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
  bookingRow.christmas_course_counts = undefined
  bookingRow.booking_type = 'regular'
  bookingRow.booking_period_answer = null
  bookingRow.party_size = 6
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


describe('Christmas amendment preflight', () => {
  it('rejects missing course choices before any table move or update', async () => {
    bookingRow.christmas_course_counts = [1, 1, 1, 1, 1, 1]
    const { client } = createSupabaseStub({ data: null, error: null })
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, { tableBookingId: 'tb-1', partySize: 7, autoMoveTable: true }))
      .rejects.toThrow('Choose one, two or three courses')
    expect(mockedGetAvailability).not.toHaveBeenCalled()
    expect(mockedMoveToTables).not.toHaveBeenCalled()
  })
  it('lets staff take a Christmas booking down to the 4-guest minimum', async () => {
    bookingRow.christmas_course_counts = [1, 1, 1, 1, 1, 1]
    const { client, rpc, updateMock } = createSupabaseStub({
      data: { id: 'tb-1', party_size: 4, committed_party_size: 4, updated_at: '2026-10-26T10:00:00.000Z' },
      error: null
    })
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 4, autoMoveTable: true, christmasCourseCounts: [1, 1, 1, 1]
    })
    expect(result.state).toBe('updated')
    expect(christmasWrites(rpc)).toEqual([{ p_booking_id: 'tb-1', p_course_counts: [1, 1, 1, 1], p_removed_ordinals: [] }])
    expect(updateMock).not.toHaveBeenCalled()
  })
  it('refuses a Christmas booking below 4 guests with the real reason', async () => {
    bookingRow.christmas_course_counts = [1, 1, 1, 1, 1, 1]
    const { client } = createSupabaseStub({ data: null, error: null })
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 3, autoMoveTable: true, christmasCourseCounts: [1, 1, 1]
    })).rejects.toThrow('Christmas bookings are for 4 to 20 guests.')
    expect(mockedMoveToTables).not.toHaveBeenCalled()
  })
  it('rejects a course change after the deadline before moving tables', async () => {
    bookingRow.christmas_course_counts = [1, 1, 1, 1, 1, 1]
    const { client } = createSupabaseStub({ data: null, error: null }, 'closed')
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 7, autoMoveTable: true, christmasCourseCounts: [1, 1, 1, 1, 1, 1, 2],
      canMakeLateChristmasChange: async () => true
    })).rejects.toThrow('deadline has passed')
    expect(mockedMoveToTables).not.toHaveBeenCalled()
  })
})

// BK-053: the 4 to 20 rule holds on every Christmas amendment, not only those with courses recorded.
describe('Christmas booking with no courses recorded', () => {
  it('refuses fewer than 4 guests on a staff change', async () => {
    bookingRow.booking_type = 'christmas'
    bookingRow.booking_period_answer = true
    const { client, updateMock } = createSupabaseStub({ data: null, error: null })
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 3, autoMoveTable: true
    })).rejects.toThrow('Christmas bookings are for 4 to 20 guests.')
    expect(updateMock).not.toHaveBeenCalled()
  })
  it('still saves a plain size change between 4 and 20', async () => {
    bookingRow.booking_type = 'christmas'
    bookingRow.booking_period_answer = true
    const { client, updateMock } = createSupabaseStub({
      data: { id: 'tb-1', party_size: 5, committed_party_size: 5, updated_at: null }, error: null
    })
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, { tableBookingId: 'tb-1', partySize: 5, autoMoveTable: true })
    expect(result.state).toBe('updated')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ party_size: 5 }))
  })
})

// BK-054 and owner decision D21: in the final week a manager can drop a named guest, or add one on
// 1 course, without reopening anyone's dishes. Nobody can move up to more courses.
describe('Christmas party changes after the pre-order deadline', () => {
  const manager = async () => true
  const notManager = async () => false

  it('lets a manager take 8 to 7 by naming the guest who is not coming, and flags it as late', async () => {
    bookingRow.christmas_course_counts = [3, 2, 2, 3, 1, 1, 1, 1]
    bookingRow.party_size = 8
    const { client, rpc } = createSupabaseStub({
      data: {
        id: 'tb-1', party_size: 7, committed_party_size: 7, updated_at: '2026-12-01T12:00:00.000Z',
        removed: [{ id: 'cover-2', ordinal: 2, guest_name: 'Dave', courses: [{ course: 'main', item_name: 'Turkey' }] }]
      },
      error: null
    }, 'closed')
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 7, autoMoveTable: true,
      christmasCourseCounts: [3, 2, 3, 1, 1, 1, 1], christmasRemovedSeats: [2], canMakeLateChristmasChange: manager
    })
    expect(result.state).toBe('updated')
    expect(result.late_change).toBe(true)
    expect(christmasWrites(rpc)).toEqual([{ p_booking_id: 'tb-1', p_course_counts: [3, 2, 3, 1, 1, 1, 1], p_removed_ordinals: [2] }])
    expect(result.removed_covers).toEqual([{ id: 'cover-2', ordinal: 2, guestName: 'Dave', courses: [{ course: 'main', itemName: 'Turkey' }] }])
  })

  it('lets a manager take 7 to 8 with a new guest on 1 course', async () => {
    bookingRow.christmas_course_counts = [3, 2, 2, 3, 1, 1, 1]
    bookingRow.party_size = 7
    const { client, rpc } = createSupabaseStub({
      data: { id: 'tb-1', party_size: 8, committed_party_size: 8, updated_at: null }, error: null
    }, 'closed')
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 8, autoMoveTable: true,
      christmasCourseCounts: [3, 2, 2, 3, 1, 1, 1, 1], canMakeLateChristmasChange: manager
    })
    expect(result.state).toBe('updated')
    expect(result.late_change).toBe(true)
    expect(christmasWrites(rpc)).toHaveLength(1)
  })

  it('refuses anyone without manage, before any table move or write', async () => {
    bookingRow.christmas_course_counts = [3, 2, 2, 3, 1, 1, 1, 1]
    bookingRow.party_size = 8
    const { client, rpc } = createSupabaseStub({ data: null, error: null }, 'closed')
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 7, autoMoveTable: true,
      christmasCourseCounts: [3, 2, 3, 1, 1, 1, 1], christmasRemovedSeats: [2], canMakeLateChristmasChange: notManager
    })).rejects.toThrow(CHRISTMAS_LATE_MANAGER_MESSAGE)
    expect(christmasWrites(rpc)).toHaveLength(0)
  })

  it('refuses a caller that cannot be asked, such as a guest', async () => {
    bookingRow.christmas_course_counts = [3, 2, 2, 3, 1, 1, 1]
    bookingRow.party_size = 7
    const { client } = createSupabaseStub({ data: null, error: null }, 'closed')
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 8, autoMoveTable: true, christmasCourseCounts: [3, 2, 2, 3, 1, 1, 1, 1]
    })).rejects.toThrow(CHRISTMAS_LATE_MANAGER_MESSAGE)
  })

  it('refuses a guest moving up, even for a manager', async () => {
    bookingRow.christmas_course_counts = [3, 2, 2, 3, 1, 1, 1]
    bookingRow.party_size = 7
    const { client, rpc } = createSupabaseStub({ data: null, error: null }, 'closed')
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 7, autoMoveTable: true,
      christmasCourseCounts: [3, 2, 2, 3, 2, 1, 1], canMakeLateChristmasChange: manager
    })).rejects.toThrow(CHRISTMAS_LATE_TIER_MESSAGE)
    expect(christmasWrites(rpc)).toHaveLength(0)
  })

  it('refuses a new guest on 2 courses, even when another guest leaves', async () => {
    bookingRow.christmas_course_counts = [3, 2, 2, 3, 1, 1, 1]
    bookingRow.party_size = 7
    const { client } = createSupabaseStub({ data: null, error: null }, 'closed')
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 7, autoMoveTable: true,
      christmasCourseCounts: [3, 2, 3, 1, 1, 1, 2], christmasRemovedSeats: [2], canMakeLateChristmasChange: manager
    })).rejects.toThrow(CHRISTMAS_LATE_TIER_MESSAGE)
  })
})

describe('naming the Christmas guests who leave', () => {
  it('refuses a seat that is not on the booking', async () => {
    bookingRow.christmas_course_counts = [3, 2, 1, 1, 1]
    bookingRow.party_size = 5
    const { client, rpc } = createSupabaseStub({ data: null, error: null })
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 4, autoMoveTable: true, christmasCourseCounts: [3, 2, 1, 1], christmasRemovedSeats: [6]
    })).rejects.toThrow('Choose the guests who are leaving')
    expect(christmasWrites(rpc)).toHaveLength(0)
  })

  it('asks staff to tick who is leaving rather than guessing from the end', async () => {
    bookingRow.christmas_course_counts = [3, 2, 1, 1, 1]
    bookingRow.party_size = 5
    const { client } = createSupabaseStub({ data: null, error: null })
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 4, autoMoveTable: true
    })).rejects.toThrow('Tick the guests who are not coming')
  })

  it('treats the same size with a guest swapped out as a change', async () => {
    bookingRow.christmas_course_counts = [3, 1, 1, 1]
    bookingRow.party_size = 4
    const { client, rpc } = createSupabaseStub({ data: { id: 'tb-1', party_size: 4, committed_party_size: 4, updated_at: null }, error: null })
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 4, autoMoveTable: true, christmasCourseCounts: [3, 1, 1, 1], christmasRemovedSeats: [2]
    })
    expect(result.state).toBe('updated')
    expect(christmasWrites(rpc)).toEqual([{ p_booking_id: 'tb-1', p_course_counts: [3, 1, 1, 1], p_removed_ordinals: [2] }])
  })

  it("passes on the database's own Christmas refusal in its words", async () => {
    bookingRow.christmas_course_counts = [3, 2, 1, 1, 1]
    bookingRow.party_size = 5
    const { client } = createSupabaseStub({
      data: null, error: { message: 'Christmas pre-order deadline has passed for that date.', code: '22023' }
    })
    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 4, autoMoveTable: true, christmasCourseCounts: [3, 1, 1, 1], christmasRemovedSeats: [2]
    })).rejects.toMatchObject({ name: 'Error', message: 'Christmas pre-order deadline has passed for that date.' })
  })
})

describe('christmasSeatsMovingUp', () => {
  it('names nothing when guests leave or join on 1 course', () => {
    expect(christmasSeatsMovingUp([3, 2, 2, 3, 1, 1, 1, 1], [3, 2, 3, 1, 1, 1, 1], [2])).toEqual([])
    expect(christmasSeatsMovingUp([3, 2, 2, 3, 1, 1, 1], [3, 2, 2, 3, 1, 1, 1, 1], [])).toEqual([])
  })
  it('names a guest who stays and moves up, by their new seat', () => {
    expect(christmasSeatsMovingUp([3, 1, 1, 1], [3, 2, 1], [2])).toEqual([2])
  })
  it('names a new guest on 2 or 3 courses', () => {
    expect(christmasSeatsMovingUp([1, 1, 1, 1], [1, 1, 1, 1, 3], [])).toEqual([5])
  })
  it('treats every seat as new when nothing was recorded', () => {
    expect(christmasSeatsMovingUp(null, [1, 2, 1, 1], [])).toEqual([2])
  })
  it('drops the last seats when the party shrinks and nobody is named', () => {
    expect(christmasSeatsMovingUp([1, 1, 1, 3], [1, 1, 1], [])).toEqual([])
  })
})

// BK-057: a Christmas booking taken by staff with no courses can have them recorded once, before
// the deadline, so its guests stop being chased for a main they may not owe.
describe('recording Christmas courses on a booking that has none', () => {
  it('records the courses at the same party size', async () => {
    bookingRow.booking_type = 'christmas'
    bookingRow.booking_period_answer = true
    const { client, rpc } = createSupabaseStub({
      data: { id: 'tb-1', party_size: 6, committed_party_size: 6, updated_at: '2026-10-26T10:00:00.000Z' },
      error: null
    })

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 6, autoMoveTable: true, christmasCourseCounts: [3, 3, 2, 2, 1, 1]
    })

    expect(result.state).toBe('updated')
    expect(christmasWrites(rpc)).toEqual([{ p_booking_id: 'tb-1', p_course_counts: [3, 3, 2, 2, 1, 1], p_removed_ordinals: [] }])
  })

  it('clears earlier dishes that the new courses no longer allow, and keeps the rest', async () => {
    bookingRow.booking_type = 'christmas'
    bookingRow.booking_period_answer = true
    const { client, deleteIn } = createSupabaseStub(
      { data: { id: 'tb-1', party_size: 6, committed_party_size: 6, updated_at: '2026-10-26T10:00:00.000Z' }, error: null },
      'open',
      {
        covers: [
          { id: 'seat-1', ordinal: 1 }, { id: 'seat-3', ordinal: 3 }, { id: 'seat-4', ordinal: 4 }, { id: 'seat-5', ordinal: 5 }
        ],
        selections: [
          // Seat 1 is on 3 courses: keeps everything.
          { id: 's1-starter', cover_id: 'seat-1', course: 'starter' }, { id: 's1-main', cover_id: 'seat-1', course: 'main' },
          { id: 's1-dessert', cover_id: 'seat-1', course: 'dessert' },
          // Seat 3 is on 2 courses with a main and a dessert: that fits, so it stays.
          { id: 's3-main', cover_id: 'seat-3', course: 'main' }, { id: 's3-dessert', cover_id: 'seat-3', course: 'dessert' },
          // Seat 4 is on 2 courses but holds a starter and a dessert: it chooses again.
          { id: 's4-starter', cover_id: 'seat-4', course: 'starter' }, { id: 's4-main', cover_id: 'seat-4', course: 'main' },
          { id: 's4-dessert', cover_id: 'seat-4', course: 'dessert' },
          // Seat 5 is on 1 course: chooses on the day, so nothing stays.
          { id: 's5-main', cover_id: 'seat-5', course: 'main' }
        ]
      }
    )

    const result = await updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 6, autoMoveTable: true, christmasCourseCounts: [3, 3, 2, 2, 1, 1]
    })

    expect(result.state).toBe('updated')
    expect(deleteIn).toHaveBeenCalledTimes(1)
    expect(deleteIn).toHaveBeenCalledWith('id', ['s4-starter', 's4-main', 's4-dessert', 's5-main'])
  })

  it('refuses 2 or 3 courses once the deadline has passed', async () => {
    bookingRow.booking_type = 'christmas'
    bookingRow.booking_period_answer = true
    const { client, rpc, updateMock } = createSupabaseStub({ data: null, error: null }, 'closed')

    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 6, autoMoveTable: true, christmasCourseCounts: [3, 3, 2, 2, 1, 1],
      canMakeLateChristmasChange: async () => true
    })).rejects.toThrow('deadline has passed')
    expect(updateMock).not.toHaveBeenCalled()
    expect(christmasWrites(rpc)).toHaveLength(0)
  })

  it('still refuses courses on a booking that is not a Christmas dinner', async () => {
    const { client } = createSupabaseStub({ data: null, error: null })

    await expect(updateTableBookingPartySizeWithLinkedEventSeats(client, {
      tableBookingId: 'tb-1', partySize: 6, autoMoveTable: true, christmasCourseCounts: [1, 1, 1, 1, 1, 1]
    })).rejects.toThrow('retains its original course policy')
  })
})
