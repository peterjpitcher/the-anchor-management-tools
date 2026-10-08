// The website's "a payment failed" alert. The contract under test: the real API
// key guard refuses a missing key, an unknown key and a key without the scope;
// the body is two fixed codes and nothing else; the text goes to this app's own
// setting by the staff path, never the customer one; the limits hold; and a
// failed send is reported as a failure.
//
// Nothing here reaches Twilio or a database: sendSMS, the admin client and the
// request headers are all stand-ins.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

import {
  PAYMENT_FAILURE_ALERT_DAILY_CAP,
  PAYMENT_FAILURE_AREAS,
  buildPaymentFailureAlertText,
} from '@/lib/ops-alerts/payment-failure-alert'

// A number from Ofcom's reserved drama range. It can never belong to anyone.
const ALERT_NUMBER = '+447700900123'
const GOOD_KEY = 'anch_test_key_with_scope'
const NO_SCOPE_KEY = 'anch_test_key_without_scope'

type KeyRow = {
  id: string
  name: string
  permissions: string[]
  rate_limit: number
  is_active: boolean
  expires_at: null
}

const state = vi.hoisted(() => ({
  headers: new Headers(),
  keysByHash: new Map<string, unknown>(),
  sendSMS: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => state.headers),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: state.sendSMS,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Just enough of the admin client for the real withApiAuth: the key lookup by
// hash, the last-used stamp, the hourly usage count and the usage log.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'api_keys') {
        return {
          select: () => ({
            eq: (_column: string, keyHash: string) => ({
              eq: async () => {
                const row = state.keysByHash.get(keyHash)
                return { data: row ? [row] : [], error: null }
              },
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: { id: 'key' }, error: null }) }),
            }),
          }),
        }
      }
      if (table === 'api_usage') {
        return {
          select: () => ({ eq: () => ({ gte: async () => ({ count: 0, error: null }) }) }),
          insert: async () => ({ error: null }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  })),
}))

import { POST } from './route'
import { hashApiKey } from '@/lib/api/auth'

function keyRow(id: string, permissions: string[]): KeyRow {
  return { id, name: id, permissions, rate_limit: 1000, is_active: true, expires_at: null }
}

function makeRequest(body: unknown, key: string | null = GOOD_KEY): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  state.headers = new Headers(headers)
  return new NextRequest('http://localhost/api/website/payment-failure-alert', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const VALID_BODY = { area: 'table_deposit_capture', reason: 'server_error' } as const

// The limiter counts in this instance's memory when Upstash is not configured.
// Each test starts on a day of its own so no test inherits another's count.
const FIRST_DAY = Date.UTC(2026, 9, 8, 18, 30, 0)
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
let testIndex = 0

const ORIGINAL_ENV = process.env

beforeEach(async () => {
  testIndex += 1
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(FIRST_DAY + testIndex * 3 * DAY_MS))

  process.env = { ...ORIGINAL_ENV, OPS_ALERT_SMS_NUMBER: ALERT_NUMBER }
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN

  state.keysByHash.clear()
  state.keysByHash.set(await hashApiKey(GOOD_KEY), keyRow('website', ['read:events', 'write:ops_alerts']))
  state.keysByHash.set(await hashApiKey(NO_SCOPE_KEY), keyRow('other', ['read:events', 'create:bookings']))

  state.sendSMS.mockReset()
  state.sendSMS.mockResolvedValue({ success: true, sid: 'SM-test', status: 'queued', messageId: null, customerId: null })
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  vi.useRealTimers()
})

describe('POST /api/website/payment-failure-alert', () => {
  describe('who may call it', () => {
    it('refuses a request with no key', async () => {
      const res = await POST(makeRequest(VALID_BODY, null))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
      expect(state.sendSMS).not.toHaveBeenCalled()
    })

    it('refuses a key it does not know', async () => {
      const res = await POST(makeRequest(VALID_BODY, 'anch_not_a_real_key'))

      expect(res.status).toBe(401)
      expect(state.sendSMS).not.toHaveBeenCalled()
    })

    it('refuses a valid key that was not given the alert scope', async () => {
      const res = await POST(makeRequest(VALID_BODY, NO_SCOPE_KEY))
      const json = await res.json()

      expect(res.status).toBe(403)
      expect(json.error.code).toBe('FORBIDDEN')
      expect(state.sendSMS).not.toHaveBeenCalled()
    })
  })

  describe('a good request', () => {
    it('sends one text, with the fixed wording, to the configured number', async () => {
      const res = await POST(makeRequest(VALID_BODY))
      const json = await res.json()

      expect(res.status).toBe(202)
      expect(json).toEqual({
        success: true,
        data: { sent: true, area: 'table_deposit_capture', reason: 'server_error' },
      })
      expect(res.headers.get('Cache-Control')).toBe('no-store')

      expect(state.sendSMS).toHaveBeenCalledTimes(1)
      const [to, text] = state.sendSMS.mock.calls[0]
      expect(to).toBe(ALERT_NUMBER)
      expect(text).toBe(buildPaymentFailureAlertText('table_deposit_capture', 'server_error'))
      expect(text).not.toMatch(/undefined|NaN|null/)
      expect(String(text).trim()).not.toBe('')
    })

    it('takes the staff path: no customer, no message log, no marketing flag', async () => {
      await POST(makeRequest(VALID_BODY))

      const options = state.sendSMS.mock.calls[0][2]
      expect(options.createCustomerIfMissing).toBe(false)
      expect(options.skipMessageLogging).toBe(true)
      expect(options.skipQuietHours).toBe(true)
      expect(options).not.toHaveProperty('customerId')
      expect(options).not.toHaveProperty('customerFallback')
      expect(options).not.toHaveProperty('skipSafetyGuards')
      expect(options.metadata).not.toHaveProperty('marketing')
      expect(options.metadata.template_key).toBe('website_payment_failure_alert')
      expect(options.metadata.stage.startsWith('table_deposit_capture:')).toBe(true)
    })
  })

  describe('what the body may hold', () => {
    it.each([
      ['an area that is not on the list', { area: 'gift_vouchers', reason: 'server_error' }],
      ['a reason that is not on the list', { area: 'parking_capture', reason: 'Card declined for Alice Booker' }],
      ['a missing reason', { area: 'parking_capture' }],
      ['free text alongside the codes', { ...VALID_BODY, message: 'Please ring Alice on 07700 900999' }],
      ['a destination chosen by the caller', { ...VALID_BODY, to: '+447700900999' }],
      ['guest details', { ...VALID_BODY, customer: { name: 'Alice Booker', phone: '07700 900999' } }],
      ['a list instead of an object', [VALID_BODY]],
    ])('refuses %s and sends nothing', async (_label, body) => {
      const res = await POST(makeRequest(body))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
      expect(JSON.stringify(json)).not.toMatch(/Alice|07700 900999|\+447700900999/)
      expect(state.sendSMS).not.toHaveBeenCalled()
    })

    it('refuses a body that is not JSON', async () => {
      const res = await POST(makeRequest('area=parking_capture'))

      expect(res.status).toBe(400)
      expect(state.sendSMS).not.toHaveBeenCalled()
    })
  })

  describe('the limits', () => {
    it('sends one text per area in ten minutes, and lets another area through', async () => {
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(202)

      const second = await POST(makeRequest({ ...VALID_BODY, reason: 'no_answer' }))
      const json = await second.json()
      expect(second.status).toBe(429)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('ALERT_WINDOW_LIMIT')
      expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0)

      expect((await POST(makeRequest({ area: 'parking_capture', reason: 'server_error' }))).status).toBe(202)
      expect(state.sendSMS).toHaveBeenCalledTimes(2)
    })

    it('lets the same area through again once ten minutes have passed', async () => {
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(202)

      vi.setSystemTime(Date.now() + 9 * MINUTE_MS)
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(429)

      vi.setSystemTime(Date.now() + 2 * MINUTE_MS)
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(202)
      expect(state.sendSMS).toHaveBeenCalledTimes(2)
    })

    it('stops at the daily cap however many areas fail', async () => {
      // One text for each area uses the whole cap.
      expect(PAYMENT_FAILURE_AREAS).toHaveLength(PAYMENT_FAILURE_ALERT_DAILY_CAP)
      for (const area of PAYMENT_FAILURE_AREAS) {
        expect((await POST(makeRequest({ area, reason: 'server_error' }))).status).toBe(202)
      }

      // Past the ten minute window, so only the daily cap can refuse this one.
      vi.setSystemTime(Date.now() + 11 * MINUTE_MS)
      const res = await POST(makeRequest(VALID_BODY))
      const json = await res.json()

      expect(res.status).toBe(429)
      expect(json.error.code).toBe('ALERT_DAILY_CAP')
      expect(state.sendSMS).toHaveBeenCalledTimes(PAYMENT_FAILURE_ALERT_DAILY_CAP)

      // A day later the cap has cleared.
      vi.setSystemTime(Date.now() + DAY_MS)
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(202)
    })

    it('says so when the SMS guard had already sent this slot from another server', async () => {
      state.sendSMS.mockResolvedValue({
        success: true,
        sid: null,
        status: 'suppressed_duplicate',
        suppressed: true,
        suppressionReason: 'duplicate',
      })

      const res = await POST(makeRequest(VALID_BODY))
      const json = await res.json()

      expect(res.status).toBe(429)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('ALERT_WINDOW_LIMIT')
    })
  })

  describe('when the alert number is not set', () => {
    it.each([
      ['missing', undefined],
      ['blank', ''],
      ['not an international number', '07700900123'],
    ])('answers "not configured" when it is %s, and sends nothing', async (_label, value) => {
      if (value === undefined) {
        delete process.env.OPS_ALERT_SMS_NUMBER
      } else {
        process.env.OPS_ALERT_SMS_NUMBER = value
      }

      const res = await POST(makeRequest(VALID_BODY))
      const json = await res.json()

      expect(res.status).toBe(503)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('ALERT_NOT_CONFIGURED')
      expect(json.error.message).toContain('OPS_ALERT_SMS_NUMBER')
      expect(state.sendSMS).not.toHaveBeenCalled()
    })

    it('does not spend the ten minute slot, so the alert works as soon as the number is set', async () => {
      delete process.env.OPS_ALERT_SMS_NUMBER
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(503)

      process.env.OPS_ALERT_SMS_NUMBER = ALERT_NUMBER
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(202)
    })
  })

  describe('when the text cannot be sent', () => {
    it('reports the failure when Twilio refuses the send', async () => {
      state.sendSMS.mockResolvedValue({ success: false, error: 'Too many messages sent', code: '20429' })

      const res = await POST(makeRequest(VALID_BODY))
      const json = await res.json()

      expect(res.status).toBe(502)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('SMS_SEND_FAILED')
      expect(json.error.details).toEqual({ smsCode: '20429' })
      expect(JSON.stringify(json)).not.toContain(ALERT_NUMBER)
    })

    it('reports the failure when sending is suspended by the kill switch', async () => {
      state.sendSMS.mockResolvedValue({
        success: false,
        error: 'SMS sending is currently suspended',
        code: 'sms_suspended',
      })

      const res = await POST(makeRequest(VALID_BODY))
      const json = await res.json()

      expect(res.status).toBe(502)
      expect(json.error.details).toEqual({ smsCode: 'sms_suspended' })
    })

    it('reports the failure when the send throws', async () => {
      state.sendSMS.mockRejectedValue(new Error('network down'))

      const res = await POST(makeRequest(VALID_BODY))
      const json = await res.json()

      expect(res.status).toBe(502)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('SMS_SEND_FAILED')
      expect(JSON.stringify(json)).not.toContain('network down')
    })
  })
})
