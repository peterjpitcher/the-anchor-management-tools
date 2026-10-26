import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Review BK-070 and BK-071, owner decision D24 (24 October 2026): a private hire was only ever
 * checked against other hires, so a party could be confirmed on top of diners who booked first,
 * events and hires never warned about each other, and a whole-pub hire let tickets keep selling.
 * Clashes with diners, event seats and events are now warned about and listed, never refused; the
 * hire-against-hire check fails closed instead of letting a save through on a diary it could not
 * read; confirming or reinstating a hire re-checks its rooms against other hires.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
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
  }
})
// Readiness (rooms, guest count, contract) passes here; it has its own tests.
vi.mock('@/services/private-bookings/readiness', async (importOriginal) =>
  (await import('../helpers/readyHire')).readyHireReadiness(importOriginal))

import {
  DIARY_CHECK_FAILED_MESSAGE,
  findBookingConflicts,
  getBookingConflictSummary,
  getBookingSpaceIds,
} from '@/services/private-bookings/conflicts'
import {
  NIGHT_CHECK_FAILED_WARNING,
  describeHireNightWarning,
  hireNightWarning,
  loadEventIdsClosedByWholePubHire,
  loadHireNightView,
  loadPrivateHiresOnDate,
  type HireNightView,
} from '@/services/private-bookings/night-clashes'
import { addBookingItem, updateBooking, updateBookingStatus } from '@/services/private-bookings'

const NOW = new Date('2026-10-24T09:00:00.000Z')
const ROOMS = [
  { id: 'space-dining', name: 'The Dining Room', capacity_seated: 26, capacity_standing: 50, blocks_all_spaces: false, active: true, vat_rate: 20 },
  { id: 'space-whole', name: 'Entire Pub', capacity_seated: 119, capacity_standing: 300, blocks_all_spaces: true, active: true, vat_rate: 20 },
]

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'confirmed',
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
    hold_expiry: null,
    deposit_amount: 250,
    deposit_paid_date: '2026-10-20T10:00:00.000Z',
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

const DINER_ROW = {
  clash_kind: 'table_booking', table_booking_id: 'tb-1', event_booking_id: null, event_id: null, event_name: null,
  booking_reference: 'TB-1234', guest_name: 'Ann Diner', covers: 4,
  starts_at: '2026-11-27T19:00:00+00:00', ends_at: '2026-11-27T21:00:00+00:00', table_names: 'Table 1',
}
const SEATS_ROW = {
  clash_kind: 'event_seats', table_booking_id: null, event_booking_id: 'eb-1', event_id: 'event-1', event_name: 'Quiz Night',
  booking_reference: null, guest_name: 'Ben Seats', covers: 5,
  starts_at: '2026-11-27T19:00:00+00:00', ends_at: '2026-11-27T22:00:00+00:00', table_names: 'Table 2',
}

type Rpc = Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }>

function seed(options: {
  booking?: Record<string, unknown>
  items?: Record<string, unknown>[]
  events?: Record<string, unknown>[]
  eventBookings?: Record<string, unknown>[]
  rpc?: Rpc
} = {}) {
  state.db = createFakeSupabase({
    private_bookings: [options.booking ?? bookingRow()],
    private_bookings_with_details: [{ id: 'booking-1', gross_total: 1440, calculated_total: 1200 }],
    private_booking_items: options.items ?? [{ id: 'item-1', booking_id: 'booking-1', item_type: 'space', space_id: 'space-dining', display_order: 0 }],
    venue_spaces: ROOMS,
    private_booking_audit: [],
    private_booking_sms_queue: [],
    events: options.events ?? [],
    bookings: options.eventBookings ?? [],
    customers: [{ id: 'customer-1', email: 'alex@example.com', mobile_number: '+447700900123' }],
  })
  const handlers: Rpc = {
    get_private_booking_conflicts: () => ({ data: [], error: null }),
    get_private_booking_diner_clashes: () => ({ data: [], error: null }),
    events_closed_by_whole_pub_hire: () => ({ data: [], error: null }),
    ...options.rpc,
  }
  state.db.rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
    handlers[name] ? handlers[name](args) : { data: null, error: null })
  return state.db
}

function view(overrides: Partial<HireNightView> = {}): HireNightView {
  return { date: '2026-11-27', wholePub: false, holdsRoom: true, dinerClashes: [], events: [], ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

describe('the warning after a save (D24: warned, never refused)', () => {
  it('says nothing when the night is clear', () => {
    expect(describeHireNightWarning(null)).toBeNull()
    expect(describeHireNightWarning(view())).toBeNull()
  })

  it('counts the diners and event places already in the rooms', async () => {
    seed({ rpc: { get_private_booking_diner_clashes: () => ({ data: [DINER_ROW, { ...DINER_ROW, table_booking_id: 'tb-2', booking_reference: 'TB-5678', covers: 2 }, SEATS_ROW], error: null }) } })
    const night = await loadHireNightView('booking-1')

    expect(describeHireNightWarning(night)).toBe(
      "This hire's rooms already have 2 table bookings (6 guests) and 1 event booking (5 places) that night. They are listed on the booking under Clashes on this night.",
    )
  })

  it('names the events a whole-pub hire stops, with the tickets already sold', () => {
    const quiz = { id: 'event-1', name: 'Quiz Night', time: '19:00', bookingMode: 'general', status: 'scheduled', ticketsSold: 12, salesStopped: true, closedByThisHire: true }
    const empty = { ...quiz, id: 'event-2', name: 'Open Mic', ticketsSold: 0 }
    expect(describeHireNightWarning(view({ wholePub: true, events: [quiz, empty] }))).toBe(
      'This hire takes the whole pub, so ticket sales have stopped for Quiz Night (12 tickets sold). Tickets already sold still stand.',
    )
    expect(describeHireNightWarning(view({ wholePub: true, holdsRoom: false, events: [{ ...quiz, salesStopped: false }] }))).toBe(
      'This hire takes the whole pub: once it is confirmed or its deposit is paid, ticket sales stop for Quiz Night (12 tickets sold). Tickets already sold still stand.',
    )
    // One room: events are listed on the page, not warned about.
    expect(describeHireNightWarning(view({ events: [{ ...quiz, closedByThisHire: false, salesStopped: false }] }))).toBeNull()
  })

  it('says the night was not checked when a read fails, and never throws', async () => {
    seed({ rpc: { get_private_booking_diner_clashes: () => ({ data: null, error: { message: 'permission denied' } }) } })
    await expect(hireNightWarning('booking-1')).resolves.toBe(NIGHT_CHECK_FAILED_WARNING)
  })
})

describe('the night view on the booking page', () => {
  it('lists the diners, and the events that night with live tickets and whether sales stopped', async () => {
    const db = seed({
      items: [{ id: 'item-1', booking_id: 'booking-1', item_type: 'space', space_id: 'space-whole' }],
      events: [
        { id: 'event-1', name: 'Quiz Night', date: '2026-11-27', time: '19:00', booking_mode: 'general', event_status: 'scheduled' },
        { id: 'event-2', name: 'Late Show', date: '2026-11-27', time: '22:00', booking_mode: 'table', event_status: 'scheduled' },
        { id: 'event-3', name: 'Called Off', date: '2026-11-27', time: '20:00', booking_mode: 'general', event_status: 'cancelled' },
      ],
      eventBookings: [
        { id: 'eb-1', event_id: 'event-1', seats: 4, status: 'confirmed', hold_expires_at: null },
        { id: 'eb-2', event_id: 'event-1', seats: 2, status: 'pending_payment', hold_expires_at: '2026-10-24T09:30:00.000Z' },
        { id: 'eb-3', event_id: 'event-1', seats: 9, status: 'pending_payment', hold_expires_at: '2026-10-24T08:00:00.000Z' },
        { id: 'eb-4', event_id: 'event-1', seats: 7, status: 'cancelled', hold_expires_at: null },
      ],
      rpc: {
        get_private_booking_diner_clashes: () => ({ data: [DINER_ROW], error: null }),
        events_closed_by_whole_pub_hire: () => ({
          data: [{ event_id: 'event-1', private_booking_id: 'booking-1' }, { event_id: 'event-2', private_booking_id: 'other-hire' }],
          error: null,
        }),
      },
    })

    const night = await loadHireNightView('booking-1')

    expect(night).toMatchObject({ date: '2026-11-27', wholePub: true, holdsRoom: true })
    expect(night!.dinerClashes).toEqual([{
      kind: 'table_booking', tableBookingId: 'tb-1', eventBookingId: null, eventId: null, eventName: null,
      reference: 'TB-1234', guestName: 'Ann Diner', covers: 4,
      startsAt: '2026-11-27T19:00:00+00:00', endsAt: '2026-11-27T21:00:00+00:00', tableNames: 'Table 1',
    }])
    expect(night!.events.map((event) => [event.name, event.ticketsSold, event.salesStopped, event.closedByThisHire])).toEqual([
      ['Quiz Night', 6, true, true],
      ['Late Show', 0, true, false],
    ])
    // The booking page asks which events this hire would close even before it holds its room.
    expect(db.rpc).toHaveBeenCalledWith('events_closed_by_whole_pub_hire', {
      p_event_ids: ['event-1', 'event-2'],
      p_assume_holding: 'booking-1',
    })
  })

  it('shows nothing for an undated, cancelled or completed hire', async () => {
    for (const booking of [bookingRow({ date_tbd: true }), bookingRow({ status: 'cancelled' }), bookingRow({ status: 'completed' })]) {
      seed({ booking })
      await expect(loadHireNightView('booking-1')).resolves.toBeNull()
    }
  })

  it('throws rather than showing a clear night when a read fails', async () => {
    seed({ rpc: { get_private_booking_diner_clashes: () => ({ data: null, error: { message: 'timeout' } }) } })
    await expect(loadHireNightView('booking-1')).rejects.toThrow("Could not check the diners in this hire's rooms")
  })
})

describe('private hires on an event date (event form)', () => {
  it('lists dated draft and confirmed hires with their rooms, and whether each holds them', async () => {
    seed({ items: [{ id: 'item-1', booking_id: 'booking-1', item_type: 'space', space_id: 'space-whole' }] })
    state.db.tables.private_bookings.push(
      bookingRow({ id: 'booking-2', status: 'draft', deposit_paid_date: null, hold_expiry: '2026-10-20T00:00:00.000Z', start_time: '12:00:00', end_time: '15:00:00' }),
      bookingRow({ id: 'booking-3', date_tbd: true }),
      bookingRow({ id: 'booking-4', status: 'cancelled' }),
    )

    const hires = await loadPrivateHiresOnDate('2026-11-27')

    expect(hires.map((hire) => [hire.id, hire.roomNames, hire.wholePub, hire.holdsRoom, hire.startTime])).toEqual([
      ['booking-2', [], false, false, '12:00'],
      ['booking-1', ['Entire Pub'], true, true, '19:00'],
    ])
  })
})

describe('the events feed', () => {
  it('closes the events a whole-pub hire takes, and closes nothing when it cannot check', async () => {
    seed({ rpc: { events_closed_by_whole_pub_hire: () => ({ data: [{ event_id: 'event-1', private_booking_id: 'hire-1' }], error: null }) } })
    expect([...(await loadEventIdsClosedByWholePubHire(['event-1', 'event-2']))]).toEqual(['event-1'])

    seed({ rpc: { events_closed_by_whole_pub_hire: () => ({ data: null, error: { message: 'function does not exist' } }) } })
    expect([...(await loadEventIdsClosedByWholePubHire(['event-1']))]).toEqual([])
  })
})

describe('the hire-against-hire check fails closed (BK-070)', () => {
  it('refuses when the check cannot run, where it used to report no clashes', async () => {
    seed({ rpc: { get_private_booking_conflicts: () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } }) } })
    await expect(findBookingConflicts({ eventDate: '2026-11-27', startTime: '19:00', spaceIds: ['space-dining'] }))
      .rejects.toThrow(DIARY_CHECK_FAILED_MESSAGE)

    state.db.rpc = vi.fn(async () => { throw new Error('fetch failed') })
    await expect(findBookingConflicts({ eventDate: '2026-11-27', spaceIds: ['space-dining'] })).rejects.toThrow(DIARY_CHECK_FAILED_MESSAGE)
  })

  it('refuses when the booked rooms cannot be read, where an empty list skipped the check', async () => {
    const db = seed()
    db.failures.push({ table: 'private_booking_items', op: 'select', error: { message: 'timeout' } })
    await expect(getBookingSpaceIds('booking-1')).rejects.toThrow(DIARY_CHECK_FAILED_MESSAGE)
  })

  it('finds nothing to clash with for an undated hire, without asking the diary', async () => {
    const db = seed({ booking: bookingRow({ date_tbd: true }) })
    await expect(getBookingConflictSummary('booking-1')).resolves.toEqual([])
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('refuses to add a room when the booking cannot be read for the clash check', async () => {
    const db = seed()
    db.failures.push({ table: 'private_bookings', op: 'select', error: { message: 'timeout' } })
    await expect(addBookingItem({
      booking_id: 'booking-1', item_type: 'space', space_id: 'space-whole', description: 'Entire Pub', quantity: 1, unit_price: 0,
    })).rejects.toThrow(DIARY_CHECK_FAILED_MESSAGE)
  })
})

describe('saving a hire over diners', () => {
  it('adds the room and warns about the diners already in it', async () => {
    seed({ rpc: { get_private_booking_diner_clashes: () => ({ data: [DINER_ROW], error: null }) } })

    const result = await addBookingItem({
      booking_id: 'booking-1', item_type: 'space', space_id: 'space-whole', description: 'Entire Pub', quantity: 1, unit_price: 0,
    })

    expect(result.success).toBe(true)
    expect(result.warning).toContain("This hire's rooms already have 1 table booking (4 guests) that night.")
    expect(state.db.tables.private_booking_items.some((item: { space_id: string }) => item.space_id === 'space-whole')).toBe(true)
  })

  it('re-checks the rooms against other hires when a cancelled hire is reinstated', async () => {
    const db = seed({
      booking: bookingRow({ status: 'cancelled', cancelled_at: '2026-10-01T10:00:00.000Z' }),
      rpc: {
        get_private_booking_conflicts: () => ({
          data: [{ booking_id: 'booking-9', customer_name: 'Other Party', booking_status: 'confirmed', space_name: 'The Dining Room', blocks_all: false, occupies_from: '2026-11-27T18:30:00+00:00', occupies_until: '2026-11-28T00:00:00+00:00' }],
          error: null,
        }),
      },
    })

    await expect(updateBookingStatus('booking-1', 'draft', 'user-1')).rejects.toThrow(
      'Space conflict: The Dining Room is held by Other Party (confirmed) from Fri 27 Nov 18:30 to Sat 28 Nov 00:00',
    )
    expect(db.rpc).toHaveBeenCalledWith('get_private_booking_conflicts', expect.objectContaining({
      p_event_date: '2026-11-27', p_space_ids: ['space-dining'], p_exclude_booking_id: 'booking-1',
    }))
    expect(db.tables.private_bookings[0].status).toBe('cancelled')
  })

  it('does not ask the diary when a cancelled hire stays cancelled', async () => {
    const db = seed({ booking: bookingRow({ status: 'cancelled', cancelled_at: '2026-10-01T10:00:00.000Z' }) })

    await updateBooking('booking-1', { contact_email: 'new@example.com', setup_date: '', setup_time: '' })

    expect(db.rpc).not.toHaveBeenCalledWith('get_private_booking_conflicts', expect.anything())
    expect(db.tables.private_bookings[0].contact_email).toBe('new@example.com')
  })
})
