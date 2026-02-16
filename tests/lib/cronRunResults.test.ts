import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { logger } from '@/lib/logger'
import { persistCronRunResult, recoverCronRunLock } from '@/lib/cron-run-results'

describe('cron run result persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns updated when cron run row is persisted', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'run-1' },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    }

    const result = await persistCronRunResult(supabase as any, {
      runId: 'run-1',
      status: 'completed',
      context: 'parking-notifications',
    })

    expect(result).toBe('updated')
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('returns missing when cron run update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    }

    const result = await persistCronRunResult(supabase as any, {
      runId: 'run-2',
      status: 'failed',
      errorMessage: 'test failure',
      context: 'private-booking-monitor',
    })

    expect(result).toBe('missing')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('returns error when cron run update returns database error', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db unavailable' },
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    }

    const result = await persistCronRunResult(supabase as any, {
      runId: 'run-3',
      status: 'completed',
      context: 'private-booking-monitor',
    })

    expect(result).toBe('error')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('acquires a replacement cron lock when insert succeeds', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'run-new' },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    }

    const result = await recoverCronRunLock(supabase as any, {
      jobName: 'sunday-preorder',
      runKey: '2026-02-14T10:15',
      nowIso: '2026-02-14T10:15:00.000Z',
      context: 'sunday-preorder',
      isRunStale: () => false,
    })

    expect(result).toEqual({ result: 'acquired', runId: 'run-new' })
  })

  it('returns already_running when recovery insert conflicts and existing run is active', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505' },
    })
    const insertSelect = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'run-existing', status: 'running', started_at: new Date().toISOString() },
      error: null,
    })
    const eqRunKey = vi.fn().mockReturnValue({ maybeSingle })
    const eqJobName = vi.fn().mockReturnValue({ eq: eqRunKey })
    const select = vi.fn().mockReturnValue({ eq: eqJobName })

    const supabase = {
      from: vi.fn().mockReturnValue({ insert, select }),
    }

    const result = await recoverCronRunLock(supabase as any, {
      jobName: 'parking-notifications',
      runKey: '2026-02-14T10:15',
      nowIso: '2026-02-14T10:15:00.000Z',
      context: 'parking-notifications',
      isRunStale: () => false,
    })

    expect(result).toEqual({ result: 'already_running', runId: 'run-existing' })
  })

  it('returns missing when recovery conflict lookup finds no run row', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505' },
    })
    const insertSelect = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const eqRunKey = vi.fn().mockReturnValue({ maybeSingle })
    const eqJobName = vi.fn().mockReturnValue({ eq: eqRunKey })
    const select = vi.fn().mockReturnValue({ eq: eqJobName })

    const supabase = {
      from: vi.fn().mockReturnValue({ insert, select }),
    }

    const result = await recoverCronRunLock(supabase as any, {
      jobName: 'event-guest-engagement',
      runKey: '2026-02-14T10:15',
      nowIso: '2026-02-14T10:15:00.000Z',
      context: 'event-guest-engagement',
      isRunStale: () => false,
    })

    expect(result).toEqual({ result: 'missing', runId: null })
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
