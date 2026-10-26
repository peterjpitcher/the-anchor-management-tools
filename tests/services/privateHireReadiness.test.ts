import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Owner decision D24 (24 October 2026), reviews BK-005, BK-007 and BK-066: a private hire takes the
 * rest of the pub off sale only through the room booked on it. A confirmed Saturday party had no
 * room at all, another had 120 guests in a room for 50, and a guest count went from 50 to 70 in a
 * room for 50 with no warning. A hire is now confirmed only with a room, a guest count and room
 * for its guests, or a manager's override for the capacity, whichever way it is confirmed; the
 * guests are re-checked whenever the guest count, layout, times or rooms change; and a paid
 * deposit that cannot confirm the booking says why.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))
vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))
vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true, channel: 'sms' })),
}))
vi.mock('@/lib/email/private-booking-emails', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email/private-booking-emails')>('@/lib/email/private-booking-emails')
  return {
    ...actual,
    sendBookingConfirmationEmail: vi.fn(async () => undefined),
    sendBookingCalendarInvite: vi.fn(async () => undefined),
    sendDepositReceivedEmail: vi.fn(async () => undefined),
  }
})
// No clash with another hire in these tests; the clash check has its own tests.
vi.mock('@/services/private-bookings/conflicts', async () => {
  const actual = await vi.importActual<typeof import('@/services/private-bookings/conflicts')>('@/services/private-bookings/conflicts')
  return {
    ...actual,
    findBookingConflicts: vi.fn(async () => []),
    getBookingConflictSummary: vi.fn(async () => []),
  }
})

import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import {
  addBookingItem,
  deleteBookingItem,
  finalizeDepositPayment,
  GATE_CHECK_FAILED_REASON,
  updateBooking,
  updateBookingStatus,
  updateDepositAmount,
} from '@/services/private-bookings'
import {
  assessHireRooms,
  buildHireReadinessView,
  capacityOverrideCovers,
  loadOneHireReadiness,
  suggestRoomsToAdd,
  type HireRoom,
} from '@/services/private-bookings/readiness'

const mockedSend = sendPrivateBookingMessage as unknown as Mock

// The venue's rooms as production holds them (venue_spaces, 24 October 2026).
const DINING: HireRoom = { id: 'space-dining', name: 'The Dining Room', capacity_seated: 26, capacity_standing: 50, blocks_all_spaces: false, active: true, display_order: 1 }
const GARDEN: HireRoom = { id: 'space-garden', name: 'Outdoor Terrace/Garden', capacity_seated: 64, capacity_standing: 250, blocks_all_spaces: false, active: true, display_order: 2 }
const MAIN: HireRoom = { id: 'space-main', name: 'The Main Area', capacity_seated: 29, capacity_standing: 150, blocks_all_spaces: false, active: true, display_order: 3 }
const WHOLE: HireRoom = { id: 'space-whole', name: 'Entire Pub', capacity_seated: 119, capacity_standing: 300, blocks_all_spaces: true, active: true, display_order: 4 }
const ROOMS = [DINING, GARDEN, MAIN, WHOLE]

const NOW = new Date('2026-10-24T09:00:00.000Z')

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'host@example.com',
    event_type: 'Birthday party',
    event_date: '2026-11-27',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    setup_date: null,
    setup_time: null,
    cleardown_time: null,
    guest_count: 40,
    layout: null,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-11-07T23:59:59.000Z',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    deposit_confirmed_at: '2026-10-20T10:00:00.000Z',
    balance_due_date: '2026-11-13',
    total_amount: 1200,
    calendar_event_id: null,
    contract_sent_at: '2026-10-20T10:00:00.000Z',
    contract_accepted_at: null,
    risk_status: 'normal',
    ...overrides,
  }
}

function roomItem(spaceId: string, id = `item-${spaceId}`) {
  return { id, booking_id: 'booking-1', item_type: 'space', space_id: spaceId, display_order: 0 }
}

function seed(booking: Record<string, unknown>, items: Record<string, unknown>[] = [], audit: Record<string, unknown>[] = []) {
  state.db = createFakeSupabase({
    private_bookings: [booking],
    private_bookings_with_details: [{ id: 'booking-1', gross_total: 1440, calculated_total: 1200 }],
    private_booking_items: items,
    venue_spaces: ROOMS,
    private_booking_audit: audit,
    private_booking_sms_queue: [],
    private_booking_payments: [],
    customers: [{ id: 'customer-1', email: 'alex@example.com', mobile_number: '+447700900123' }],
  })
  state.db.rpc = vi.fn(async () => ({ data: null, error: null }))
}

function overrideRow(maxGuests: number, spaceIds: string[], layout: string | null = null) {
  return {
    id: 'audit-override',
    booking_id: 'booking-1',
    action: 'capacity_override',
    performed_by: 'manager-1',
    performed_at: '2026-10-22T10:00:00.000Z',
    metadata: { max_guests: maxGuests, space_ids: spaceIds, layout, reason: 'Standing reception with the garden open' },
  }
}

function saved(): Record<string, any> {
  return state.db.tables.private_bookings[0]
}

describe('the rules', () => {
  it('needs a room and a guest count', () => {
    expect(assessHireRooms({ rooms: [], guestCount: null, layout: null }).map((problem) => problem.code)).toEqual([
      'no_room',
      'no_guest_count',
    ])
  })

  it('names the rooms that would fit the guests when they do not fit', () => {
    const [problem] = assessHireRooms({ rooms: [DINING], guestCount: 70, layout: null, candidates: ROOMS })
    expect(problem.code).toBe('over_capacity')
    expect(problem.message).toBe(
      'Guest count 70 exceeds the maximum capacity of 50 for The Dining Room. Add Outdoor Terrace/Garden, The Main Area or Entire Pub so the guests fit, or ask a manager to allow it.'
    )
  })

  it('counts a whole-venue space only when it holds everyone by itself', () => {
    // 120 seated: the Dining Room (26) and the Main Area (29) do not reach it together; the
    // garden (64) does not either; the Entire Pub (119) on its own does not.
    expect(suggestRoomsToAdd({ rooms: [DINING], guestCount: 120, layout: 'seated', candidates: ROOMS })).toEqual([])
    expect(suggestRoomsToAdd({ rooms: [DINING], guestCount: 110, layout: 'seated', candidates: ROOMS })).toEqual(['Entire Pub'])
  })

  it('lets a manager override cover exactly the rooms, layout and number it was given for', () => {
    const override = { maxGuests: 60, layout: null, spaceIds: [DINING.id], reason: 'x', grantedAt: '', grantedBy: null }
    expect(capacityOverrideCovers(override, { spaceIds: [DINING.id], layout: null, guestCount: 60 })).toBe(true)
    expect(capacityOverrideCovers(override, { spaceIds: [DINING.id], layout: null, guestCount: 61 })).toBe(false)
    expect(capacityOverrideCovers(override, { spaceIds: [DINING.id], layout: 'seated', guestCount: 40 })).toBe(false)
    expect(capacityOverrideCovers(override, { spaceIds: [DINING.id, MAIN.id], layout: null, guestCount: 40 })).toBe(false)
    expect(assessHireRooms({ rooms: [DINING], guestCount: 60, layout: null, override })).toEqual([])
  })

  it('reads the latest override and the reasons a paid deposit did not confirm the booking', async () => {
    seed(
      bookingRow({ deposit_paid_date: '2026-10-09T19:26:00.000Z', guest_count: 70 }),
      [roomItem(DINING.id)],
      [
        { id: 'a1', booking_id: 'booking-1', action: 'confirmation_blocked', performed_at: '2026-10-09T19:26:13.000Z', metadata: { reasons: ['Guest count 70 exceeds the maximum capacity of 50 for The Dining Room'] } },
        { ...overrideRow(55, [DINING.id]), id: 'old', performed_at: '2026-10-01T10:00:00.000Z' },
      ],
    )
    const { facts, rooms } = await loadOneHireReadiness('booking-1')
    const view = buildHireReadinessView(facts, rooms)

    expect(view.paidNotConfirmed).toEqual({
      reasons: ['Guest count 70 exceeds the maximum capacity of 50 for The Dining Room'],
      recordedAt: '2026-10-09T19:26:13.000Z',
    })
    // 70 is over the 55 allowed, so the room problem still shows.
    expect(view.roomProblems.map((problem) => problem.code)).toEqual(['over_capacity'])
    expect(view.roomCapacity).toBe(50)
  })
})

describe('a paid deposit on a hire that is not ready', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a hire with no room a draft, with the reason "no room booked", and says so', async () => {
    seed(bookingRow())

    const result = await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'cash', performedByUserId: 'user-1' }, state.db)

    expect(saved().deposit_paid_date).toBeTruthy()
    expect(saved().status).toBe('draft')
    expect(result.confirmationBlocked).toBe(true)
    expect(result.confirmationBlockedReasons).toEqual(['No room booked. Add the room the party will use, then confirm the booking.'])
    const blocked = state.db.tables.private_booking_audit.find((row: any) => row.action === 'confirmation_blocked')
    expect(blocked.metadata.reasons).toEqual(result.confirmationBlockedReasons)
  })

  it('keeps a hire with more guests than its room a draft, naming the room to add', async () => {
    seed(bookingRow({ guest_count: 70 }), [roomItem(DINING.id)])

    const result = await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'cash', performedByUserId: 'user-1' }, state.db)

    expect(saved().status).toBe('draft')
    expect(result.confirmationBlockedReasons?.[0]).toContain('Add Outdoor Terrace/Garden, The Main Area or Entire Pub')
  })

  it('confirms when a manager has allowed the guests in that room', async () => {
    seed(bookingRow({ guest_count: 55 }), [roomItem(DINING.id)], [overrideRow(60, [DINING.id])])

    const result = await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'cash', performedByUserId: 'user-1' }, state.db)

    expect(saved().status).toBe('confirmed')
    expect(result.confirmationBlocked).toBeUndefined()
  })

  it('keeps it a draft when the checks cannot run, rather than confirming as if all were well', async () => {
    seed(bookingRow(), [roomItem(DINING.id)])
    state.db.failures.push({ table: 'private_booking_items', op: 'select', error: { message: 'connection reset' } })

    const result = await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'cash', performedByUserId: 'user-1' }, state.db)

    expect(saved().deposit_paid_date).toBeTruthy()
    expect(saved().status).toBe('draft')
    expect(result.confirmationBlockedReasons).toEqual([GATE_CHECK_FAILED_REASON])
  })
})

describe('staff confirming a hire', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('is refused with no room booked, and nothing is sent', async () => {
    seed(bookingRow())

    await expect(updateBookingStatus('booking-1', 'confirmed', 'user-1')).rejects.toThrow(
      'This booking cannot be confirmed yet. No room is booked for this hire.'
    )
    expect(saved().status).toBe('draft')
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('is refused with no guest count', async () => {
    seed(bookingRow({ guest_count: null }), [roomItem(DINING.id)])

    await expect(updateBookingStatus('booking-1', 'confirmed', 'user-1')).rejects.toThrow('The guest count is not set')
    expect(saved().status).toBe('draft')
  })

  it('is refused with more guests than the room holds, then goes ahead once a manager allows it', async () => {
    seed(bookingRow({ guest_count: 70 }), [roomItem(DINING.id)])

    await expect(updateBookingStatus('booking-1', 'confirmed', 'user-1')).rejects.toThrow(
      'Guest count 70 exceeds the maximum capacity of 50 for The Dining Room'
    )
    expect(saved().status).toBe('draft')

    state.db.tables.private_booking_audit.push(overrideRow(70, [DINING.id]))
    await updateBookingStatus('booking-1', 'confirmed', 'user-1')
    expect(saved().status).toBe('confirmed')
  })

  it('judges the guest count saved in the same edit', async () => {
    seed(bookingRow({ guest_count: 70 }), [roomItem(DINING.id)])

    await updateBooking('booking-1', { status: 'confirmed', guest_count: 45 }, 'user-1')

    expect(saved()).toMatchObject({ status: 'confirmed', guest_count: 45 })
  })
})

describe('changing a hire', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('refuses a guest count the rooms cannot hold, and says which room to add', async () => {
    seed(bookingRow({ status: 'confirmed', guest_count: 50 }), [roomItem(DINING.id)])

    await expect(updateBooking('booking-1', { guest_count: 70 }, 'user-1')).rejects.toThrow(
      'Guest count 70 exceeds the maximum capacity of 50 for The Dining Room. Add Outdoor Terrace/Garden, The Main Area or Entire Pub so the guests fit'
    )
    expect(saved().guest_count).toBe(50)
  })

  it('refuses a layout the rooms cannot hold the guests in', async () => {
    seed(bookingRow({ guest_count: 40 }), [roomItem(DINING.id)])

    await expect(updateBooking('booking-1', { layout: 'seated' }, 'user-1')).rejects.toThrow(
      'Guest count 40 exceeds the seated capacity of 26 for The Dining Room'
    )
  })

  it('allows a guest count a manager has allowed in those rooms', async () => {
    seed(bookingRow({ status: 'confirmed', guest_count: 50 }), [roomItem(DINING.id)], [overrideRow(60, [DINING.id])])

    await updateBooking('booking-1', { guest_count: 58 }, 'user-1')

    expect(saved().guest_count).toBe(58)
  })

  it('checks again when the times move', async () => {
    seed(bookingRow({ guest_count: 70 }), [roomItem(DINING.id)])

    await expect(updateBooking('booking-1', { start_time: '18:00' }, 'user-1')).rejects.toThrow('exceeds the maximum capacity')
  })

  it('saves a new room, and says so when the guests still do not fit', async () => {
    seed(bookingRow({ guest_count: 400 }), [roomItem(DINING.id)])

    const result = await addBookingItem({
      booking_id: 'booking-1',
      item_type: 'space',
      space_id: MAIN.id,
      description: 'The Main Area',
      quantity: 4,
      unit_price: 50,
    })

    expect(state.db.tables.private_booking_items.some((item: any) => item.space_id === MAIN.id)).toBe(true)
    expect(result.warning).toContain('The room was added, but the guests still do not fit.')
  })

  it('refuses to remove the last room from a confirmed hire', async () => {
    seed(bookingRow({ status: 'confirmed' }), [roomItem(DINING.id)])

    await expect(deleteBookingItem(`item-${DINING.id}`)).rejects.toThrow('A confirmed booking must keep a room booked')
    expect(state.db.tables.private_booking_items).toHaveLength(1)
  })

  it('refuses to remove a room the guests need', async () => {
    seed(bookingRow({ guest_count: 120 }), [roomItem(DINING.id), roomItem(MAIN.id)])

    await expect(deleteBookingItem(`item-${MAIN.id}`)).rejects.toThrow('Guest count 120 exceeds the maximum capacity of 50 for The Dining Room')
    expect(state.db.tables.private_booking_items).toHaveLength(2)
  })

  it('lets a room go when the guests still fit', async () => {
    seed(bookingRow({ guest_count: 40 }), [roomItem(DINING.id), roomItem(MAIN.id)])

    // The fake does not hand back deleted rows, so the call itself then reports "Item not found";
    // what matters here is that the room check let the delete through.
    await deleteBookingItem(`item-${MAIN.id}`).catch((error: Error) => expect(error.message).toBe('Item not found'))

    expect(state.db.tables.private_booking_items).toHaveLength(1)
    expect(state.db.tables.private_booking_items[0].space_id).toBe(DINING.id)
  })
})

describe('waiving the deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('saves the waiver but keeps a hire with no room a draft, and says why', async () => {
    seed(bookingRow({ deposit_confirmed_at: null }))

    const outcome = await updateDepositAmount('booking-1', 0, 'user-1', { waived: true, waivedReason: 'Regular customer' })

    expect(saved()).toMatchObject({ status: 'draft', deposit_amount: 0, deposit_waived: true })
    expect(outcome.confirmationBlockedReasons).toEqual(['No room booked. Add the room the party will use, then confirm the booking.'])
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('still confirms a hire that is ready', async () => {
    seed(bookingRow({ deposit_confirmed_at: null }), [roomItem(DINING.id)])

    const outcome = await updateDepositAmount('booking-1', 0, 'user-1', { waived: true, waivedReason: 'Regular customer' })

    expect(saved().status).toBe('confirmed')
    expect(outcome.confirmationBlockedReasons).toBeUndefined()
  })
})

/**
 * Owner decision D25 (review BK-006): a hire cannot be confirmed until its contract has been sent,
 * or recorded as accepted another way. Four of the six upcoming confirmed hires had no contract:
 * three confirmed themselves when the deposit was paid and one on a waived £0 deposit.
 */
describe('the contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('stops staff confirming a hire whose contract has not been sent', async () => {
    seed(bookingRow({ contract_sent_at: null }), [roomItem(DINING.id)])

    await expect(updateBookingStatus('booking-1', 'confirmed', 'user-1')).rejects.toThrow(
      'This booking cannot be confirmed yet. The contract has not been sent. Send it from the Signatures panel, or record that the customer accepted it another way.'
    )
    expect(saved().status).toBe('draft')
  })

  it('lets staff confirm once the contract is recorded as accepted another way', async () => {
    seed(bookingRow({ contract_sent_at: null, contract_accepted_at: '2026-10-23T11:00:00.000Z' }), [roomItem(DINING.id)])

    await updateBookingStatus('booking-1', 'confirmed', 'user-1')

    expect(saved().status).toBe('confirmed')
  })

  it('keeps a paid hire with no contract a draft, and says why', async () => {
    seed(bookingRow({ contract_sent_at: null }), [roomItem(DINING.id)])

    const result = await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'paypal' }, state.db)

    expect(saved().status).toBe('draft')
    expect(result.confirmationBlockedReasons).toEqual([
      'Contract not sent. Send the contract, or record that the customer accepted it another way, then confirm the booking.',
    ])
  })

  it('keeps a waived hire with no contract a draft', async () => {
    seed(bookingRow({ contract_sent_at: null, deposit_confirmed_at: null }), [roomItem(DINING.id)])

    const outcome = await updateDepositAmount('booking-1', 0, 'user-1', { waived: true, waivedReason: 'Regular customer' })

    expect(saved().status).toBe('draft')
    expect(outcome.confirmationBlockedReasons).toEqual([
      'Contract not sent. Send the contract, or record that the customer accepted it another way, then confirm the booking.',
    ])
  })

  it('shows "contract not sent" once the deposit is confirmed', async () => {
    seed(bookingRow({ contract_sent_at: null }), [roomItem(DINING.id)])
    const { facts, rooms } = await loadOneHireReadiness('booking-1')
    expect(buildHireReadinessView(facts, rooms).contractNotSent).toBe(true)

    seed(bookingRow({ contract_sent_at: null, deposit_confirmed_at: null }), [roomItem(DINING.id)])
    const before = await loadOneHireReadiness('booking-1')
    expect(buildHireReadinessView(before.facts, before.rooms).contractNotSent).toBe(false)
  })
})
