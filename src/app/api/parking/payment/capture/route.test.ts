import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/parking/repository', () => ({
  getParkingBooking: vi.fn(),
}))

vi.mock('@/lib/parking/payments', () => ({
  captureParkingPayment: vi.fn(),
}))

vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn((handler: (req: Request, apiKey: { id: string }) => Promise<Response>, _scopes: string[], req: Request) => handler(req, { id: 'test-key' })),
  }
})

import { getParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment } from '@/lib/parking/payments'

const mockBookingPending = {
  id: 'booking-123',
  reference: 'PAR-20260311-0001',
  status: 'pending_payment',
  payment_status: 'pending',
  calculated_price: 105,
  override_price: null,
}

const mockBookingConfirmed = {
  ...mockBookingPending,
  status: 'confirmed',
  payment_status: 'paid',
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/parking/payment/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/parking/payment/capture', () => {
  it('should capture payment and return confirmed booking', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(mockBookingPending as any)
    vi.mocked(captureParkingPayment).mockResolvedValue(mockBookingConfirmed as any)

    const res = await POST(makeRequest({ order_id: 'PAYPAL-ORDER-1', booking_id: 'booking-123' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.booking_id).toBe('booking-123')
    expect(body.data.reference).toBe('PAR-20260311-0001')
    expect(captureParkingPayment).toHaveBeenCalledWith(
      mockBookingPending,
      'PAYPAL-ORDER-1',
      expect.objectContaining({ client: expect.anything() })
    )
  })

  it('should return 200 idempotently if booking already confirmed', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(mockBookingConfirmed as any)

    const res = await POST(makeRequest({ order_id: 'PAYPAL-ORDER-1', booking_id: 'booking-123' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(captureParkingPayment).not.toHaveBeenCalled()
    expect(body.data.booking_id).toBe('booking-123')
  })

  it('should return 400 when booking_id or order_id are missing', async () => {
    const res = await POST(makeRequest({ order_id: 'PAYPAL-ORDER-1' }))
    expect(res.status).toBe(400)
  })

  it('should return 404 when booking is not found', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(null)
    const res = await POST(makeRequest({ order_id: 'PAYPAL-ORDER-1', booking_id: 'missing' }))
    expect(res.status).toBe(404)
  })

  it('should return 400 when booking is cancelled or expired', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue({ ...mockBookingPending, status: 'cancelled' } as any)
    const res = await POST(makeRequest({ order_id: 'PAYPAL-ORDER-1', booking_id: 'booking-123' }))
    expect(res.status).toBe(400)
  })

  it('should return 502 when PayPal capture throws', async () => {
    vi.mocked(getParkingBooking).mockResolvedValue(mockBookingPending as any)
    vi.mocked(captureParkingPayment).mockRejectedValue(new Error('PayPal error'))
    const res = await POST(makeRequest({ order_id: 'PAYPAL-ORDER-1', booking_id: 'booking-123' }))
    expect(res.status).toBe(502)
  })
})
