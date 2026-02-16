import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (
      handler: (request: Request) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json(
      {
        success: false,
        error,
        code,
      },
      { status }
    )
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

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTableCardCaptureHoldToScheduledSend: vi.fn(),
  createTableCardCaptureToken: vi.fn(),
  mapTableBookingBlockedReason: vi.fn((reason?: string) => reason || 'blocked'),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

const { warn, error, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error,
    info,
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { persistIdempotencyResponse, releaseIdempotencyClaim } from '@/lib/api/idempotency'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { sendTableBookingCreatedSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { POST } from '@/app/api/table-bookings/route'

describe('table bookings route SMS safety meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns meta.sms from sendTableBookingCreatedSmsIfAllowed', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })

    ;(sendTableBookingCreatedSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({
      sms: {
        success: true,
        code: 'logging_failed',
        logFailure: true,
      },
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_table_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              status: 'confirmed',
              table_booking_id: 'table-booking-1',
              booking_reference: 'ABCD1234',
              reason: null,
              hold_expires_at: null,
              start_datetime: '2026-03-01T12:00:00.000Z',
              party_size: 2,
              table_name: 'Table 1',
            },
            error: null,
          }
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
        date: '2026-03-01',
        time: '12:00',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      meta: {
        sms: {
          success: true,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })
    expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledTimes(1)
  })

  it('returns a success response when the SMS helper rejects, surfacing meta.sms as unexpected_exception', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })

    ;(sendTableBookingCreatedSmsIfAllowed as unknown as vi.Mock).mockRejectedValueOnce(new Error('twilio down'))

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_table_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              status: 'confirmed',
              table_booking_id: 'table-booking-1',
              booking_reference: 'ABCD1234',
              reason: null,
              hold_expires_at: null,
              start_datetime: '2026-03-01T12:00:00.000Z',
              party_size: 2,
              table_name: 'Table 1',
            },
            error: null,
          }
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
        date: '2026-03-01',
        time: '12:00',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      meta: {
        sms: {
          success: false,
          code: 'unexpected_exception',
          logFailure: false,
        },
      },
    })
    expect(warn).toHaveBeenCalledWith(
      'Table booking created SMS task rejected unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tableBookingId: 'table-booking-1',
        }),
      })
    )
  })

  it('does not release the idempotency claim when response persistence fails after booking creation', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })

    ;(sendTableBookingCreatedSmsIfAllowed as unknown as vi.Mock).mockResolvedValue({
      sms: {
        success: true,
        sid: 'SM1',
      },
    })

    ;(persistIdempotencyResponse as unknown as vi.Mock).mockRejectedValueOnce(new Error('idempotency write down'))

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_table_booking_v05') {
          return {
            data: {
              state: 'confirmed',
              status: 'confirmed',
              table_booking_id: 'table-booking-1',
              booking_reference: 'ABCD1234',
              reason: null,
              hold_expires_at: null,
              start_datetime: '2026-03-01T12:00:00.000Z',
              party_size: 2,
              table_name: 'Table 1',
            },
            error: null,
          }
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
        date: '2026-03-01',
        time: '12:00',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: expect.objectContaining({
        state: 'confirmed',
        table_booking_id: 'table-booking-1',
      }),
    })
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })
})
