import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkGuestTokenThrottle: vi.fn(),
  getEventManagePreviewByRawToken: vi.fn(),
  cancelEventBookingByRawToken: vi.fn(),
  createSeatIncreaseCheckoutByManageToken: vi.fn(),
  getEventRefundPolicy: vi.fn(),
  processEventRefund: vi.fn(),
  updateEventBookingSeatsByRawToken: vi.fn(),
  recordAnalyticsEvent: vi.fn(),
  syncPubOpsEventCalendarByBookingId: vi.fn(),
  syncPubOpsEventCalendarByEventId: vi.fn(),
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: mocks.checkGuestTokenThrottle,
}))

vi.mock('@/lib/events/manage-booking', () => ({
  getEventManagePreviewByRawToken: mocks.getEventManagePreviewByRawToken,
  cancelEventBookingByRawToken: mocks.cancelEventBookingByRawToken,
  createSeatIncreaseCheckoutByManageToken: mocks.createSeatIncreaseCheckoutByManageToken,
  getEventRefundPolicy: mocks.getEventRefundPolicy,
  processEventRefund: mocks.processEventRefund,
  updateEventBookingSeatsByRawToken: mocks.updateEventBookingSeatsByRawToken,
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: mocks.recordAnalyticsEvent,
}))

vi.mock('@/lib/google-calendar-events', () => ({
  syncPubOpsEventCalendarByBookingId: mocks.syncPubOpsEventCalendarByBookingId,
  syncPubOpsEventCalendarByEventId: mocks.syncPubOpsEventCalendarByEventId,
}))

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}))

import { POST } from '@/app/g/[token]/manage-booking/action/route'

function buildCancelRequest() {
  return new NextRequest('http://localhost/g/raw-token/manage-booking/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ intent: 'cancel' }),
  })
}

describe('guest event manage-booking cancellation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(), rpc: vi.fn() })
    mocks.checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
    mocks.getEventManagePreviewByRawToken.mockResolvedValue({
      state: 'ready',
      booking_id: 'booking-1',
      customer_id: 'customer-1',
      event_id: 'event-1',
    })
    mocks.cancelEventBookingByRawToken.mockResolvedValue({
      state: 'cancelled',
      booking_id: 'booking-1',
      customer_id: 'customer-1',
      event_id: 'event-1',
      event_start_datetime: '2030-06-04T19:00:00.000Z',
      payment_mode: 'prepaid',
      price_per_seat: 25,
      seats: 2,
      previous_status: 'confirmed',
    })
    mocks.getEventRefundPolicy.mockReturnValue({ refundRate: 1, policyBand: 'full' })
    mocks.recordAnalyticsEvent.mockResolvedValue(undefined)
  })

  it('redirects to cancelled after core cancellation even when refund and calendar side effects fail', async () => {
    mocks.processEventRefund.mockRejectedValue(new Error('payments lookup failed'))
    mocks.syncPubOpsEventCalendarByEventId.mockRejectedValue(new Error('calendar unavailable'))

    const response = await POST(buildCancelRequest(), {
      params: Promise.resolve({ token: 'raw-token' }),
    })

    expect(response.status).toBe(303)

    const redirectUrl = new URL(response.headers.get('location') || '')
    expect(redirectUrl.pathname).toBe('/g/raw-token/manage-booking')
    expect(redirectUrl.searchParams.get('state')).toBe('cancelled')
    expect(redirectUrl.searchParams.get('refund_status')).toBe('manual_required')
    expect(redirectUrl.searchParams.get('refund_amount')).toBe('50')

    expect(mocks.cancelEventBookingByRawToken).toHaveBeenCalled()
    expect(mocks.processEventRefund).toHaveBeenCalled()
    expect(mocks.syncPubOpsEventCalendarByEventId).toHaveBeenCalled()
  })
})
