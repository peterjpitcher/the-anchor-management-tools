import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
    handler(request)
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) =>
    Response.json({ success: true, data }, { status })
  ),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json({ success: false, error, code }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  getIdempotencyKey: vi.fn().mockReturnValue(null),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/external/performer-interest/route'

describe('external performer-interest route fail-closed guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a 500 error when rate-limit lookup fails instead of processing submission', async () => {
    const rateLimitGte = vi.fn().mockResolvedValue({
      count: null,
      error: { message: 'rate-limit lookup unavailable' },
    })
    const rateLimitEq = vi.fn().mockReturnValue({ gte: rateLimitGte })
    const rateLimitSelect = vi.fn().mockReturnValue({ eq: rateLimitEq })
    const submissionInsert = vi.fn()

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'performer_submissions') {
          return {
            select: rateLimitSelect,
            insert: submissionInsert,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const request = new Request('http://localhost/api/external/performer-interest', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.11',
      },
      body: JSON.stringify({
        fullName: 'Pat Example',
        email: 'pat@example.com',
        phone: '+447700900123',
        bio: 'Singer songwriter',
        consentDataStorage: true,
        honeypot: '',
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({
      success: false,
      error: 'Failed to process submission',
      code: 'DATABASE_ERROR',
    })
    expect(submissionInsert).not.toHaveBeenCalled()
  })
})
