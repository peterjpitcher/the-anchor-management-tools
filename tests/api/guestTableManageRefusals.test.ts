import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  updateTableBookingByRawToken: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ from: vi.fn() })) }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({ updateTableBookingByRawToken: mocks.updateTableBookingByRawToken }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { POST } from '@/app/g/[token]/table-manage/action/route'

/**
 * BK-040, BK-091: every refused guest change used to land on "We could not process that request",
 * which reads as our fault. The reasons a guest can act on now reach the page as their own status.
 */

function updateRequest() {
  return new NextRequest('http://localhost/g/raw-token/table-manage/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'update', party_size: '9' }),
  })
}

describe('a refused guest party-size change', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['no_table', 'no_table'],
    ['slot_full', 'slot_full'],
    ['too_large_party', 'too_large'],
    ['booking_not_confirmed', 'error'],
  ])('sends a %s refusal to the page as status=%s', async (reason, status) => {
    mocks.updateTableBookingByRawToken.mockResolvedValue({ state: 'blocked', reason })

    const response = await POST(updateRequest(), { params: Promise.resolve({ token: 'raw-token' }) })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`http://localhost/g/raw-token/table-manage?status=${status}`)
  })
})
