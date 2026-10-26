import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * The private bookings list flags, in red, each draft or confirmed hire with its deposit paid
 * while still a draft, no room, no guest count, or more guests than its rooms hold (review BK-005
 * and BK-007). Completed and cancelled bookings are not flagged.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { fetchPrivateBookings } from '@/services/private-bookings/queries'
import { logger } from '@/lib/logger'

const DINING = { id: 'space-dining', name: 'The Dining Room', capacity_seated: 26, capacity_standing: 50, blocks_all_spaces: false, active: true, display_order: 1 }

function booking(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'confirmed',
    customer_name: 'Sam Smith',
    event_date: '2026-11-14',
    start_time: '19:00:00',
    guest_count: 30,
    layout: null,
    deposit_amount: 250,
    deposit_paid_date: '2026-10-01T10:00:00.000Z',
    deposit_waived: false,
    deposit_confirmed_at: '2026-09-20T10:00:00.000Z',
    contract_sent_at: null,
    contract_accepted_at: null,
    internal_notes: null,
    gross_total: 1200,
    ...overrides,
  }
}

function seed(bookings: Record<string, unknown>[], items: Record<string, unknown>[]) {
  state.db = createFakeSupabase({
    private_bookings: bookings,
    private_bookings_with_details: bookings,
    private_booking_items: items,
    venue_spaces: [DINING],
    private_booking_audit: [],
    private_booking_payments: [],
    private_booking_invoices: [],
  })
}

describe('the private bookings list', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flags hires with no room, no guest count, too many guests, or a paid deposit left as a draft', async () => {
    seed(
      [
        booking('no-room'),
        booking('no-guests', { guest_count: null }),
        booking('too-many', { guest_count: 120 }),
        booking('paid-draft', { status: 'draft', guest_count: 70 }),
        booking('fine'),
        booking('done', { status: 'completed' }),
      ],
      [
        { id: 'i2', booking_id: 'no-guests', item_type: 'space', space_id: DINING.id },
        { id: 'i3', booking_id: 'too-many', item_type: 'space', space_id: DINING.id },
        { id: 'i4', booking_id: 'paid-draft', item_type: 'space', space_id: DINING.id },
        { id: 'i5', booking_id: 'fine', item_type: 'space', space_id: DINING.id },
        { id: 'i6', booking_id: 'done', item_type: 'space', space_id: DINING.id },
      ],
    )

    const { data } = await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    expect(
      Object.fromEntries(
        data.map((row) => [row.id, row.hire_attention ? { roomProblems: row.hire_attention.roomProblems, paidNotConfirmed: row.hire_attention.paidNotConfirmed } : null])
      )
    ).toEqual({
      'no-room': { roomProblems: ['no_room'], paidNotConfirmed: false },
      'no-guests': { roomProblems: ['no_guest_count'], paidNotConfirmed: false },
      'too-many': { roomProblems: ['over_capacity'], paidNotConfirmed: false },
      'paid-draft': { roomProblems: ['over_capacity'], paidNotConfirmed: true },
      fine: { roomProblems: [], paidNotConfirmed: false },
      done: null,
    })
  })

  // Review BK-006: the list showed nothing about the contract until 14 days before the event. It
  // now has a Contract column, red once the deposit is confirmed, paid or waived and the contract
  // has not been sent, because the booking cannot be confirmed until it has (D25).
  it('shows where each contract is, and flags a missing one once the deposit is confirmed', async () => {
    seed(
      [
        booking('accepted', { contract_sent_at: '2026-10-01T10:00:00.000Z', contract_accepted_at: '2026-10-02T10:00:00.000Z' }),
        booking('accepted-on-paper', { contract_accepted_at: '2026-10-02T11:00:00.000Z' }),
        booking('sent', { contract_sent_at: '2026-10-01T10:00:00.000Z' }),
        booking('not-sent-deposit-confirmed', { status: 'draft', deposit_paid_date: null }),
        booking('not-sent-enquiry', { status: 'draft', deposit_paid_date: null, deposit_confirmed_at: null }),
      ],
      [],
    )

    const { data } = await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    expect(
      Object.fromEntries(
        data.map((row) => [row.id, [row.hire_attention?.contract, row.hire_attention?.contractNotSentAfterDeposit]])
      )
    ).toEqual({
      accepted: ['accepted', false],
      'accepted-on-paper': ['accepted', false],
      sent: ['sent', false],
      'not-sent-deposit-confirmed': ['not_sent', true],
      'not-sent-enquiry': ['not_sent', false],
    })
  })

  it('still lists the bookings when the rooms cannot be read, and logs it', async () => {
    seed([booking('no-room')], [])
    state.db.failures.push({ table: 'private_booking_items', op: 'select', error: { message: 'timeout' } })

    const { data } = await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    expect(data).toHaveLength(1)
    expect(data[0].hire_attention).toBeNull()
    expect(logger.error).toHaveBeenCalledWith('Could not check rooms for the private bookings list', expect.anything())
  })
})
