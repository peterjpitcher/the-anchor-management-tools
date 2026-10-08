import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/recruitment/applications: who must pass the bot check.
 *
 * The route used to skip the bot check whenever an x-api-key or authorization
 * header was present at all. Every other public route asks the three-state
 * question (getApiKeyAuthState): does the key validate, is there no usable key,
 * or could we not tell. This suite calls the handler through the real
 * withApiAuth with only the database replaced.
 */

const db = vi.hoisted(() => ({
  keyRows: [] as unknown[],
  keyError: null as { message: string } | null,
  requestHeaders: new Headers(),
}))

vi.mock('next/headers', () => ({
  headers: async () => db.requestHeaders,
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Work queued for after the response is not part of what is being proved here.
  after: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'api_keys') {
        const lookup: Record<string, unknown> = {}
        lookup.eq = () => lookup
        lookup.then = (resolve: (value: unknown) => unknown) =>
          resolve({ data: db.keyError ? null : db.keyRows, error: db.keyError })
        const touch: Record<string, unknown> = {}
        touch.eq = () => touch
        touch.select = () => touch
        touch.maybeSingle = async () => ({ data: { id: 'key-1' }, error: null })
        return { select: () => lookup, update: () => touch }
      }
      if (table === 'api_usage') {
        const count: Record<string, unknown> = {}
        count.eq = () => count
        count.gte = () => count
        count.then = (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null })
        return { select: () => count, insert: async () => ({ error: null }) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

const applyDistributedRateLimit = vi.fn()
vi.mock('@/lib/distributed-rate-limit', () => ({
  applyDistributedRateLimit: (...args: unknown[]) => applyDistributedRateLimit(...args),
}))

const verifyTurnstileToken = vi.fn()
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: (...args: unknown[]) => verifyTurnstileToken(...args),
  getClientIp: () => '203.0.113.1',
}))

const releaseIdempotencyClaim = vi.fn()
vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey: () => 'test-idempotency-key',
  computeIdempotencyRequestHash: (payload: unknown) => JSON.stringify(payload),
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: (...args: unknown[]) => releaseIdempotencyClaim(...args),
}))

const createRecruitmentApplication = vi.fn()
vi.mock('@/services/recruitment', () => ({
  createRecruitmentApplication: (...args: unknown[]) => createRecruitmentApplication(...args),
  processRecruitmentApplicationAi: vi.fn(),
}))

vi.mock('@/lib/recruitment/communications', () => ({
  sendRecruitmentApplicationReceivedEmail: vi.fn(),
}))

vi.mock('@/lib/recruitment/files', () => ({
  getRecruitmentCvMaxBytes: () => 5_000_000,
  validateRecruitmentCvUpload: () => null,
}))

import { POST } from '@/app/api/recruitment/applications/route'

function key(permissions: string[]) {
  return {
    id: 'key-1',
    name: 'website',
    permissions,
    rate_limit: 1000,
    is_active: true,
    expires_at: null,
  }
}

function application(headers: Record<string, string> = {}): Request {
  const form = new FormData()
  form.set('privacy_consent', 'true')
  form.set('first_name', 'Pat')
  form.set('last_name', 'Example')
  form.set('email', 'pat@example.com')

  const all = new Headers({ 'idempotency-key': 'test-idempotency-key', ...headers })
  db.requestHeaders = all
  return new Request('http://localhost/api/recruitment/applications', {
    method: 'POST',
    headers: all,
    body: form,
  })
}

function limiterPrefix(): string {
  return applyDistributedRateLimit.mock.calls[0][1].prefix
}

beforeEach(() => {
  vi.clearAllMocks()
  db.keyRows = []
  db.keyError = null
  applyDistributedRateLimit.mockResolvedValue(null)
  verifyTurnstileToken.mockResolvedValue({ success: false, error: 'Bot verification failed' })
  createRecruitmentApplication.mockResolvedValue({
    application: { id: 'app-1', status: 'new' },
    candidate: { id: 'cand-1' },
    duplicateOfApplicationId: null,
    cvExtractionError: null,
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /api/recruitment/applications bot check decision', () => {
  it('requires the bot check when no key is sent, and refuses when it fails', async () => {
    const response = await POST(application() as never)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('TURNSTILE_FAILED')
    expect(verifyTurnstileToken).toHaveBeenCalledTimes(1)
    expect(createRecruitmentApplication).not.toHaveBeenCalled()
    expect(limiterPrefix()).toBe('recruitment-public-upload')
  })

  it('takes the application when no key is sent and the bot check passes', async () => {
    verifyTurnstileToken.mockResolvedValue({ success: true })
    const response = await POST(application({ 'x-turnstile-token': 'good' }) as never)

    expect(response.status).toBe(201)
    expect(createRecruitmentApplication).toHaveBeenCalledTimes(1)
  })

  it('answers 401 for a made-up key, on the strict limit, and a passing bot check does not rescue it', async () => {
    verifyTurnstileToken.mockResolvedValue({ success: true })
    const response = await POST(
      application({ 'x-api-key': 'anch_made_up', 'x-turnstile-token': 'good' }) as never
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(createRecruitmentApplication).not.toHaveBeenCalled()
    expect(limiterPrefix()).toBe('recruitment-public-upload')
  })

  it('answers 503 when the key cannot be looked up, never a failed bot check', async () => {
    db.keyError = { message: 'connection refused' }
    const response = await POST(application({ 'x-api-key': 'anch_real' }) as never)

    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
    expect(createRecruitmentApplication).not.toHaveBeenCalled()
  })

  it('answers 403 for a valid key without write:recruitment', async () => {
    db.keyRows = [key(['read:events', 'create:bookings'])]
    const response = await POST(application({ 'x-api-key': 'anch_real' }) as never)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
    expect(createRecruitmentApplication).not.toHaveBeenCalled()
  })

  it('takes the application from a valid key with the scope, with no bot check and the roomier limit', async () => {
    db.keyRows = [key(['write:recruitment'])]
    const response = await POST(application({ 'x-api-key': 'anch_real' }) as never)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.data.application_id).toBe('app-1')
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
    expect(limiterPrefix()).toBe('recruitment-api-upload')
  })

  it('accepts the key as a bearer token', async () => {
    db.keyRows = [key(['write:recruitment'])]
    const response = await POST(application({ authorization: 'Bearer anch_real' }) as never)

    expect(response.status).toBe(201)
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
  })

  it('tells the caller when saving fails and frees the claim so a retry can work', async () => {
    db.keyRows = [key(['write:recruitment'])]
    createRecruitmentApplication.mockRejectedValue(new Error('storage is down'))
    const response = await POST(application({ 'x-api-key': 'anch_real' }) as never)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.success).toBe(false)
    expect(payload.error.code).toBe('RECRUITMENT_APPLICATION_FAILED')
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
  })

  it('stops at the rate limit before anything else runs', async () => {
    applyDistributedRateLimit.mockResolvedValue(new Response(null, { status: 429 }))
    const response = await POST(application() as never)

    expect(response.status).toBe(429)
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
    expect(createRecruitmentApplication).not.toHaveBeenCalled()
  })
})
