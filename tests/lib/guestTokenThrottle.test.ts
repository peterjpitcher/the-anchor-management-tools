import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/guest/tokens', () => ({
  hashGuestToken: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { hashGuestToken } from '@/lib/guest/tokens'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

const mockedHashGuestToken = hashGuestToken as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('checkGuestTokenThrottle persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedHashGuestToken.mockReturnValue('token-hash')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('falls back to local throttling when DB update affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'rate-limit-row-1', requests: [] },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'rate_limits') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const headers = { get: vi.fn().mockReturnValue(null) }
    const commonInput = {
      headers,
      rawToken: 'raw-token',
      scope: `guest-token-local-fallback-${Date.now()}`,
      maxAttempts: 1,
      windowMs: 60_000,
    }

    const first = await checkGuestTokenThrottle(commonInput)
    const second = await checkGuestTokenThrottle(commonInput)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
  })

  it('fails closed in production when DB update affects no rows', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'rate-limit-row-1', requests: [] },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'rate_limits') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const headers = { get: vi.fn().mockReturnValue(null) }
    const result = await checkGuestTokenThrottle({
      headers,
      rawToken: 'raw-token',
      scope: `guest-token-production-fail-closed-${Date.now()}`,
      maxAttempts: 8,
      windowMs: 60_000,
    })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSeconds).toBe(60)
  })
})
