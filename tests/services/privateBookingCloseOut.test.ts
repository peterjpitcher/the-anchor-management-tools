import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-062 and BK-131 (customer bookings review, 24 October 2026); owner decision D27: nothing
 * recorded what happened to a hire's deposit, or that its balance was paid, and nothing closed the
 * booking. The close-out records the balance settled at the till, the deposit's outcome and closes
 * the hire, sending the guest nothing.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/private-bookings/messenger', () => ({ sendPrivateBookingMessage: vi.fn() }))

import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { closeOutPrivateBooking } from '@/services/private-bookings/close-out'

const NOW = new Date('2026-10-27T10:00:00.000Z')
const BOOKING = 'booking-1'

function seed(overrides: Record<string, unknown> = {}, balanceRemaining = 640) {
  state.db = createFakeSupabase({
    private_bookings: [{
      id: BOOKING,
      status: 'confirmed',
      event_date: '2026-10-24',
      deposit_amount: 250,
      deposit_paid_date: '2026-09-01T10:00:00.000Z',
      deposit_refund_status: null,
      invoice_deposit_treatment: null,
      deposit_payment_method: 'cash',
      post_event_status: 'awaiting_inspection',
      ...overrides,
    }],
    private_bookings_with_details: [{ id: BOOKING, balance_remaining: balanceRemaining }],
    payment_refunds: [],
    private_booking_audit: [],
  })
  state.db.rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'reserve_refund_balance') {
      const row = { id: `refund-${state.db.tables.payment_refunds.length + 1}`, source_type: 'private_booking', source_id: args.p_source_id, amount: args.p_amount, status: 'pending', refund_method: args.p_refund_method }
      state.db.tables.payment_refunds.push(row)
      return { data: [{ refund_id: row.id }], error: null }
    }
    return { data: null, error: null }
  })
}

const stored = () => state.db.tables.private_bookings[0]
const rpcCalls = (name: string) => state.db.rpc.mock.calls.filter(([called]: [string]) => called === name).map(([, args]: [string, unknown]) => args)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('closing out a private hire', () => {
  it('records the balance settled at the till and the deposit returned, closes the hire, and sends nothing', async () => {
    seed()

    const result = await closeOutPrivateBooking({
      bookingId: BOOKING,
      balanceSettledAtTill: { method: 'card' },
      deposit: { outcome: 'returned', method: 'cash' },
      performedBy: 'user-1',
    })

    expect(result).toEqual({ balanceRecorded: 640, depositStatus: 'refunded', completed: true })
    expect(rpcCalls('record_balance_payment')).toEqual([{ p_booking_id: BOOKING, p_amount: 640, p_method: 'card', p_recorded_by: 'user-1' }])
    expect(state.db.tables.payment_refunds[0]).toMatchObject({ amount: 250, refund_method: 'cash', status: 'completed', notification_status: 'skipped' })
    expect(stored()).toMatchObject({ status: 'completed', post_event_status: 'complete', deposit_refund_status: 'refunded' })
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'closed_out', new_value: 'completed' })
    expect(sendPrivateBookingMessage).not.toHaveBeenCalled()
  })

  it('keeps part of the deposit with a reason, and records the rest as returned', async () => {
    seed({}, 0)

    const result = await closeOutPrivateBooking({
      bookingId: BOOKING,
      deposit: { outcome: 'kept', amount: 100, reason: 'Broken table', restMethod: 'card' },
      performedBy: 'user-1',
    })

    expect(result.depositStatus).toBe('partially_retained')
    expect(state.db.tables.payment_refunds[0]).toMatchObject({ amount: 150, refund_method: 'other' })
    expect(stored().deposit_refund_status).toBe('partially_retained')
  })

  it('puts the deposit against the bill as a payment, then settles the rest at the till', async () => {
    seed()
    state.db.tables.private_bookings_with_details[0].balance_remaining = 390

    await closeOutPrivateBooking({
      bookingId: BOOKING,
      balanceSettledAtTill: { method: 'card' },
      deposit: { outcome: 'applied' },
      performedBy: 'user-1',
    })

    expect(rpcCalls('record_balance_payment')).toEqual([
      { p_booking_id: BOOKING, p_amount: 250, p_method: 'cash', p_recorded_by: 'user-1' },
      { p_booking_id: BOOKING, p_amount: 390, p_method: 'card', p_recorded_by: 'user-1' },
    ])
    expect(stored().deposit_refund_status).toBe('applied')
  })

  it.each([
    ['before the event', { event_date: '2026-10-30' }, { deposit: { outcome: 'returned', method: 'cash' } }, 'on or after the day of the event'],
    ['without saying what happened to the deposit', {}, {}, 'Say what happened to the deposit'],
    ['keeping a deposit without a reason', {}, { deposit: { outcome: 'kept', amount: 250, reason: ' ' } }, 'record why the deposit was kept'],
  ])('refuses %s, and changes nothing', async (_label, overrides, input, message) => {
    seed(overrides)

    await expect(closeOutPrivateBooking({ bookingId: BOOKING, performedBy: 'user-1', ...(input as object) })).rejects.toThrow(message)
    expect(stored().status).toBe('confirmed')
    expect(state.db.rpc).not.toHaveBeenCalled()
  })
})
