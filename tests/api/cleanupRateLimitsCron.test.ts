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
const deleteOldCronJobRuns = vi.hoisted(() => vi.fn())
vi.mock('@/lib/cron/cron-run-retention', () => ({ deleteOldCronJobRuns }))
const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error } }))

import { GET } from '@/app/api/cron/cleanup-rate-limits/route'

describe('GET /api/cron/cleanup-rate-limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteOldCronJobRuns.mockResolvedValue({ deleted: 0, complete: true, cutoff: '2026-08-20T00:00:00.000Z' })
  })

  it('deletes expired idempotency rows and reports how many', async () => {
    deleteExpiredIdempotencyKeys.mockResolvedValue(4631)

    const response = await GET(new Request('http://localhost/api/cron/cleanup-rate-limits'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, expired_idempotency_keys_deleted: 4631 })
    expect(deleteExpiredIdempotencyKeys).toHaveBeenCalledWith({ __brand: 'admin' })
  })

  it('deletes old cron run records with the admin client and a deadline, and reports how many', async () => {
    deleteExpiredIdempotencyKeys.mockResolvedValue(0)
    deleteOldCronJobRuns.mockResolvedValue({ deleted: 43196, complete: true, cutoff: '2026-08-20T00:00:00.000Z' })

    const response = await GET(new Request('http://localhost/api/cron/cleanup-rate-limits'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, old_cron_runs_deleted: 43196, old_cron_runs_complete: true })
    expect(deleteOldCronJobRuns).toHaveBeenCalledWith({ __brand: 'admin' }, { deadlineMs: expect.any(Number) })
  })

  it('answers 500 and logs an error when the cron run retention fails', async () => {
    deleteExpiredIdempotencyKeys.mockResolvedValue(0)
    deleteOldCronJobRuns.mockRejectedValue(new Error('Could not delete old cron run records: timeout'))

    const response = await GET(new Request('http://localhost/api/cron/cleanup-rate-limits'))

    expect(response.status).toBe(500)
    expect(error).toHaveBeenCalledWith(
      'Error cleaning up rate limits, expired idempotency keys and old cron run records',
      expect.anything(),
    )
  })

  it('answers 500 and logs an error when the delete fails, so the cron run is seen to fail', async () => {
    deleteExpiredIdempotencyKeys.mockRejectedValue(new Error('permission denied'))

    const response = await GET(new Request('http://localhost/api/cron/cleanup-rate-limits'))

    expect(response.status).toBe(500)
    expect(error).toHaveBeenCalledWith('Error cleaning up rate limits, expired idempotency keys and old cron run records', expect.anything())
  })
})
