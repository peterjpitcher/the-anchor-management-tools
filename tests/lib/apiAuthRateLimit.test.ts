import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit } from '@/lib/api/auth'

describe('api auth rate limit fail-closed behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns null when rate-limit lookup fails so callers can fail closed', async () => {
    const gte = vi.fn().mockResolvedValue({
      count: null,
      error: { message: 'rate-limit lookup unavailable' },
    })
    const eq = vi.fn().mockReturnValue({ gte })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({ from })

    const result = await checkRateLimit('api-key-1', 10)

    expect(from).toHaveBeenCalledWith('api_usage')
    expect(result).toBeNull()
  })

  it('returns true when usage is below the configured limit', async () => {
    const gte = vi.fn().mockResolvedValue({
      count: 3,
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ gte })
    const select = vi.fn().mockReturnValue({ eq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    })

    const result = await checkRateLimit('api-key-2', 10)

    expect(result).toBe(true)
  })

  it('returns false when usage is at or above the configured limit', async () => {
    const gte = vi.fn().mockResolvedValue({
      count: 10,
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ gte })
    const select = vi.fn().mockReturnValue({ eq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    })

    const result = await checkRateLimit('api-key-3', 10)

    expect(result).toBe(false)
  })
})

