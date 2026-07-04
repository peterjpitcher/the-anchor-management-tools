import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ─── Module mocks (must be declared before importing the route) ───────────────

// Rate limiter — returns null (allowed) by default; overridden per test to 429.
vi.mock('@/lib/distributed-rate-limit', () => ({
  applyDistributedRateLimit: vi.fn().mockResolvedValue(null)
}))

// Supabase admin client — chainable insert().select().single() mock.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn()
}))

// Best-effort manager email.
vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true })
}))

// Retry wrapper — pass through without real backoff delays so failure tests stay fast.
vi.mock('@/lib/retry', () => ({
  retry: vi.fn(async <T,>(fn: () => Promise<T>) => fn())
}))

// Idempotency — keep the REAL helpers (getIdempotencyKey, computeIdempotencyRequestHash)
// but stub the DB-touching claim/persist/release functions.
vi.mock('@/lib/api/idempotency', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/idempotency')>(
    '@/lib/api/idempotency'
  )
  return {
    ...actual,
    claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
    persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
    releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined)
  }
})

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { POST } from '../route'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { claimIdempotencyKey } from '@/lib/api/idempotency'

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build a chainable admin-client mock whose `.from('review_feedback').insert(...)`
 * captures the insert payload and resolves `.select().single()` to a row.
 */
function makeAdminMock(
  insertResult: { data: unknown; error: unknown } = { data: { id: 'test-id' }, error: null }
) {
  const single = vi.fn().mockResolvedValue(insertResult)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  const from = vi.fn().mockReturnValue({ insert })
  return { client: { from }, insert, from }
}

function buildRequest(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  const mergedHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'Idempotency-Key': 'test-key-1',
    ...headers
  }
  const req = new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: mergedHeaders,
    body: JSON.stringify(body)
  })
  // The handler only uses NextRequest-compatible members (headers, json, url);
  // a plain Request satisfies them at runtime.
  return req as unknown as NextRequest
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset default impls after clearAllMocks wipes them.
    vi.mocked(applyDistributedRateLimit).mockResolvedValue(null)
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' })
    const { client } = makeAdminMock()
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>
    )
  })

  describe('validation', () => {
    it('should return 400 VALIDATION_ERROR and not insert when rating is missing', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      const res = await POST(buildRequest({}))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('VALIDATION_ERROR')
      expect(insert).not.toHaveBeenCalled()
    })

    it('should return 201 and insert once when a valid rating is provided', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      const res = await POST(buildRequest({ rating: 5 }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.success).toBe(true)
      expect(json.data.ok).toBe(true)
      expect(insert).toHaveBeenCalledTimes(1)
    })

    it('should send the 201 with Cache-Control no-store', async () => {
      const res = await POST(buildRequest({ rating: 5 }))

      expect(res.status).toBe(201)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })
  })

  describe('honeypot', () => {
    it('should return 201 without inserting or emailing when the honeypot is filled', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      const res = await POST(buildRequest({ rating: 5, honeypot: 'x' }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.success).toBe(true)
      expect(json.data.ok).toBe(true)
      expect(insert).not.toHaveBeenCalled()
      expect(sendEmail).not.toHaveBeenCalled()
    })
  })

  describe('rate limiting', () => {
    it('should return 429 and not insert when the rate limiter blocks the request', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )
      const limited = new Response(
        JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many' } }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
      vi.mocked(applyDistributedRateLimit).mockResolvedValue(
        limited as unknown as Awaited<ReturnType<typeof applyDistributedRateLimit>>
      )

      const res = await POST(buildRequest({ rating: 5 }))

      expect(res.status).toBe(429)
      expect(insert).not.toHaveBeenCalled()
    })
  })

  describe('contact details and consent', () => {
    it('should return 400 and not insert when contact details are provided without consent', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      const res = await POST(
        buildRequest({
          rating: 4,
          customerName: 'Jo',
          customerEmail: 'jo@x.com',
          customerPhone: '+447700900123',
          contactConsent: false
        })
      )
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('VALIDATION_ERROR')
      expect(json.error.message).toBe('Tick the box so we can contact you, or clear your details')
      expect(insert).not.toHaveBeenCalled()
    })

    it('should store contact fields when consent is given', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      const res = await POST(
        buildRequest({
          rating: 4,
          customerName: 'Jo',
          customerEmail: 'jo@x.com',
          customerPhone: '+447700900123',
          contactConsent: true
        })
      )

      expect(res.status).toBe(201)
      expect(insert).toHaveBeenCalledTimes(1)
      const payload = insert.mock.calls[0][0] as Record<string, unknown>
      expect(payload.customer_name).toBe('Jo')
      expect(payload.customer_email).toBe('jo@x.com')
      expect(payload.customer_phone).toBe('+447700900123')
      expect(payload.contact_consent).toBe(true)
    })

    it('should store null contact fields when no details are given without consent', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      const res = await POST(buildRequest({ rating: 4, contactConsent: false }))

      expect(res.status).toBe(201)
      expect(insert).toHaveBeenCalledTimes(1)
      const payload = insert.mock.calls[0][0] as Record<string, unknown>
      expect(payload.customer_name).toBeNull()
      expect(payload.customer_email).toBeNull()
      expect(payload.customer_phone).toBeNull()
      expect(payload.contact_consent).toBe(false)
    })
  })

  describe('source provenance', () => {
    it('should store a valid src as the source', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      const res = await POST(buildRequest({ rating: 3, src: 'private-booking-sms' }))

      expect(res.status).toBe(201)
      const payload = insert.mock.calls[0][0] as Record<string, unknown>
      expect(payload.source).toBe('private-booking-sms')
    })

    it('should fall back to review-funnel when src is missing or invalid', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )

      await POST(buildRequest({ rating: 3 }))
      await POST(
        buildRequest({ rating: 3, src: 'https://evil.example/inject' }, { 'Idempotency-Key': 'test-key-2' })
      )

      expect(insert).toHaveBeenCalledTimes(2)
      expect((insert.mock.calls[0][0] as Record<string, unknown>).source).toBe('review-funnel')
      expect((insert.mock.calls[1][0] as Record<string, unknown>).source).toBe('review-funnel')
    })
  })

  describe('email failure', () => {
    it('should still return 201 and persist the submission when the manager email throws', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )
      vi.mocked(sendEmail).mockRejectedValue(new Error('smtp down'))

      const res = await POST(buildRequest({ rating: 5 }))

      expect(res.status).toBe(201)
      expect(insert).toHaveBeenCalledTimes(1)
    })
  })

  describe('idempotency', () => {
    it('should return 400 IDEMPOTENCY_KEY_REQUIRED when the header is missing', async () => {
      const req = new Request('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating: 5 })
      }) as unknown as NextRequest

      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('should return 201 without inserting when the claim replays a prior response', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )
      vi.mocked(claimIdempotencyKey).mockResolvedValue({
        state: 'replay',
        response: { ok: true }
      })

      const res = await POST(buildRequest({ rating: 5 }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.success).toBe(true)
      expect(insert).not.toHaveBeenCalled()
    })

    it('should return 409 IDEMPOTENCY_KEY_CONFLICT when the key was reused with a different payload', async () => {
      const { client, insert } = makeAdminMock()
      vi.mocked(createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof createAdminClient>
      )
      vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'conflict' })

      const res = await POST(buildRequest({ rating: 5 }))
      const json = await res.json()

      expect(res.status).toBe(409)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
      expect(insert).not.toHaveBeenCalled()
    })
  })
})
