import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>('@/lib/api/auth')
  return {
    ...actual,
    withApiAuth: vi.fn(
      async (
        handler: (request: Request) => Promise<Response>,
        _requiredPermissions: string[],
        request?: Request
      ) => handler(request || new Request('http://localhost/api/table-bookings', { method: 'POST' }))
    ),
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTableCardCaptureHoldToScheduledSend: vi.fn(),
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTableCardCaptureToken: vi.fn(),
  createTablePaymentToken: vi.fn(),
  mapTableBookingBlockedReason: vi.fn(),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { OPTIONS, POST } from '@/app/api/table-bookings/route'

describe('table-bookings route CORS and idempotency guards', () => {
  it('returns preflight response that allows Idempotency-Key header', async () => {
    const response = await OPTIONS(new Request('http://localhost/api/table-bookings', { method: 'OPTIONS' }) as any)

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key')
  })

  it('still rejects create requests that omit Idempotency-Key', async () => {
    const request = new Request('http://localhost/api/table-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: '+447700900123',
        date: '2026-02-23',
        time: '19:00',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({
      success: false,
      error: {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      },
    })
  })
})
