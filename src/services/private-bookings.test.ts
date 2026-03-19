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
import { getBookingPaymentHistory } from './private-bookings'

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
