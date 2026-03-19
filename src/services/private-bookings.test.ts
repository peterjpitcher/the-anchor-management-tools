import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/dateUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateUtils')>()
  return {
    ...actual,
    // toLocalIsoDate receives a Date object
    toLocalIsoDate: vi.fn((d: Date) => d.toISOString().split('T')[0]),
  }
})

import { createAdminClient } from '@/lib/supabase/admin'
import {
  getBookingPaymentHistory,
  updateBalancePayment,
  deleteBalancePayment,
  updateDeposit,
  deleteDeposit,
} from './private-bookings'

type MockAdminClientOptions = {
  booking: Record<string, unknown> | null
  paymentsError?: boolean
  payments: Record<string, unknown>[]
}

function mockAdminClient({ booking, payments, paymentsError = false }: MockAdminClientOptions) {
  ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'private_bookings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: booking, error: null }),
        }
      }
      if (table === 'private_booking_payments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: paymentsError ? null : payments,
            error: paymentsError ? { message: 'db error' } : null,
          }),
        }
      }
      return {}
    }),
  })
}

describe('getBookingPaymentHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no deposit paid and no balance payments', async () => {
    mockAdminClient({
      booking: { deposit_paid_date: null, deposit_amount: 100, deposit_payment_method: 'cash' },
      payments: [],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result).toEqual([])
  })

  it('includes deposit entry when deposit_paid_date is set', async () => {
    mockAdminClient({
      booking: {
        deposit_paid_date: '2024-01-10T10:00:00Z',
        deposit_amount: 250,
        deposit_payment_method: 'card',
      },
      payments: [],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'deposit',
      type: 'deposit',
      amount: 250,
      method: 'card',
      date: '2024-01-10',
    })
  })

  it('includes balance payment entries', async () => {
    mockAdminClient({
      booking: { deposit_paid_date: null },
      payments: [{ id: 'uuid-1', amount: 500, method: 'cash', created_at: '2024-02-01T09:00:00Z' }],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'uuid-1', type: 'balance', amount: 500, method: 'cash', date: '2024-02-01' })
  })

  it('sorts deposit before balance on the same date', async () => {
    mockAdminClient({
      booking: { deposit_paid_date: '2024-01-10T11:00:00Z', deposit_amount: 100, deposit_payment_method: 'cash' },
      payments: [{ id: 'uuid-1', amount: 200, method: 'card', created_at: '2024-01-10T09:00:00Z' }],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result[0].type).toBe('deposit')
    expect(result[1].type).toBe('balance')
  })

  it('sorts older dates first', async () => {
    mockAdminClient({
      booking: { deposit_paid_date: '2024-01-15T10:00:00Z', deposit_amount: 100, deposit_payment_method: 'cash' },
      payments: [{ id: 'uuid-1', amount: 200, method: 'card', created_at: '2024-01-05T10:00:00Z' }],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result[0].type).toBe('balance')   // Jan 5 before Jan 15
    expect(result[1].type).toBe('deposit')
  })

  it('throws if fetching balance payments fails', async () => {
    mockAdminClient({ booking: { deposit_paid_date: null }, payments: [], paymentsError: true })
    await expect(getBookingPaymentHistory('booking-id')).rejects.toThrow()
  })
})

describe('updateBalancePayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws if payment not found for booking', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      })),
    })
    await expect(updateBalancePayment('uuid-1', 'booking-id', { amount: 300, method: 'cash' })).rejects.toThrow()
  })

  it('calls RPC after successful update', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    let callIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => {
        callIndex++
        if (callIndex === 1) {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }) }
        }
        return { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ count: 1, error: null }) }
      }),
      rpc: rpcMock,
    })
    await updateBalancePayment('uuid-1', 'booking-id', { amount: 300, method: 'cash' })
    expect(rpcMock).toHaveBeenCalledWith('apply_balance_payment_status', { p_booking_id: 'booking-id' })
  })
})

describe('deleteBalancePayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws if payment not found', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) })),
    })
    await expect(deleteBalancePayment('uuid-1', 'booking-id')).rejects.toThrow()
  })

  it('calls RPC after successful delete', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    let callIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => {
        callIndex++
        if (callIndex === 1) return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }) }
        return { delete: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ count: 1, error: null }) }
      }),
      rpc: rpcMock,
    })
    await deleteBalancePayment('uuid-1', 'booking-id')
    expect(rpcMock).toHaveBeenCalledWith('apply_balance_payment_status', { p_booking_id: 'booking-id' })
  })
})

describe('updateDeposit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates deposit fields without calling RPC', async () => {
    const rpcMock = vi.fn()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) })),
      rpc: rpcMock,
    })
    await updateDeposit('booking-id', { amount: 150, method: 'card' })
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('deleteDeposit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws if booking not found', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) })),
    })
    await expect(deleteDeposit('booking-id')).rejects.toThrow()
  })

  it('returns statusReverted=false for completed booking', async () => {
    let updateCallIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          updateCallIndex++
          if (updateCallIndex === 1) return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { status: 'completed', deposit_paid_date: '2024-01-10T10:00:00Z', deposit_amount: 100, deposit_payment_method: 'cash' }, error: null }) }
          return { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) }
        }
        return {}
      }),
    })
    const result = await deleteDeposit('booking-id')
    expect(result.statusReverted).toBe(false)
  })

  it('returns statusReverted=true when confirmed with no balance payments', async () => {
    let bookingCallIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          bookingCallIndex++
          if (bookingCallIndex === 1) return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { status: 'confirmed', deposit_paid_date: '2024-01-10T10:00:00Z', deposit_amount: 100, deposit_payment_method: 'cash' }, error: null }) }
          return { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: {}, error: null }) }
        }
        if (table === 'private_booking_payments') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, count: 0, error: null }) }
        }
        return {}
      }),
    })
    const result = await deleteDeposit('booking-id')
    expect(result.statusReverted).toBe(true)
  })
})
