import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkGuestTokenThrottle: vi.fn(),
  updateTableBookingByRawToken: vi.fn(),
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

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  updateTableBookingByRawToken: mocks.updateTableBookingByRawToken,
}))

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}))

import { GET, POST } from '@/app/g/[token]/table-manage/action/route'

function buildCancelRequest() {
  return new NextRequest('http://localhost/g/raw-token/table-manage/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'cancel' }),
  })
}

function buildCancelLinkRequest() {
  return new NextRequest('http://localhost/g/raw-token/table-manage/action?action=cancel&confirm=1', {
    method: 'GET',
  })
}

describe('guest table-manage cancellation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAdminClient.mockReturnValue({ from: vi.fn() })
    mocks.checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
    mocks.updateTableBookingByRawToken.mockResolvedValue({
      state: 'cancelled',
      table_booking_id: 'booking-1',
      customer_id: 'customer-1',
      status: 'cancelled',
      charge_request_id: null,
      charge_amount: null,
    })
  })

  it('accepts the cancel form without a party_size field', async () => {
    const response = await POST(buildCancelRequest(), {
      params: Promise.resolve({ token: 'raw-token' }),
    })

    expect(response.status).toBe(303)

    const redirectUrl = new URL(response.headers.get('location') || '')
    expect(redirectUrl.pathname).toBe('/g/raw-token/table-manage')
    expect(redirectUrl.searchParams.get('status')).toBe('cancelled')

    expect(mocks.updateTableBookingByRawToken).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        rawToken: 'raw-token',
        action: 'cancel',
        newPartySize: undefined,
        notes: undefined,
      })
    )
    expect(mocks.logger.warn).not.toHaveBeenCalledWith(
      'Guest table-manage action form validation failed',
      expect.any(Object)
    )
  })

  it('accepts the guarded cancel link for sandboxed browsers that block forms', async () => {
    const response = await GET(buildCancelLinkRequest(), {
      params: Promise.resolve({ token: 'raw-token' }),
    })

    expect(response.status).toBe(303)

    const redirectUrl = new URL(response.headers.get('location') || '')
    expect(redirectUrl.pathname).toBe('/g/raw-token/table-manage')
    expect(redirectUrl.searchParams.get('status')).toBe('cancelled')

    expect(mocks.updateTableBookingByRawToken).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        rawToken: 'raw-token',
        action: 'cancel',
        newPartySize: undefined,
        notes: undefined,
      })
    )
  })
})
