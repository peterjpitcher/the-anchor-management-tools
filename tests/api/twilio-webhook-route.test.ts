import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must appear before any imports of the mocked modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('twilio', () => ({
  default: {
    validateRequest: vi.fn(() => true),
  },
}))

vi.mock('@/lib/retry', () => ({
  retry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  RetryConfigs: { database: {} },
}))

vi.mock('@/lib/sms-status', () => ({
  mapTwilioStatus: vi.fn((s: string) => s),
  isStatusUpgrade: vi.fn(() => true),
  formatErrorMessage: vi.fn((code: string) => `Error ${code}`),
}))

vi.mock('@/lib/env', () => ({
  skipTwilioSignatureValidation: vi.fn(() => false),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((p: string) => p),
  generatePhoneVariants: vi.fn((p: string) => [p]),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}))

vi.mock('@/lib/sms/reply-to-book', () => ({
  handleReplyToBook: vi.fn().mockResolvedValue({ handled: false }),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { POST } from '@/app/api/webhooks/twilio/route'
import { skipTwilioSignatureValidation } from '@/lib/env'
import { isStatusUpgrade } from '@/lib/sms-status'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/webhooks/twilio', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
  }) as unknown as Request
}

/** Create a minimal public Supabase client stub for webhook_logs. */
function stubPublicClient() {
  const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
  const client = {
    from: vi.fn(() => ({ insert: webhookLogInsert })),
  }
  return { client, webhookLogInsert }
}

/** Create a minimal admin client stub. */
function stubAdminClient(overrides: Record<string, unknown> = {}) {
  const noop = { data: null, error: null }
  const chain: Record<string, unknown> = {}
  const proxy = (): typeof chain => chain
  chain.select = proxy
  chain.insert = vi.fn().mockResolvedValue(noop)
  chain.update = proxy
  chain.eq = proxy
  chain.or = proxy
  chain.order = proxy
  chain.limit = proxy
  chain.maybeSingle = vi.fn().mockResolvedValue(noop)
  chain.single = vi.fn().mockResolvedValue(noop)

  const client = {
    from: vi.fn(() => ({ ...chain, ...overrides })),
  }
  return { client, chain }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Twilio webhook route', () => {
  const originalAuthToken = process.env.TWILIO_AUTH_TOKEN
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_AUTH_TOKEN = 'twilio_test_token'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_key_test'
  })

  afterEach(() => {
    const restore = (key: string, original: string | undefined) => {
      if (original === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original
      }
    }
    restore('TWILIO_AUTH_TOKEN', originalAuthToken)
    restore('NEXT_PUBLIC_SUPABASE_URL', originalSupabaseUrl)
    restore('NEXT_PUBLIC_SUPABASE_ANON_KEY', originalSupabaseAnonKey)
  })

  // -----------------------------------------------------------------------
  // Signature validation
  // -----------------------------------------------------------------------

  describe('signature validation', () => {
    it('should return 401 when Twilio signature is invalid', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(false)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const body = makeFormBody({
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
        From: '+441234567890',
        To: '+441234567891',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'bad_sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
    })

    it('should return 401 when X-Twilio-Signature header is missing', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(false)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const body = makeFormBody({ MessageSid: 'SM123', MessageStatus: 'delivered' })
      const req = makeRequest(body)
      const res = await POST(req as any)

      expect(res.status).toBe(401)
    })

    it('should return 401 when TWILIO_AUTH_TOKEN is not configured', async () => {
      delete process.env.TWILIO_AUTH_TOKEN
      // validateRequest won't be reached, but the verifyTwilioSignature helper returns false
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(false)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const body = makeFormBody({ MessageSid: 'SM123', MessageStatus: 'delivered' })
      const req = makeRequest(body, { 'x-twilio-signature': 'sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(401)
    })

    it('should proceed when signature is valid', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-1',
          status: 'queued',
          twilio_status: 'queued',
          direction: 'outbound',
          customer_id: null,
          sent_at: null,
        },
        error: null,
      })

      const messageUpdateMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'msg-1' },
        error: null,
      })

      const statusHistoryInsert = vi.fn().mockResolvedValue({ error: null })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle }),
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({ maybeSingle: messageUpdateMaybeSingle }),
                  }),
                }),
              }),
            }
          }
          if (table === 'message_delivery_status') {
            return { insert: statusHistoryInsert }
          }
          if (table === 'customers') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
                }),
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
      })

      const body = makeFormBody({
        MessageSid: 'SM456',
        MessageStatus: 'sent',
        From: '+441234567890',
        To: '+441234567891',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid_sig' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
    })
  })

  // -----------------------------------------------------------------------
  // Inbound SMS handling
  // -----------------------------------------------------------------------

  describe('inbound SMS handling', () => {
    function setupInboundMocks() {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

      const { client: publicClient, webhookLogInsert } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const messageLookupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      const customerLookup = vi.fn().mockResolvedValue({
        data: [{ id: 'cust-1', mobile_e164: '+441234567890' }],
        error: null,
      })
      const messageSave = vi.fn().mockResolvedValue({
        data: { id: 'msg-inbound-1' },
        error: null,
      })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle }),
                  }),
                }),
              }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({ single: messageSave }),
              }),
            }
          }
          if (table === 'customers') {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({ limit: customerLookup }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'cust-1' }, error: null }),
                  }),
                }),
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
      })

      return { webhookLogInsert, messageSave, customerLookup }
    }

    it('should save inbound SMS and return messageId', async () => {
      const { messageSave } = setupInboundMocks()

      const body = makeFormBody({
        Body: 'Hello there!',
        From: '+441234567890',
        To: '+441234567891',
        MessageSid: 'SMinbound1',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.messageId).toBe('msg-inbound-1')
    })

    it('should handle opt-out keyword STOP', async () => {
      setupInboundMocks()

      const body = makeFormBody({
        Body: 'STOP',
        From: '+441234567890',
        To: '+441234567891',
        MessageSid: 'SMstop1',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Status callback handling
  // -----------------------------------------------------------------------

  describe('status callback handling', () => {
    it('should update message status on delivery callback', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)
      ;(isStatusUpgrade as unknown as vi.Mock).mockReturnValue(true)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-out-1',
          status: 'sent',
          twilio_status: 'sent',
          direction: 'outbound',
          customer_id: 'cust-1',
          sent_at: new Date().toISOString(),
        },
        error: null,
      })

      const messageUpdateMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'msg-out-1' },
        error: null,
      })

      const statusHistoryInsert = vi.fn().mockResolvedValue({ error: null })
      const customerLookupMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'cust-1', sms_status: 'active', sms_opt_in: true, sms_delivery_failures: 0 },
        error: null,
      })
      const customerUpdateMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'cust-1' },
        error: null,
      })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle }),
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({ maybeSingle: messageUpdateMaybeSingle }),
                  }),
                }),
              }),
            }
          }
          if (table === 'message_delivery_status') {
            return { insert: statusHistoryInsert }
          }
          if (table === 'customers') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({ maybeSingle: customerLookupMaybeSingle }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({ maybeSingle: customerUpdateMaybeSingle }),
                }),
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
      })

      const body = makeFormBody({
        MessageSid: 'SMstatus1',
        MessageStatus: 'delivered',
        From: '+441234567890',
        To: '+441234567891',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
    })

    it('should prevent status regression', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)
      ;(isStatusUpgrade as unknown as vi.Mock).mockReturnValue(false)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-reg-1',
          status: 'delivered',
          twilio_status: 'delivered',
          direction: 'outbound',
          customer_id: 'cust-1',
          sent_at: new Date().toISOString(),
        },
        error: null,
      })

      const statusHistoryInsert = vi.fn().mockResolvedValue({ error: null })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle }),
                  }),
                }),
              }),
            }
          }
          if (table === 'message_delivery_status') {
            return { insert: statusHistoryInsert }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
      })

      const body = makeFormBody({
        MessageSid: 'SMregression1',
        MessageStatus: 'sent',
        From: '+441234567890',
        To: '+441234567891',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.note).toBe('Status regression prevented')
    })

    it('should handle message not found gracefully', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle }),
                  }),
                }),
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
      })

      const body = makeFormBody({
        MessageSid: 'SMnotfound1',
        MessageStatus: 'delivered',
        From: '+441234567890',
        To: '+441234567891',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.note).toBe('Message not found')
    })

    it('should skip duplicate status callbacks', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-dup-1',
          status: 'delivered',
          twilio_status: 'delivered',
          direction: 'outbound',
          customer_id: 'cust-1',
          sent_at: new Date().toISOString(),
        },
        error: null,
      })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle }),
                  }),
                }),
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
      })

      const body = makeFormBody({
        MessageSid: 'SMdup1',
        MessageStatus: 'delivered',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.note).toBe('Duplicate status ignored')
    })
  })

  // -----------------------------------------------------------------------
  // Unknown webhook type
  // -----------------------------------------------------------------------

  describe('unknown webhook type', () => {
    it('should return success for unrecognised webhook payload', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const { client: adminClient } = stubAdminClient()
      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(adminClient)

      // No Body, no MessageStatus — not inbound, not status update
      const body = makeFormBody({ AccountSid: 'AC123' })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.message).toBe('Unknown webhook type')
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('should return 500 when message lookup throws', async () => {
      ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

      const { client: publicClient } = stubPublicClient()
      ;(createClient as unknown as vi.Mock).mockReturnValue(publicClient)

      const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection lost' },
      })

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle }),
                  }),
                }),
              }),
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }),
      })

      const body = makeFormBody({
        MessageSid: 'SMerr1',
        MessageStatus: 'delivered',
        From: '+441234567890',
        To: '+441234567891',
      })
      const req = makeRequest(body, { 'x-twilio-signature': 'valid' })
      const res = await POST(req as any)

      expect(res.status).toBe(500)
    })
  })
})
