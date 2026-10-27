import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * BK-112 (customer bookings review, 24 October 2026): the "are you still coming?" answer.
 *
 * Tapping "Sorry, I need to cancel" after the table time had started, or after staff had changed
 * the booking since the page loaded, showed "Your table is cancelled" while the booking stayed
 * confirmed. The route threw away what the cancel path said. "Yes" had no time check at all.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkGuestTokenThrottle: vi.fn(),
  updateTableBookingByRawToken: vi.fn(),
  lookupConfirmToken: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: mocks.checkGuestTokenThrottle }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  updateTableBookingByRawToken: mocks.updateTableBookingByRawToken,
}))
vi.mock('@/lib/table-bookings/confirm-token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/confirm-token')>()),
  lookupConfirmToken: mocks.lookupConfirmToken,
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { POST } from '@/app/g/[token]/confirm-booking/action/route'

const HOUR = 60 * 60 * 1000

function booking(startOffsetMs: number, status = 'confirmed') {
  const start = new Date(Date.now() + startOffsetMs)
  return {
    ok: true,
    booking: {
      id: 'tb-1',
      bookingReference: 'TB-0001',
      bookingDate: '2026-09-12',
      bookingTime: '19:30:00',
      startDateTime: start.toISOString(),
      partySize: 4,
      status,
      guestConfirmedAt: null,
      customerFirstName: 'Jane',
    },
  }
}

function answer(value: 'yes' | 'no') {
  return new NextRequest('http://localhost/g/conf-token/confirm-booking/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ answer: value }),
  })
}

async function stateAfter(value: 'yes' | 'no'): Promise<string | null> {
  const response = await POST(answer(value), { params: Promise.resolve({ token: 'conf-token' }) })
  expect(response.status).toBe(303)
  const location = new URL(response.headers.get('location') || '')
  expect(location.pathname).toBe('/g/conf-token/confirm-booking')
  return location.searchParams.get('state')
}

describe('the confirm link answer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
    mocks.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => ({ update: mocks.update })) })
  })

  it.each(['yes', 'no'] as const)('says it is too late once the table time has started (%s)', async (value) => {
    mocks.lookupConfirmToken.mockResolvedValue(booking(-30 * 60 * 1000))

    expect(await stateAfter(value)).toBe('too_late')
    expect(mocks.updateTableBookingByRawToken).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('never says cancelled when the cancel path refused because the time had started', async () => {
    // The start passes between the route's own check and the cancel.
    mocks.lookupConfirmToken.mockResolvedValue(booking(HOUR))
    mocks.updateTableBookingByRawToken.mockResolvedValue({ state: 'blocked', reason: 'booking_started' })

    expect(await stateAfter('no')).toBe('too_late')
  })

  it('never says cancelled when staff changed the booking between the page loading and the tap', async () => {
    mocks.lookupConfirmToken.mockResolvedValue(booking(HOUR))
    mocks.updateTableBookingByRawToken.mockResolvedValue({ state: 'blocked', reason: 'booking_not_confirmed' })

    expect(await stateAfter('no')).toBe('not_answerable')
  })

  it('reports any other refusal as a failure, not a cancellation', async () => {
    mocks.lookupConfirmToken.mockResolvedValue(booking(HOUR))
    mocks.updateTableBookingByRawToken.mockResolvedValue({ state: 'blocked', reason: 'invalid_token' })

    expect(await stateAfter('no')).toBe('cancel_failed')
  })

  it('says cancelled only when the cancel path cancelled', async () => {
    mocks.lookupConfirmToken.mockResolvedValue(booking(HOUR))
    mocks.updateTableBookingByRawToken.mockResolvedValue({ state: 'cancelled', table_booking_id: 'tb-1' })

    expect(await stateAfter('no')).toBe('cancelled')
    expect(mocks.updateTableBookingByRawToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rawToken: 'conf-token', action: 'cancel', allowedActionTypes: ['booking_confirm'] }),
    )
  })

  it('records a yes before the table time', async () => {
    mocks.lookupConfirmToken.mockResolvedValue(booking(HOUR))

    expect(await stateAfter('yes')).toBe('confirmed')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ guest_confirmed_at: expect.any(String) }))
  })
})
