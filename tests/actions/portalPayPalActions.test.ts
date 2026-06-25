import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  capturePayPalPayment: vi.fn(),
  createSimplePayPalOrder: vi.fn(),
  getPayPalOrder: vi.fn(),
}))

vi.mock('@/lib/private-bookings/booking-token', () => ({
  verifyBookingToken: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/services/private-bookings', () => ({
  finalizeDepositPayment: vi.fn(),
}))

import { createDepositPaymentOrderByToken } from '@/app/actions/portalPayPalActions'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSimplePayPalOrder } from '@/lib/paypal'
import { verifyBookingToken } from '@/lib/private-bookings/booking-token'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedCreateSimplePayPalOrder = createSimplePayPalOrder as unknown as Mock
const mockedVerifyBookingToken = verifyBookingToken as unknown as Mock

function mockAdminForFreshOrder() {
  let privateBookingCall = 0
  const update = vi.fn().mockReturnThis()

  const from = vi.fn((table: string) => {
    if (table === 'private_bookings') {
      privateBookingCall += 1

      if (privateBookingCall === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'booking-1',
              deposit_amount: 250,
              deposit_paid_date: null,
              status: 'draft',
              event_date: '2026-08-15',
              event_type: 'Birthday',
            },
            error: null,
          }),
        }
      }

      return {
        update,
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'booking-1' }, error: null }),
      }
    }

    if (table === 'audit_logs') {
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  mockedCreateAdminClient.mockReturnValue({ from })
  return { from, update }
}

describe('portalPayPalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.com'
  })

  it('rejects invalid booking portal tokens', async () => {
    mockedVerifyBookingToken.mockReturnValue(null)

    const result = await createDepositPaymentOrderByToken('bad-token')

    expect(result).toEqual({ error: 'Invalid booking link' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
    expect(mockedCreateSimplePayPalOrder).not.toHaveBeenCalled()
  })

  it('creates and persists a fresh PayPal order for a valid outstanding deposit', async () => {
    mockedVerifyBookingToken.mockReturnValue('booking-1')
    const { update } = mockAdminForFreshOrder()
    mockedCreateSimplePayPalOrder.mockResolvedValue({
      orderId: 'ORDER-123',
      approveUrl: 'https://paypal.test/checkout?token=ORDER-123',
    })

    const result = await createDepositPaymentOrderByToken('portal-token')

    expect(result).toEqual({
      success: true,
      approveUrl: 'https://paypal.test/checkout?token=ORDER-123',
    })
    expect(mockedCreateSimplePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 250,
        brandName: 'The Anchor',
        cancelUrl: 'https://management.example.com/booking-portal/portal-token',
        customId: 'pb-deposit-booking-1',
        returnUrl: 'https://management.example.com/booking-portal/portal-token?payment_pending=1',
      })
    )
    expect(update).toHaveBeenCalledWith({
      paypal_deposit_order_id: 'ORDER-123',
      updated_at: expect.any(String),
    })
  })
})
