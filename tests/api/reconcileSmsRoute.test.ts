import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

const twilioFetchMock = vi.fn()

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: vi.fn(() => ({
      fetch: twilioFetchMock,
    })),
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/cron/reconcile-sms/route'

describe('reconcile-sms route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST'
    process.env.TWILIO_AUTH_TOKEN = 'AUTH_TEST'
  })

  it('returns a generic 500 payload when reconciliation throws unexpectedly', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createAdminClient as unknown as vi.Mock).mockImplementation(() => {
      throw new Error('sensitive internal database failure details')
    })

    const request = new Request('http://localhost/api/cron/reconcile-sms')
    const response = await GET(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Internal server error' })
    expect('message' in payload).toBe(false)
  })

  it('counts Twilio 20404 as reconciled when the local message is marked failed', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    twilioFetchMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 20404 }))

    const stuckMessage = {
      id: 'message-1',
      twilio_message_sid: 'SM_MISSING',
      status: 'sent',
      twilio_status: 'sent',
      created_at: '2020-01-01T00:00:00.000Z',
      direction: 'outbound',
      customer_id: 'customer-1',
    }

    const messageLimit = vi.fn().mockResolvedValue({ data: [stuckMessage], error: null })
    const messageOrder = vi.fn().mockReturnValue({ limit: messageLimit })
    const messageNot = vi.fn().mockReturnValue({ order: messageOrder })
    const messageInDirection = vi.fn().mockReturnValue({ not: messageNot })
    const messageInStatus = vi.fn().mockReturnValue({ in: messageInDirection })
    const messageSelect = vi.fn().mockReturnValue({ in: messageInStatus })

    const messageUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'message-1' }, error: null })
    const messageUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: messageUpdateMaybeSingle })
    const messageUpdateEq = vi.fn().mockReturnValue({ select: messageUpdateSelect })
    const messageUpdate = vi.fn().mockReturnValue({ eq: messageUpdateEq })

    const customerSelectMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'customer-1', sms_status: 'active', sms_opt_in: true, sms_delivery_failures: 0 },
      error: null,
    })
    const customerSelectEq = vi.fn().mockReturnValue({ maybeSingle: customerSelectMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerSelectEq })

    const customerUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'customer-1' }, error: null })
    const customerUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: customerUpdateMaybeSingle })
    const customerUpdateEq = vi.fn().mockReturnValue({ select: customerUpdateSelect })
    const customerUpdate = vi.fn().mockReturnValue({ eq: customerUpdateEq })

    const historyInsert = vi.fn().mockResolvedValue({ error: null })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return {
            select: messageSelect,
            update: messageUpdate,
          }
        }
        if (table === 'message_delivery_status') {
          return { insert: historyInsert }
        }
        if (table === 'customers') {
          return {
            select: customerSelect,
            update: customerUpdate,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const request = new Request('http://localhost/api/cron/reconcile-sms')
    const response = await GET(request as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.updated).toBe(1)
    expect(payload.errors).toBe(0)
    expect(messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      twilio_status: 'not_found',
      error_message: 'Message not found in Twilio',
    }))
    expect(historyInsert).toHaveBeenCalledWith(expect.objectContaining({
      message_id: 'message-1',
      status: 'not_found',
    }))
  })
})
