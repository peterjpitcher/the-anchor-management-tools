import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A booker changing Christmas numbers on their manage link (BK-053, owner decision D21): until the
 * deadline they name who is not coming and add guests on 1, 2 or 3 courses, through the same path
 * staff use; after it, or with no courses recorded, they are asked to ring.
 */

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  deadline: vi.fn(),
  update: vi.fn(),
  deposit: vi.fn(),
  record: vi.fn(),
}))

vi.mock('@/lib/table-bookings/manage-booking', () => ({ getTableManagePreviewByRawToken: mocks.preview }))
vi.mock('@/lib/events/staff-seat-updates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events/staff-seat-updates')>('@/lib/events/staff-seat-updates')
  return {
    ChristmasCourseValidationError: actual.ChristmasCourseValidationError,
    readChristmasDeadline: mocks.deadline,
    updateTableBookingPartySizeWithLinkedEventSeats: mocks.update,
  }
})
vi.mock('@/lib/table-bookings/staff-deposit-transitions', () => ({ applyPartySizeDepositTransition: mocks.deposit }))
vi.mock('@/lib/table-bookings/party-size-alerts', () => ({ recordGuestPartySizeChange: mocks.record }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { changeChristmasPartyByRawToken } from '@/lib/table-bookings/guest-christmas-party'
import { ChristmasCourseValidationError } from '@/lib/events/staff-seat-updates'

const BOOKING = {
  id: 'booking-1',
  customer_id: 'customer-1',
  booking_reference: 'TB-XMAS',
  booking_date: '2026-12-12',
  party_size: 6,
  christmas_course_counts: [3, 2, 2, 1, 1, 1],
  booking_type: 'christmas',
  booking_period_id: 'period-1',
}

// The online Christmas ceiling as system_settings holds it; null reads as a missing row (default 26).
let christmasOnlineLimit: number | null = null

function supabaseWith(booking: Record<string, unknown> | null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'system_settings'
              ? { data: christmasOnlineLimit === null ? null : { value: { value: christmasOnlineLimit } }, error: null }
              : { data: booking, error: null },
        }),
      }),
    }),
  } as never
}

function change(overrides: Partial<Parameters<typeof changeChristmasPartyByRawToken>[1]> = {}, booking: Record<string, unknown> | null = BOOKING) {
  return changeChristmasPartyByRawToken(supabaseWith(booking), {
    rawToken: 'raw',
    removedSeats: [],
    added: { oneCourse: 0, twoCourses: 0, threeCourses: 0 },
    appBaseUrl: 'https://management.example',
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  christmasOnlineLimit = null
  mocks.preview.mockResolvedValue({ state: 'ready', table_booking_id: 'booking-1', booking_type: 'christmas', can_edit: true })
  mocks.deadline.mockResolvedValue('open')
  mocks.update.mockResolvedValue({ state: 'updated' })
  mocks.deposit.mockResolvedValue({
    state: 'manual_review',
    depositAmount: 60,
    message: 'The party size changed on a Christmas dinner 2026 booking, so the deposit has been left as it is.',
  })
})

describe('changeChristmasPartyByRawToken', () => {
  it('removes the named guest and adds new guests on their tiers, through the staff path', async () => {
    const result = await change({ removedSeats: [2], added: { oneCourse: 1, twoCourses: 0, threeCourses: 1 } })

    expect(result).toMatchObject({ state: 'updated', previousPartySize: 6, newPartySize: 7 })
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tableBookingId: 'booking-1',
      partySize: 7,
      christmasCourseCounts: [3, 2, 1, 1, 1, 1, 3],
      christmasRemovedSeats: [2],
      autoMoveTable: true,
    }))
    // A guest can never make a late change.
    expect(mocks.update.mock.calls[0][1].canMakeLateChristmasChange).toBeUndefined()
  })

  it('tells the manager to check the deposit, with who left and who joined', async () => {
    await change({ removedSeats: [2], added: { oneCourse: 1, twoCourses: 0, threeCourses: 0 } })

    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      tableBookingId: 'booking-1',
      bookingReference: 'TB-XMAS',
      previousPartySize: 6,
      newPartySize: 6,
      depositReview: expect.stringContaining('deposit has been left as it is'),
      christmas: { seatsRemoved: [2], tiersAdded: [1] },
    }))
  })

  it('asks the guest to ring once the deadline has passed, and changes nothing', async () => {
    mocks.deadline.mockResolvedValue('closed')
    expect(await change({ removedSeats: [2] })).toEqual({ state: 'blocked', reason: 'christmas_closed', tableBookingId: 'booking-1' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('asks the guest to ring when no courses are recorded', async () => {
    expect(await change({ removedSeats: [2] }, { ...BOOKING, christmas_course_counts: null })).toMatchObject({
      state: 'blocked', reason: 'christmas_call_us',
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  // Owner decision of 10 November 2026: a guest may grow their Christmas party to the online
  // ceiling (26), and no further.
  it('keeps to 4 guests at least and lets the guest grow the party to 26, not 27', async () => {
    expect(await change({ removedSeats: [1, 2, 3] })).toMatchObject({ reason: 'christmas_size' })
    expect(await change({ added: { oneCourse: 21, twoCourses: 0, threeCourses: 0 } })).toMatchObject({ reason: 'christmas_size' })
    expect(mocks.update).not.toHaveBeenCalled()

    expect(await change({ added: { oneCourse: 20, twoCourses: 0, threeCourses: 0 } })).toMatchObject({
      state: 'updated',
      newPartySize: 26,
    })
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ partySize: 26, christmasMaxPartySize: 26 }))
  })

  it('reads the ceiling from the setting', async () => {
    christmasOnlineLimit = 24
    expect(await change({ added: { oneCourse: 19, twoCourses: 0, threeCourses: 0 } })).toMatchObject({ reason: 'christmas_size' })
    expect(await change({ added: { oneCourse: 18, twoCourses: 0, threeCourses: 0 } })).toMatchObject({ newPartySize: 24 })
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ christmasMaxPartySize: 24 }))
  })

  it('lets a party staff booked above the ceiling get smaller, but not bigger', async () => {
    const thirty = { ...BOOKING, party_size: 30, christmas_course_counts: Array(30).fill(1) }
    expect(await change({ removedSeats: [30], added: { oneCourse: 0, twoCourses: 0, threeCourses: 0 } }, thirty)).toMatchObject({
      state: 'updated',
      previousPartySize: 30,
      newPartySize: 29,
    })
    expect(await change({ added: { oneCourse: 1, twoCourses: 0, threeCourses: 0 } }, thirty)).toMatchObject({ reason: 'christmas_size' })
  })

  it('turns the staff path ceiling refusal into the size message', async () => {
    mocks.update.mockRejectedValue(new ChristmasCourseValidationError('Christmas bookings are for 4 to 26 guests.'))
    expect(await change({ added: { oneCourse: 1, twoCourses: 0, threeCourses: 0 } })).toMatchObject({ reason: 'christmas_size' })
  })

  it('says when nothing was asked for', async () => {
    expect(await change()).toMatchObject({ reason: 'christmas_no_change' })
  })

  it('refuses a change from a page left open after the numbers changed, before anything is written', async () => {
    // The page showed seven guests; the booking now has six, so "seat 2" may be someone else.
    expect(await change({ removedSeats: [2], expectedCourses: [3, 3, 2, 2, 1, 1, 1] })).toEqual({
      state: 'blocked', reason: 'christmas_changed', tableBookingId: 'booking-1',
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('passes the course list it read to the staff path, so a racing change is refused there', async () => {
    await change({ removedSeats: [2], expectedCourses: [3, 2, 2, 1, 1, 1] })
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ christmasExpectedCourses: [3, 2, 2, 1, 1, 1] }))
  })

  it('refuses a seat that is not on the booking', async () => {
    expect(await change({ removedSeats: [7] })).toMatchObject({ reason: 'christmas_invalid' })
  })

  it('reports no table when a bigger party will not fit', async () => {
    mocks.update.mockResolvedValue({ state: 'blocked', reason: 'table_capacity_insufficient' })
    expect(await change({ added: { oneCourse: 2, twoCourses: 0, threeCourses: 0 } })).toMatchObject({ reason: 'no_table' })
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('turns a refusal from the staff path into the deadline message when it is one', async () => {
    mocks.update.mockRejectedValue(new ChristmasCourseValidationError('The Christmas pre-order deadline has passed.'))
    expect(await change({ removedSeats: [2] })).toMatchObject({ reason: 'christmas_closed' })
  })

  it('does nothing on a booking that is not a Christmas one', async () => {
    mocks.preview.mockResolvedValue({ state: 'ready', table_booking_id: 'booking-1', booking_type: 'regular', can_edit: true })
    expect(await change({ removedSeats: [2] })).toMatchObject({ reason: 'not_christmas' })
  })
})
