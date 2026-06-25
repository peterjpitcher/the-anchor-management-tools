import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { getParkingBooking } from '@/lib/parking/repository'
import { createParkingPaymentOrder } from '@/lib/parking/payments'

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
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost'
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
        returnUrl: 'http://localhost/api/parking/payment/return?booking_id=booking-123',
        cancelUrl: 'http://localhost/parking/guest/booking-123?payment=cancelled',
      }),
    )
  })

  it('redirects paid bookings back as success without creating a new order', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue({
      ...pendingBooking,
      status: 'confirmed',
      payment_status: 'paid',
    } as any)

    const response = await POST(makeRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/parking/guest/booking-123?payment=success')
    expect(createParkingPaymentOrder).not.toHaveBeenCalled()
  })

  it('refuses expired payment windows', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue({
      ...pendingBooking,
      payment_due_at: pastDue,
    } as any)

    const response = await POST(makeRequest())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/parking/guest/booking-123?payment=expired')
    expect(createParkingPaymentOrder).not.toHaveBeenCalled()
  })

  it('redirects missing bookings to a visible failure state', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(null)

    const response = await POST(makeRequest('missing-booking'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/parking/guest/missing-booking?payment=not_found')
  })

  it('redirects requests without a booking id to a branded payment error page', async () => {
    const response = await POST(makeRequest(''))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/parking/payment-error?reason=missing_parameters')
    expect(getParkingBooking).not.toHaveBeenCalled()
    expect(createParkingPaymentOrder).not.toHaveBeenCalled()
  })
})
