import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((value: string) => value),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
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
import { sendSMS } from '@/lib/twilio'
import { POST } from '@/app/api/event-waitlist/route'

describe('event waitlist route SMS safety meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces logging_failed meta without returning a retry-triggering 500', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
      code: 'logging_failed',
      logFailure: true,
    })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
        first_name: 'Pat',
        mobile_number: '+447700900123',
        sms_status: 'active',
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_waitlist_entry_v05') {
          return {
            data: {
              state: 'queued',
              waitlist_entry_id: 'waitlist-1',
              existing: false,
              seats_remaining: 0,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new Request('http://localhost/api/event-waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        requested_seats: 2,
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
    expect(error).toHaveBeenCalledWith(
      'Event waitlist SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          code: 'logging_failed',
          logFailure: true,
        }),
      })
    )
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('treats success:false logging_failed as sent/unknown in sms meta', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: false,
      error: 'message log insert failed',
      code: 'logging_failed',
      logFailure: true,
    })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
        first_name: 'Pat',
        mobile_number: '+447700900123',
        sms_status: 'active',
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_waitlist_entry_v05') {
          return {
            data: {
              state: 'queued',
              waitlist_entry_id: 'waitlist-1',
              existing: false,
              seats_remaining: 0,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new Request('http://localhost/api/event-waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        requested_seats: 2,
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
    expect(warn).not.toHaveBeenCalledWith(
      'Failed to send event waitlist join SMS',
      expect.anything()
    )
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('surfaces unexpected_exception sms meta when waitlist SMS side-effect task rejects', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    const customerMaybeSingle = vi.fn().mockRejectedValue(new Error('customer lookup blew up'))
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_waitlist_entry_v05') {
          return {
            data: {
              state: 'queued',
              waitlist_entry_id: 'waitlist-1',
              existing: false,
              seats_remaining: 0,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new Request('http://localhost/api/event-waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        requested_seats: 2,
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
      'Event waitlist SMS task rejected unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          waitlistEntryId: 'waitlist-1',
          error: 'customer lookup blew up',
        }),
      })
    )
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('does not release the idempotency claim when response persistence fails after queuing the entry', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'

    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId,
      resolutionError: undefined,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
      success: true,
      sid: 'SM1',
    })

    ;(persistIdempotencyResponse as unknown as vi.Mock).mockRejectedValueOnce(new Error('idempotency write down'))

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: customerId,
        first_name: 'Pat',
        mobile_number: '+447700900123',
        sms_status: 'active',
      },
      error: null,
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: customerSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === 'create_event_waitlist_entry_v05') {
          return {
            data: {
              state: 'queued',
              waitlist_entry_id: 'waitlist-1',
              existing: false,
              seats_remaining: 0,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      }),
    })

    const request = new Request('http://localhost/api/event-waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({
        event_id: eventId,
        phone: '+447700900123',
        first_name: 'Pat',
        requested_seats: 2,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: expect.objectContaining({
        state: 'queued',
        waitlist_entry_id: 'waitlist-1',
      }),
    })
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })
})
