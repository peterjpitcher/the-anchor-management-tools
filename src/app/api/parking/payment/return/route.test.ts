import { beforeEach, describe, expect, it, vi } from 'vitest'

// env.ts reads the app URL once, when it is first imported, so it is set before any import. It
// differs from the request's own origin on purpose: redirects must use the configured app URL.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

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
  ParkingTopUpAmountChangedError: class ParkingTopUpAmountChangedError extends Error {},
}))

import { getParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment, ParkingTopUpAmountChangedError } from '@/lib/parking/payments'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFakeDb } from '../../../../../../tests/helpers/fakeSupabaseDb'

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
})

describe('GET /api/parking/payment/return', () => {
  it('redirects missing booking ids to a branded payment error page without capture', async () => {
    const response = await GET(makeRequest('?token=ORDER-1'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/payment-error?reason=missing_parameters')
    expect(getParkingBooking).not.toHaveBeenCalled()
    expect(captureParkingPayment).not.toHaveBeenCalled()
  })

  it('redirects missing paypal tokens back to the booking without capture', async () => {
    const response = await GET(makeRequest('?booking_id=booking-123'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/booking-123?payment=missing_parameters')
    expect(getParkingBooking).not.toHaveBeenCalled()
    expect(captureParkingPayment).not.toHaveBeenCalled()
  })

  it('redirects unknown bookings to a branded payment error page', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(null)

    const response = await GET(makeRequest('?booking_id=missing-booking&token=ORDER-1'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://management.orangejelly.co.uk/parking/payment-error?reason=not_found&booking_id=missing-booking',
    )
    expect(captureParkingPayment).not.toHaveBeenCalled()
  })

  it('captures matched parking payments and returns to the guest booking', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(booking as any)
    vi.mocked(captureParkingPayment).mockResolvedValue({ ...booking, status: 'confirmed', payment_status: 'paid' } as any)

    const response = await GET(makeRequest('?booking_id=booking-123&token=ORDER-1'))

    expect(captureParkingPayment).toHaveBeenCalledWith(booking, 'ORDER-1', expect.objectContaining({ client: expect.anything() }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/booking-123?payment=success')
  })

  describe('a confirmed booking taking a top-up', () => {
    const confirmed = { id: 'booking-123', status: 'confirmed', payment_status: 'paid' }

    function withPayments(rows: Record<string, unknown>[]) {
      const db = createFakeDb({ parking_booking_payments: rows })
      vi.mocked(createAdminClient).mockReturnValue(db.client as never)
    }

    it('captures a pending top-up instead of short-circuiting to success', async () => {
      withPayments([{ id: 'pay-topup', booking_id: 'booking-123', paypal_order_id: 'ORDER-TOPUP', status: 'pending' }])
      vi.mocked(getParkingBooking).mockResolvedValue(confirmed as never)

      const response = await GET(makeRequest('?booking_id=booking-123&token=ORDER-TOPUP'))

      expect(captureParkingPayment).toHaveBeenCalledTimes(1)
      expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/booking-123?payment=success')
    })

    it('sends the customer to what is owed now when the link was retired', async () => {
      withPayments([{ id: 'pay-topup', booking_id: 'booking-123', paypal_order_id: 'ORDER-TOPUP', status: 'expired' }])
      vi.mocked(getParkingBooking).mockResolvedValue(confirmed as never)

      const response = await GET(makeRequest('?booking_id=booking-123&token=ORDER-TOPUP'))

      expect(captureParkingPayment).not.toHaveBeenCalled()
      expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/booking-123?payment=amount_changed')
    })

    it('maps a capture refused for a changed amount to the same notice', async () => {
      withPayments([{ id: 'pay-topup', booking_id: 'booking-123', paypal_order_id: 'ORDER-TOPUP', status: 'pending' }])
      vi.mocked(getParkingBooking).mockResolvedValue(confirmed as never)
      vi.mocked(captureParkingPayment).mockRejectedValue(new ParkingTopUpAmountChangedError())

      const response = await GET(makeRequest('?booking_id=booking-123&token=ORDER-TOPUP'))

      expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/parking/guest/booking-123?payment=amount_changed')
    })
  })
})
