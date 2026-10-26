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

function supabaseWith(booking: Record<string, unknown> | null) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: booking, error: null }) }) }) }),
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

  it('keeps to 4 to 20 guests', async () => {
    expect(await change({ removedSeats: [1, 2, 3] })).toMatchObject({ reason: 'christmas_size' })
    expect(await change({ added: { oneCourse: 15, twoCourses: 0, threeCourses: 0 } })).toMatchObject({ reason: 'christmas_size' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('says when nothing was asked for', async () => {
    expect(await change()).toMatchObject({ reason: 'christmas_no_change' })
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
