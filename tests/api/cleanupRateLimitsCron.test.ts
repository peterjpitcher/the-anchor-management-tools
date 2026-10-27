import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The daily cleanup cron also clears stored booking answers past their expiry (BK-189, customer
 * bookings review of 24 October 2026), which were never removed.
 */

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/rate-limiter', () => ({ cleanupRateLimits: vi.fn(async () => ({ removed: 0, remaining: 0 })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ __brand: 'admin' })) }))
const deleteExpiredIdempotencyKeys = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/idempotency', () => ({ deleteExpiredIdempotencyKeys }))
const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error } }))

import { GET } from '@/app/api/cron/cleanup-rate-limits/route'

describe('GET /api/cron/cleanup-rate-limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes expired idempotency rows and reports how many', async () => {
    deleteExpiredIdempotencyKeys.mockResolvedValue(4631)

    const response = await GET(new Request('http://localhost/api/cron/cleanup-rate-limits'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, expired_idempotency_keys_deleted: 4631 })
    expect(deleteExpiredIdempotencyKeys).toHaveBeenCalledWith({ __brand: 'admin' })
  })

  it('answers 500 and logs an error when the delete fails, so the cron run is seen to fail', async () => {
    deleteExpiredIdempotencyKeys.mockRejectedValue(new Error('permission denied'))

    const response = await GET(new Request('http://localhost/api/cron/cleanup-rate-limits'))

    expect(response.status).toBe(500)
    expect(error).toHaveBeenCalledWith('Error cleaning up rate limits and expired idempotency keys', expect.anything())
  })
})
