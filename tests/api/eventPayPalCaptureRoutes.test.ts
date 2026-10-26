import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Both routes that capture an event ticket payment (the website's, by booking id, and the guest
 * payment link's, by token) tell the guest exactly once, and answer 202 when staff need to
 * look. BK-124, customer bookings review of 24 October 2026.
 */

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    (handler: (request: Request, apiKey: unknown) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request, { id: 'api-key-1', name: 'Website', permissions: ['payments:capture'], rate_limit: 100, is_active: true }),
  ),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ from: vi.fn() })) }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/events/event-payments', () => ({
  captureEventPayPalOrderByBookingId: vi.fn(),
  captureEventPayPalOrderByRawToken: vi.fn(),
  sendEventPaymentConfirmationSms: vi.fn().mockResolvedValue({ success: true }),
  sendEventPaymentManualReviewSms: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/events/payment-alerts', () => ({ alertEventPaymentNeedsAPerson: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendEventPaymentManualReviewEmail: vi.fn().mockResolvedValue(undefined),
}))

import {
  captureEventPayPalOrderByBookingId,
  captureEventPayPalOrderByRawToken,
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import { sendEventPaymentConfirmationEmail, sendEventPaymentManualReviewEmail } from '@/lib/email/event-ticket-emails'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
import { POST as externalCapture } from '@/app/api/external/event-bookings/[id]/paypal/capture-order/route'
import { POST as guestCapture } from '@/app/g/[token]/event-payment/paypal/capture-order/route'

const BOOKING = 'booking-1'

function request(url: string) {
  return new NextRequest(url, { method: 'POST', body: JSON.stringify({ orderId: 'ORDER-1' }), headers: { 'content-type': 'application/json' } })
}

const routes = [
  {
    name: 'website capture route',
    capture: captureEventPayPalOrderByBookingId,
    call: () => externalCapture(request(`http://localhost/api/external/event-bookings/${BOOKING}/paypal/capture-order`), { params: Promise.resolve({ id: BOOKING }) }),
  },
  {
    name: 'guest payment link capture route',
    capture: captureEventPayPalOrderByRawToken,
    call: () => guestCapture(request('http://localhost/g/raw-token/event-payment/paypal/capture-order'), { params: Promise.resolve({ token: 'raw-token' }) }),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(routes)('$name', ({ capture, call }) => {
  it('sends one confirmation text and one confirmation email for a new confirmation', async () => {
    vi.mocked(capture).mockResolvedValueOnce({ state: 'confirmed', bookingId: BOOKING, amount: 80, currency: 'GBP', paymentId: 'payment-1' })

    const response = await call()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, state: 'confirmed', booking_id: BOOKING })
    expect(sendEventPaymentConfirmationSms).toHaveBeenCalledTimes(1)
    expect(sendEventPaymentConfirmationEmail).toHaveBeenCalledTimes(1)
    expect(sendEventPaymentManualReviewSms).not.toHaveBeenCalled()
    expect(sendEventPaymentManualReviewEmail).not.toHaveBeenCalled()
    expect(alertEventPaymentNeedsAPerson).not.toHaveBeenCalled()
  })

  it('sends no second text for a payment that was already confirmed', async () => {
    vi.mocked(capture).mockResolvedValueOnce({ state: 'already_confirmed', bookingId: BOOKING, amount: 80, currency: 'GBP', paymentId: 'payment-1' })

    const response = await call()

    expect(response.status).toBe(200)
    expect(sendEventPaymentConfirmationSms).not.toHaveBeenCalled()
    expect(sendEventPaymentConfirmationEmail).toHaveBeenCalledTimes(1)
  })

  it('answers 202 and sends one manual review text and email when staff need to check', async () => {
    vi.mocked(capture).mockResolvedValueOnce({ state: 'manual_review', bookingId: BOOKING, amount: 80, currency: 'GBP', paymentId: 'payment-1', reason: 'capacity_unavailable_after_capture' })

    const response = await call()

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ success: false, state: 'manual_review', booking_id: BOOKING })
    expect(sendEventPaymentManualReviewSms).toHaveBeenCalledTimes(1)
    expect(sendEventPaymentManualReviewEmail).toHaveBeenCalledTimes(1)
    expect(sendEventPaymentConfirmationSms).not.toHaveBeenCalled()
    expect(sendEventPaymentConfirmationEmail).not.toHaveBeenCalled()
    // BK-018: the guest is told staff will check the booking, so a manager is told, once.
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: BOOKING,
      kind: 'manual_review',
      reason: 'capacity_unavailable_after_capture',
      amount: 80,
    }))
  })

  // BK-019: PayPal holding the payment is not a confirmation, and not yet a message to the guest.
  it('answers 202, confirms nothing and messages no guest while PayPal holds the payment, and tells a manager', async () => {
    vi.mocked(capture).mockResolvedValueOnce({ state: 'capture_pending', bookingId: BOOKING, amount: 80, currency: 'GBP', paymentId: 'payment-1', reason: 'capture_pending' })

    const response = await call()

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ success: false, state: 'capture_pending', booking_id: BOOKING })
    expect(sendEventPaymentConfirmationSms).not.toHaveBeenCalled()
    expect(sendEventPaymentConfirmationEmail).not.toHaveBeenCalled()
    expect(sendEventPaymentManualReviewSms).not.toHaveBeenCalled()
    expect(sendEventPaymentManualReviewEmail).not.toHaveBeenCalled()
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookingId: BOOKING, kind: 'capture_pending' }))
  })
})
