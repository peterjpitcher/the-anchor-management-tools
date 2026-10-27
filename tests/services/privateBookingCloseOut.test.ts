import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-062 and BK-131 (customer bookings review, 24 October 2026); owner decision D27: nothing
 * recorded what happened to a hire's deposit, or that its balance was paid, and nothing closed the
 * booking. The close-out records the balance settled at the till, the deposit's outcome and closes
 * the hire, sending the guest nothing.
 *
 * Review of release 13: the close-out ran as separate writes, so a failure part-way left a deposit
 * applied to the bill with the booking still showing it open, and a retry applied it twice. It is
 * now one database call, close_out_private_booking, which does every part in one transaction.
 * What the function itself does (locking, refusals, a completed booking, a repeat call) is proved
 * against Postgres in scripts/testing/private-hire-close-out-atomic-postgres.py.
 */

const state = vi.hoisted(() => ({
  rpc: null as unknown as ReturnType<typeof vi.fn>,
  from: null as unknown as ReturnType<typeof vi.fn>,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ rpc: state.rpc, from: state.from })) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/private-bookings/messenger', () => ({ sendPrivateBookingMessage: vi.fn() }))

import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { closeOutPrivateBooking } from '@/services/private-bookings/close-out'

const BOOKING = 'booking-1'

beforeEach(() => {
  vi.clearAllMocks()
  state.rpc = vi.fn(async () => ({ data: [{ balance_recorded: 640, deposit_status: 'refunded', deposit_handled: 250 }], error: null }))
  state.from = vi.fn(() => {
    throw new Error('the close-out must not write table by table')
  })
})

describe('closing out a private hire', () => {
  it('does the whole close-out in one database call, and sends nothing', async () => {
    const result = await closeOutPrivateBooking({
      bookingId: BOOKING,
      balanceSettledAtTill: { method: 'card' },
      deposit: { outcome: 'returned', method: 'cash' },
      performedBy: 'user-1',
    })

    expect(result).toEqual({ balanceRecorded: 640, depositStatus: 'refunded', completed: true })
    expect(state.rpc).toHaveBeenCalledTimes(1)
    expect(state.rpc).toHaveBeenCalledWith('close_out_private_booking', {
      p_booking_id: BOOKING,
      p_balance_method: 'card',
      p_deposit_outcome: 'returned',
      p_deposit_method: 'cash',
      p_kept_amount: null,
      p_kept_reason: null,
      p_performed_by: 'user-1',
    })
    expect(state.from).not.toHaveBeenCalled()
    expect(sendPrivateBookingMessage).not.toHaveBeenCalled()
  })

  it('passes a kept deposit with its reason and how the rest went back', async () => {
    state.rpc.mockResolvedValueOnce({ data: [{ balance_recorded: 0, deposit_status: 'partially_retained', deposit_handled: 250 }], error: null })

    const result = await closeOutPrivateBooking({
      bookingId: BOOKING,
      deposit: { outcome: 'kept', amount: 100, reason: ' Broken table ', restMethod: 'card' },
      performedBy: 'user-1',
    })

    expect(result.depositStatus).toBe('partially_retained')
    expect(state.rpc).toHaveBeenCalledWith('close_out_private_booking', expect.objectContaining({
      p_balance_method: null,
      p_deposit_outcome: 'kept',
      p_deposit_method: 'card',
      p_kept_amount: 100,
      p_kept_reason: 'Broken table',
    }))
  })

  it('passes a deposit put against the bill with no method of its own', async () => {
    await closeOutPrivateBooking({
      bookingId: BOOKING,
      balanceSettledAtTill: { method: 'cash' },
      deposit: { outcome: 'applied' },
      performedBy: 'user-1',
    })

    expect(state.rpc).toHaveBeenCalledWith('close_out_private_booking', expect.objectContaining({
      p_balance_method: 'cash',
      p_deposit_outcome: 'applied',
      p_deposit_method: null,
    }))
  })

  it('shows staff the reason the database refused, in plain words', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'close_out: This booking has no deposit left to close' } })

    await expect(closeOutPrivateBooking({ bookingId: BOOKING, deposit: { outcome: 'applied' }, performedBy: 'user-1' }))
      .rejects.toThrow(/^This booking has no deposit left to close$/)
  })

  it('says nothing was recorded when the call fails for any other reason', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'canceling statement due to statement timeout' } })

    await expect(closeOutPrivateBooking({ bookingId: BOOKING, deposit: { outcome: 'applied' }, performedBy: 'user-1' }))
      .rejects.toThrow('nothing was recorded')
  })

  it('refuses a kept deposit with no reason before calling the database', async () => {
    await expect(closeOutPrivateBooking({
      bookingId: BOOKING,
      deposit: { outcome: 'kept', amount: 250, reason: ' ' },
      performedBy: 'user-1',
    })).rejects.toThrow('record why the deposit was kept')
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
