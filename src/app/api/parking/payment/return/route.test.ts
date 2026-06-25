import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}))

vi.mock('@/lib/parking/repository', () => ({
  getParkingBooking: vi.fn(),
}))

vi.mock('@/lib/parking/payments', () => ({
  captureParkingPayment: vi.fn(),
}))

import { getParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment } from '@/lib/parking/payments'

const booking = {
  id: 'booking-123',
  status: 'pending_payment',
  payment_status: 'pending',
}

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/parking/payment/return${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost'
})

describe('GET /api/parking/payment/return', () => {
  it('redirects missing booking ids to a branded payment error page without capture', async () => {
    const response = await GET(makeRequest('?token=ORDER-1'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/parking/payment-error?reason=missing_parameters')
    expect(getParkingBooking).not.toHaveBeenCalled()
    expect(captureParkingPayment).not.toHaveBeenCalled()
  })

  it('redirects missing paypal tokens back to the booking without capture', async () => {
    const response = await GET(makeRequest('?booking_id=booking-123'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/parking/guest/booking-123?payment=missing_parameters')
    expect(getParkingBooking).not.toHaveBeenCalled()
    expect(captureParkingPayment).not.toHaveBeenCalled()
  })

  it('redirects unknown bookings to a branded payment error page', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(null)

    const response = await GET(makeRequest('?booking_id=missing-booking&token=ORDER-1'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'http://localhost/parking/payment-error?reason=not_found&booking_id=missing-booking',
    )
    expect(captureParkingPayment).not.toHaveBeenCalled()
  })

  it('captures matched parking payments and returns to the guest booking', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(booking as any)
    vi.mocked(captureParkingPayment).mockResolvedValue({ ...booking, status: 'confirmed', payment_status: 'paid' } as any)

    const response = await GET(makeRequest('?booking_id=booking-123&token=ORDER-1'))

    expect(captureParkingPayment).toHaveBeenCalledWith(booking, 'ORDER-1', expect.objectContaining({ client: expect.anything() }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/parking/guest/booking-123?payment=success')
  })
})
