import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * The private bookings list's follow-up reads now run together, and hold_expiry comes from the
 * view rather than a separate read (page load performance spec, P1). The list a user sees must be
 * exactly what it was: same rows, balances, hold expiry, deposit and attention flags.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { fetchPrivateBookings, fetchPrivateBookingsForCalendar } from '@/services/private-bookings/queries'

const DINING = { id: 'space-dining', name: 'The Dining Room', capacity_seated: 26, capacity_standing: 50, blocks_all_spaces: false, active: true, display_order: 1 }

const BASE = {
  customer_name: 'Sam Smith',
  event_date: '2099-11-14',
  start_time: '19:00:00',
  layout: null,
  internal_notes: null,
  contract_sent_at: null,
  contract_accepted_at: null,
  deposit_waived: false,
}

const BOOKINGS = [
  {
    ...BASE,
    id: 'held-draft',
    status: 'draft',
    guest_count: 20,
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_confirmed_at: null,
    hold_expiry: '2099-10-01T12:00:00.000Z',
    gross_total: 1200,
    calculated_total: 1000,
    total_amount: 1000,
  },
  {
    ...BASE,
    id: 'paid-awaiting',
    status: 'confirmed',
    guest_count: 20,
    deposit_amount: 250,
    deposit_paid_date: '2099-09-01T10:00:00.000Z',
    deposit_confirmed_at: null,
    contract_sent_at: '2099-09-02T10:00:00.000Z',
    hold_expiry: null,
    gross_total: 600,
    calculated_total: 500,
    total_amount: 500,
  },
  {
    ...BASE,
    id: 'completed',
    status: 'completed',
    guest_count: 10,
    deposit_amount: 0,
    deposit_paid_date: null,
    deposit_confirmed_at: null,
    hold_expiry: null,
    gross_total: 300,
    calculated_total: 250,
    total_amount: 250,
  },
]

function seed() {
  state.db = createFakeSupabase({
    private_bookings: BOOKINGS,
    private_bookings_with_details: BOOKINGS,
    private_booking_items: [
      { id: 'i1', booking_id: 'held-draft', item_type: 'space', space_id: DINING.id },
      { id: 'i2', booking_id: 'paid-awaiting', item_type: 'space', space_id: DINING.id },
    ],
    venue_spaces: [DINING],
    private_booking_audit: [],
    private_booking_payments: [
      { id: 'p1', booking_id: 'paid-awaiting', amount: 100, payment_method: 'card', created_at: '2099-09-03T10:00:00.000Z' },
    ],
    private_booking_invoices: [],
  })
}

describe('the private bookings list output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
  })

  it('is unchanged for a fixture: hold expiry, balances, deposit and attention flags', async () => {
    const { data, totalCount } = await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    expect(totalCount).toBe(3)
    expect(
      data.map((row) => ({
        id: row.id,
        hold_expiry: row.hold_expiry,
        balance_remaining: row.balance_remaining,
        deposit_status: row.deposit_status,
        deposit_awaiting_confirmation: row.deposit_awaiting_confirmation,
        hire_attention: row.hire_attention,
      }))
    ).toEqual([
      {
        id: 'held-draft',
        hold_expiry: '2099-10-01T12:00:00.000Z',
        balance_remaining: 1200,
        deposit_status: 'Required',
        deposit_awaiting_confirmation: true,
        hire_attention: { roomProblems: [], paidNotConfirmed: false, contract: 'not_sent', contractNotSentAfterDeposit: false },
      },
      {
        id: 'paid-awaiting',
        hold_expiry: undefined,
        balance_remaining: 500,
        deposit_status: 'Paid',
        deposit_awaiting_confirmation: false,
        hire_attention: { roomProblems: [], paidNotConfirmed: false, contract: 'sent', contractNotSentAfterDeposit: false },
      },
      {
        id: 'completed',
        hold_expiry: undefined,
        balance_remaining: 300,
        deposit_status: 'Not Required',
        deposit_awaiting_confirmation: false,
        hire_attention: null,
      },
    ])
  })

  it('reads hold expiry from the view, with no separate private_bookings read for it', async () => {
    const from = vi.spyOn(state.db, 'from')
    await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    // One read of the view, then private_bookings only for the ledger, the deposit confirmation
    // and the readiness facts (three reads, where there were four).
    const tables = from.mock.calls.map(([table]) => table)
    expect(tables.filter((table) => table === 'private_bookings_with_details')).toHaveLength(1)
    expect(tables.filter((table) => table === 'private_bookings')).toHaveLength(3)
  })
})

describe('the private bookings calendar', () => {
  it('reads upcoming bookings from the table, not the money view', async () => {
    state.db = createFakeSupabase({
      private_bookings: [
        { ...BOOKINGS[0], id: 'past', event_date: '2000-01-01' },
        { ...BOOKINGS[0], id: 'future' },
      ],
    })
    const from = vi.spyOn(state.db, 'from')

    const { data } = await fetchPrivateBookingsForCalendar()

    expect(data.map((row) => row.id)).toEqual(['future'])
    expect(from.mock.calls.map(([table]) => table)).toEqual(['private_bookings'])
  })
})
