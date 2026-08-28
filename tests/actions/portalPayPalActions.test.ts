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

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(() => 'capture-hash'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
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

import {
  captureDepositPaymentByToken,
  createDepositPaymentOrderByToken,
} from '@/app/actions/portalPayPalActions'
import { createAdminClient } from '@/lib/supabase/admin'
import { capturePayPalPayment, createSimplePayPalOrder, getPayPalOrder } from '@/lib/paypal'
import { verifyBookingToken } from '@/lib/private-bookings/booking-token'
import { finalizeDepositPayment } from '@/services/private-bookings'
import {
  claimIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedCapturePayPalPayment = capturePayPalPayment as unknown as Mock
const mockedCreateSimplePayPalOrder = createSimplePayPalOrder as unknown as Mock
const mockedGetPayPalOrder = getPayPalOrder as unknown as Mock
const mockedVerifyBookingToken = verifyBookingToken as unknown as Mock
const mockedFinalizeDepositPayment = finalizeDepositPayment as unknown as Mock
const mockedClaimIdempotencyKey = claimIdempotencyKey as unknown as Mock
const mockedPersistIdempotencyResponse = persistIdempotencyResponse as unknown as Mock
const mockedReleaseIdempotencyClaim = releaseIdempotencyClaim as unknown as Mock

function mockAdminForFreshOrder(overrides: Record<string, unknown> = {}) {
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
              paypal_deposit_order_id: null,
              status: 'draft',
              event_date: '2026-08-15',
              event_type: 'Birthday',
              updated_at: '2026-08-28T10:00:00.000Z',
              ...overrides,
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

function mockAdminForCapture(overrides: Record<string, unknown> = {}) {
  const auditInsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'private_bookings') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'booking-1',
            deposit_amount: 250,
            deposit_paid_date: null,
            paypal_deposit_order_id: 'ORDER-NEW',
            status: 'draft',
            ...overrides,
          },
          error: null,
        }),
      }
    }

    if (table === 'audit_logs') {
      return { insert: auditInsert }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  const admin = { from }
  mockedCreateAdminClient.mockReturnValue(admin)
  return { admin, auditInsert }
}

function payPalOrderForBooking(bookingId = 'booking-1') {
  return {
    id: 'ORDER-OLD',
    status: 'APPROVED',
    purchase_units: [{
      reference_id: bookingId,
      custom_id: `pb-deposit-${bookingId}`,
      amount: { value: '250.00', currency_code: 'GBP' },
    }],
    links: [{ rel: 'payer-action', href: 'https://paypal.test/checkout?token=ORDER-OLD' }],
  }
}

describe('portalPayPalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.com'
    mockedClaimIdempotencyKey.mockResolvedValue({ state: 'claimed' })
    mockedPersistIdempotencyResponse.mockResolvedValue(undefined)
    mockedReleaseIdempotencyClaim.mockResolvedValue(undefined)
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

  it('reuses the current valid order instead of replacing its reference', async () => {
    mockedVerifyBookingToken.mockReturnValue('booking-1')
    const { update } = mockAdminForFreshOrder({ paypal_deposit_order_id: 'ORDER-EXISTING' })
    mockedGetPayPalOrder.mockResolvedValue({
      ...payPalOrderForBooking(),
      id: 'ORDER-EXISTING',
      status: 'PAYER_ACTION_REQUIRED',
      links: [{ rel: 'payer-action', href: 'https://paypal.test/checkout?token=ORDER-EXISTING' }],
    })

    const result = await createDepositPaymentOrderByToken('portal-token')

    expect(result).toEqual({
      success: true,
      approveUrl: 'https://paypal.test/checkout?token=ORDER-EXISTING',
    })
    expect(mockedCreateSimplePayPalOrder).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('captures an older valid order when PayPal confirms it belongs to the booking', async () => {
    mockedVerifyBookingToken.mockReturnValue('booking-1')
    const { admin } = mockAdminForCapture()
    mockedGetPayPalOrder.mockResolvedValue(payPalOrderForBooking())
    mockedCapturePayPalPayment.mockResolvedValue({
      amount: '250.00',
      currency: 'GBP',
      transactionId: 'CAPTURE-1',
    })
    mockedFinalizeDepositPayment.mockResolvedValue({ alreadyRecorded: false })

    const result = await captureDepositPaymentByToken('portal-token', 'ORDER-OLD')

    expect(result).toEqual({ success: true })
    expect(mockedClaimIdempotencyKey).toHaveBeenCalledWith(
      admin,
      'private-booking-deposit-capture:booking-1',
      'capture-hash',
    )
    expect(mockedCapturePayPalPayment).toHaveBeenCalledWith('ORDER-OLD', 'GBP')
    expect(mockedFinalizeDepositPayment).toHaveBeenCalledWith(
      {
        bookingId: 'booking-1',
        amount: 250,
        method: 'paypal',
        paypalCaptureId: 'CAPTURE-1',
      },
      admin,
    )
    expect(mockedPersistIdempotencyResponse).toHaveBeenLastCalledWith(
      admin,
      'private-booking-deposit-capture:booking-1',
      'capture-hash',
      { success: true },
    )
  })

  it('rejects an order that PayPal says belongs to another booking', async () => {
    mockedVerifyBookingToken.mockReturnValue('booking-1')
    mockAdminForCapture()
    mockedGetPayPalOrder.mockResolvedValue(payPalOrderForBooking('booking-2'))

    const result = await captureDepositPaymentByToken('portal-token', 'ORDER-OTHER')

    expect(result).toEqual({ error: 'Payment reference does not match this booking' })
    expect(mockedClaimIdempotencyKey).not.toHaveBeenCalled()
    expect(mockedCapturePayPalPayment).not.toHaveBeenCalled()
  })

  it('does not capture a second order while confirmation is in progress', async () => {
    mockedVerifyBookingToken.mockReturnValue('booking-1')
    mockAdminForCapture()
    mockedGetPayPalOrder.mockResolvedValue(payPalOrderForBooking())
    mockedClaimIdempotencyKey.mockResolvedValue({ state: 'in_progress' })

    const result = await captureDepositPaymentByToken('portal-token', 'ORDER-OLD')

    expect(result).toEqual({ error: 'Your payment is already being confirmed. Please wait a moment.' })
    expect(mockedCapturePayPalPayment).not.toHaveBeenCalled()
  })

  it('releases the capture claim when PayPal has not taken payment', async () => {
    mockedVerifyBookingToken.mockReturnValue('booking-1')
    const { admin } = mockAdminForCapture()
    mockedGetPayPalOrder.mockResolvedValue(payPalOrderForBooking())
    mockedCapturePayPalPayment.mockRejectedValue(new Error('PayPal unavailable'))

    const result = await captureDepositPaymentByToken('portal-token', 'ORDER-OLD')

    expect(result).toEqual({ error: 'We could not process your payment. Please contact us for assistance.' })
    expect(mockedReleaseIdempotencyClaim).toHaveBeenCalledWith(
      admin,
      'private-booking-deposit-capture:booking-1',
      'capture-hash',
    )
  })
})
