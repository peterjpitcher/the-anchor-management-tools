import { beforeEach, describe, expect, it, vi } from 'vitest'

// env.ts reads the app URL once, when it is first imported, so it is set before any import. It
// differs from the request's own origin on purpose: redirects must use the configured app URL.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

import { NextRequest } from 'next/server'
import { POST } from './route'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}))

vi.mock('@/lib/parking/repository', () => ({
  getParkingBooking: vi.fn(),
}))

vi.mock('@/lib/parking/payments', () => ({
  createParkingPaymentOrder: vi.fn(),
}))

vi.mock('@/lib/parking/payment-due', () => ({
  isTopUpBooking: (booking: { status: string; payment_status: string }) =>
    booking.status === 'confirmed' && booking.payment_status === 'paid',
  enforcePendingPaymentRule: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { getParkingBooking } from '@/lib/parking/repository'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { enforcePendingPaymentRule } from '@/lib/parking/payment-due'

const futureDue = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const pastDue = new Date(Date.now() - 60 * 60 * 1000).toISOString()

const pendingBooking = {
  id: 'booking-123',
  reference: 'PAR-123',
  status: 'pending_payment',
  payment_status: 'pending',
  calculated_price: 25,
  override_price: null,
  payment_due_at: futureDue,
}

function makeRequest(bookingId = 'booking-123') {
  return new NextRequest('http://localhost/api/parking/payment/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ booking_id: bookingId }).toString(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/parking/payment/retry', () => {
  it('creates or reuses a PayPal order and redirects to approval', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(pendingBooking as any)
    vi.mocked(createParkingPaymentOrder).mockResolvedValue({
      payment: {} as any,
      orderId: 'ORDER-1',
      approveUrl: 'https://paypal.test/checkout?token=ORDER-1',
    })

    const response = await POST(makeRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://paypal.test/checkout?token=ORDER-1')
    expect(createParkingPaymentOrder).toHaveBeenCalledWith(
      pendingBooking,
      expect.objectContaining({
        returnUrl: 'https://management.orangejelly.co.uk/api/parking/payment/return?booking_id=booking-123',
        cancelUrl: 'https://management.orangejelly.co.uk/parking/guest/booking-123?payment=cancelled',
      }),
    )
  })

  it('redirects paid bookings back as success without creating a new order', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue({
      ...pendingBooking,
      status: 'confirmed',
      payment_status: 'paid',
    } as any)
    vi.mocked(enforcePendingPaymentRule).mockResolvedValue({ due: null } as any)

    const response = await POST(makeRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/booking-123?payment=success')
    expect(createParkingPaymentOrder).not.toHaveBeenCalled()
  })

  it('charges a confirmed booking its balance as a top-up, leaving the booking alone', async () => {
    const confirmed = { ...pendingBooking, status: 'confirmed', payment_status: 'paid', payment_due_at: pastDue }
    vi.mocked(getParkingBooking).mockResolvedValue(confirmed as any)
    vi.mocked(enforcePendingPaymentRule).mockResolvedValue({ due: { amount: 30, purpose: 'top_up' } } as any)
    vi.mocked(createParkingPaymentOrder).mockResolvedValue({ approveUrl: 'https://paypal.test/approve/topup' } as any)

    const response = await POST(makeRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://paypal.test/approve/topup')
    expect(vi.mocked(createParkingPaymentOrder).mock.calls[0][1]).toMatchObject({ amount: 30, purpose: 'top_up' })
  })

  it('refuses expired payment windows', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue({
      ...pendingBooking,
      payment_due_at: pastDue,
    } as any)

    const response = await POST(makeRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/booking-123?payment=expired')
    expect(createParkingPaymentOrder).not.toHaveBeenCalled()
  })

  it('redirects missing bookings to a visible failure state', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(null)

    const response = await POST(makeRequest('missing-booking'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/missing-booking?payment=not_found')
  })

  it('redirects requests without a booking id to a branded payment error page', async () => {
    const response = await POST(makeRequest(''))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/payment-error?reason=missing_parameters')
    expect(getParkingBooking).not.toHaveBeenCalled()
    expect(createParkingPaymentOrder).not.toHaveBeenCalled()
  })
})
