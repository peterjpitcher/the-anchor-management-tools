import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  isApiKeyAuthenticated: vi.fn().mockResolvedValue(true),
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (
      handler: (request: Request) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json({ success: false, error, code }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  getIdempotencyKey: vi.fn().mockReturnValue('idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

// The real reason mapper, so the test proves what the website actually receives. Only the
// helpers that would send something are stubbed.
vi.mock('@/lib/table-bookings/bookings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/table-bookings/bookings')>()),
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn(),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

const { warn, error, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn, error, info },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { sendTableBookingCreatedSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { POST } from '@/app/api/table-bookings/route'

describe('public table bookings route: a kitchen-hours refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers as a blocked booking the website already words, not as a 500', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })

    const kitchenNotServing = {
      code: '22023',
      message: 'The kitchen is not serving at 20:45 on 03 Mar 2026. Please choose a time inside a food service.',
      details: null,
      hint: null,
    }

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_table_booking_public_v06') {
          return { data: null, error: kitchenNotServing }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new NextRequest('http://localhost/api/table-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        phone: '+447700900123',
        first_name: 'Pat',
        date: '2026-03-03',
        time: '20:45',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      data: {
        state: 'blocked',
        reason: 'outside_service_window',
        // The website shows "That time is outside our booking hours. Please choose another time
        // or call us." for this reason (OJ-The-Anchor.pub lib/table-booking/submission.ts).
        blocked_reason: 'outside_hours',
        table_booking_id: null,
      },
    })
    // Availability applies the same rule, so reaching the guard means the two have drifted.
    // That has to be visible, and logger.warn prints nothing in production.
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/service-window guard/i),
      expect.objectContaining({
        metadata: expect.objectContaining({ bookingDate: '2026-03-03', bookingTime: '20:45:00' }),
      })
    )
    expect(error).not.toHaveBeenCalledWith('create_table_booking_public_v06 RPC failed', expect.anything())
    expect(sendTableBookingCreatedSmsIfAllowed).not.toHaveBeenCalled()
  })
})
