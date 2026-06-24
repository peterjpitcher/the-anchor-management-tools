import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withApiAuth } from '@/lib/api/auth'
import {
  captureEventPayPalOrderByBookingId,
  createEventPayPalOrderByBookingId,
} from '@/lib/events/event-payments'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    (
      handler: (request: Request, apiKey: unknown) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) =>
      handler(request, {
        id: 'api-key-1',
        name: 'Website',
        permissions: ['payments:capture'],
        rate_limit: 100,
        is_active: true,
      })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}))

vi.mock('@/lib/events/event-payments', () => ({
  createEventPayPalOrderByBookingId: vi.fn(),
  captureEventPayPalOrderByBookingId: vi.fn(),
  sendEventPaymentConfirmationSms: vi.fn().mockResolvedValue(undefined),
  sendEventPaymentManualReviewSms: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendEventPaymentManualReviewEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('external event PayPal API scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires payments:capture for create-order', async () => {
    vi.mocked(createEventPayPalOrderByBookingId).mockResolvedValueOnce({
      state: 'created',
      orderId: 'ORDER-1',
      amount: 25,
      currency: 'GBP',
      holdExpiresAt: null,
    })

    const { POST } = await import('@/app/api/external/event-bookings/[id]/paypal/create-order/route')
    const request = new NextRequest('http://localhost/api/external/event-bookings/booking-1/paypal/create-order', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'booking-1' }) })

    expect(response.status).toBe(200)
    expect(withApiAuth).toHaveBeenCalledWith(expect.any(Function), ['payments:capture'], request)
  })

  it('requires payments:capture for capture-order', async () => {
    vi.mocked(captureEventPayPalOrderByBookingId).mockResolvedValueOnce({
      state: 'already_confirmed',
      amount: 25,
      currency: 'GBP',
      paymentId: 'payment-1',
    })

    const { POST } = await import('@/app/api/external/event-bookings/[id]/paypal/capture-order/route')
    const request = new NextRequest('http://localhost/api/external/event-bookings/booking-1/paypal/capture-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'ORDER-1' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'booking-1' }) })

    expect(response.status).toBe(200)
    expect(withApiAuth).toHaveBeenCalledWith(expect.any(Function), ['payments:capture'], request)
  })
})
