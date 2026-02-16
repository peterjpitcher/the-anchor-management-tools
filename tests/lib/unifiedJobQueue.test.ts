import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const idempotencyMocks = vi.hoisted(() => ({
  mockedClaimIdempotencyKey: vi.fn(),
  mockedReleaseIdempotencyClaim: vi.fn(),
}))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: idempotencyMocks.mockedClaimIdempotencyKey,
  releaseIdempotencyClaim: idempotencyMocks.mockedReleaseIdempotencyClaim,
}))

const bulkMocks = vi.hoisted(() => ({
  mockedSendBulkSms: vi.fn(),
}))
vi.mock('@/lib/sms/bulk', () => ({
  sendBulkSms: bulkMocks.mockedSendBulkSms,
}))

const twilioMocks = vi.hoisted(() => ({
  mockedSendSMS: vi.fn(),
}))
vi.mock('@/lib/twilio', () => ({
  sendSMS: twilioMocks.mockedSendSMS,
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { UnifiedJobQueue } from '@/lib/unified-job-queue'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('UnifiedJobQueue mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idempotencyMocks.mockedClaimIdempotencyKey.mockResolvedValue({ state: 'claimed' })
  })

  it('fails closed when unique job lookup errors before enqueue insert', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'jobs lookup unavailable' },
    })
    const order = vi.fn().mockReturnValue({ limit })
    const contains = vi.fn().mockReturnValue({ order })
    const inStatuses = vi.fn().mockReturnValue({ contains })
    const eqType = vi.fn().mockReturnValue({ in: inStatuses })
    const select = vi.fn().mockReturnValue({ eq: eqType })

    const insert = vi.fn()

    mockedCreateAdminClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select,
          insert,
        }
      }),
    })

    const queue = UnifiedJobQueue.getInstance()
    const result = await queue.enqueue(
      'send_sms',
      { to: '+447700900123', message: 'Hello' },
      { unique: 'dedupe-key-1' }
    )

    expect(result).toEqual({
      success: false,
      error: 'Failed to verify unique job constraint: jobs lookup unavailable',
    })
    expect(insert).not.toHaveBeenCalled()
    expect(idempotencyMocks.mockedReleaseIdempotencyClaim).toHaveBeenCalledTimes(1)
  })

  it('returns existing job id when unique job already exists', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: 'job-existing', status: 'pending' }],
      error: null,
    })
    const order = vi.fn().mockReturnValue({ limit })
    const contains = vi.fn().mockReturnValue({ order })
    const inStatuses = vi.fn().mockReturnValue({ contains })
    const eqType = vi.fn().mockReturnValue({ in: inStatuses })
    const select = vi.fn().mockReturnValue({ eq: eqType })

    const insert = vi.fn()

    mockedCreateAdminClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select,
          insert,
        }
      }),
    })

    const queue = UnifiedJobQueue.getInstance()
    const result = await queue.enqueue(
      'send_sms',
      { to: '+447700900123', message: 'Hello' },
      { unique: 'dedupe-key-2' }
    )

    expect(result).toEqual({ success: true, jobId: 'job-existing' })
    expect(insert).not.toHaveBeenCalled()
    expect(idempotencyMocks.mockedReleaseIdempotencyClaim).toHaveBeenCalledTimes(1)
  })

  it('returns existing job id when enqueue lock is already held (in_progress)', async () => {
    idempotencyMocks.mockedClaimIdempotencyKey.mockResolvedValue({ state: 'in_progress' })

    const limit = vi.fn().mockResolvedValue({
      data: [{ id: 'job-existing', status: 'processing' }],
      error: null,
    })
    const order = vi.fn().mockReturnValue({ limit })
    const contains = vi.fn().mockReturnValue({ order })
    const inStatuses = vi.fn().mockReturnValue({ contains })
    const eqType = vi.fn().mockReturnValue({ in: inStatuses })
    const select = vi.fn().mockReturnValue({ eq: eqType })

    const insert = vi.fn()

    mockedCreateAdminClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select,
          insert,
        }
      }),
    })

    const queue = UnifiedJobQueue.getInstance()
    const result = await queue.enqueue(
      'send_sms',
      { to: '+447700900123', message: 'Hello' },
      { unique: 'dedupe-key-3' }
    )

    expect(result).toEqual({ success: true, jobId: 'job-existing' })
    expect(insert).not.toHaveBeenCalled()
    expect(idempotencyMocks.mockedReleaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('fails closed when enqueue lock is already held and no job row is yet visible', async () => {
    idempotencyMocks.mockedClaimIdempotencyKey.mockResolvedValue({ state: 'in_progress' })

    const limit = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const order = vi.fn().mockReturnValue({ limit })
    const contains = vi.fn().mockReturnValue({ order })
    const inStatuses = vi.fn().mockReturnValue({ contains })
    const eqType = vi.fn().mockReturnValue({ in: inStatuses })
    const select = vi.fn().mockReturnValue({ eq: eqType })

    const insert = vi.fn()

    mockedCreateAdminClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select,
          insert,
        }
      }),
    })

    const queue = UnifiedJobQueue.getInstance()
    const result = await queue.enqueue(
      'send_sms',
      { to: '+447700900123', message: 'Hello' },
      { unique: 'dedupe-key-4' }
    )

    expect(result).toEqual({
      success: false,
      error: 'Job enqueue already in progress; retry shortly',
    })
    expect(insert).not.toHaveBeenCalled()
    expect(idempotencyMocks.mockedReleaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('returns false when status update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateAdminClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const queue = UnifiedJobQueue.getInstance()
    const result = await queue.updateJobStatus('job-1', 'cancelled')

    expect(result).toBe(false)
    expect(eq).toHaveBeenCalledWith('id', 'job-1')
  })

  it('returns true when status update affects one row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateAdminClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const queue = UnifiedJobQueue.getInstance()
    const result = await queue.updateJobStatus('job-1', 'cancelled')

    expect(result).toBe(true)
  })
})

describe('UnifiedJobQueue send_bulk_sms bulkJobId selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers payload.unique_key over payload.jobId when dispatching bulk SMS', async () => {
    bulkMocks.mockedSendBulkSms.mockResolvedValue({
      success: true,
      sent: 0,
      failed: 0,
      total: 0,
      results: [],
    })

    const queue = UnifiedJobQueue.getInstance()
    await (queue as any).executeJob('send_bulk_sms', {
      customerIds: ['cust-1'],
      message: 'Hello',
      unique_key: 'bulk_sms:stable-dispatch-key',
      jobId: 'random-dispatch-id',
      __job_id: 'queue-job-row-id',
    })

    expect(bulkMocks.mockedSendBulkSms).toHaveBeenCalledWith(
      expect.objectContaining({
        bulkJobId: 'bulk_sms:stable-dispatch-key',
      })
    )
  })

  it('treats bulk abort safety failures as fatal errors (to abort further SMS sends)', async () => {
    bulkMocks.mockedSendBulkSms.mockResolvedValue({
      success: false,
      error: 'Bulk SMS aborted due to safety failure (logging_failed): SMS sent but message persistence failed',
    })

    const queue = UnifiedJobQueue.getInstance()
    await expect(
      (queue as any).executeJob('send_bulk_sms', {
        customerIds: ['cust-1'],
        message: 'Hello',
        unique_key: 'bulk_sms:stable-dispatch-key',
        __job_id: 'queue-job-row-id',
      })
    ).rejects.toThrow('Bulk SMS aborted due to safety failure (logging_failed)')
  })
})

describe('UnifiedJobQueue send_sms payload guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when the send_sms payload is missing customer_id', async () => {
    const queue = UnifiedJobQueue.getInstance()

    await expect(
      (queue as any).executeJob('send_sms', {
        to: '+447700900123',
        message: 'Hello',
      })
    ).rejects.toThrow('send_sms job blocked: missing customer_id')
  })

  it('fails closed (fatal) when sendSMS reports outbound message log persistence failure', async () => {
    twilioMocks.mockedSendSMS.mockResolvedValue({
      success: true,
      sid: 'SM-1',
      status: 'queued',
      code: 'logging_failed',
      logFailure: true,
    })

    const queue = UnifiedJobQueue.getInstance()

    await expect(
      (queue as any).executeJob('send_sms', {
        to: '+447700900123',
        message: 'Hello',
        customer_id: 'customer-1',
      })
    ).rejects.toThrow('message persistence failed')
  })

  it('fails closed (fatal) when sendSMS blocks due to safety_unavailable', async () => {
    twilioMocks.mockedSendSMS.mockResolvedValue({
      success: false,
      error: 'SMS sending paused by safety guard',
      code: 'safety_unavailable',
    })

    const queue = UnifiedJobQueue.getInstance()

    await expect(
      (queue as any).executeJob('send_sms', {
        to: '+447700900124',
        message: 'Hello',
        customer_id: 'customer-2',
      })
    ).rejects.toThrow('SMS sending paused by safety guard')
  })
})

describe('UnifiedJobQueue SMS batch abort guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requeues remaining send jobs after a fatal SMS safety failure', async () => {
    mockedCreateAdminClient.mockResolvedValue({})

    const queue = UnifiedJobQueue.getInstance()

    const jobBase = {
      status: 'processing' as const,
      priority: 0,
      attempts: 1,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
      processing_token: 'token-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const claimedJobs = [
      { ...jobBase, id: 'job-1', type: 'send_sms' as const, payload: {} },
      { ...jobBase, id: 'job-2', type: 'send_sms' as const, payload: {} },
    ]

    const resetSpy = vi.spyOn(queue as any, 'resetStaleJobs').mockResolvedValue(undefined)
    const claimSpy = vi.spyOn(queue as any, 'claimJobs').mockResolvedValue(claimedJobs)
    const processSpy = vi
      .spyOn(queue as any, 'processJob')
      .mockResolvedValueOnce({
        ok: false,
        fatalSmsSafetyFailure: true,
        fatalCode: 'logging_failed',
        errorMessage: 'SMS sent but message persistence failed (logging_failed)',
      })
    const requeueSpy = vi.spyOn(queue as any, 'requeueAbortedSendJob').mockResolvedValue(undefined)

    try {
      await queue.processJobs(10)

      expect(processSpy).toHaveBeenCalledTimes(1)
      expect(requeueSpy).toHaveBeenCalledTimes(1)
      expect((requeueSpy.mock.calls[0] as any)?.[1]?.id).toBe('job-2')
      expect((requeueSpy.mock.calls[0] as any)?.[2]?.code).toBe('logging_failed')
    } finally {
      resetSpy.mockRestore()
      claimSpy.mockRestore()
      processSpy.mockRestore()
      requeueSpy.mockRestore()
    }
  })
})

describe('UnifiedJobQueue SMS job state persistence fatal guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats SMS completion persistence failures as fatal logging_failed', async () => {
    const updatePayloads: any[] = []
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null }) // initial lease refresh ok
      .mockResolvedValueOnce({ data: null, error: { message: 'jobs unavailable' } }) // completion persist fails
      .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null }) // failure persistence ok

    const builder: any = {
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      maybeSingle,
    }

    const from = vi.fn(() => ({
      update: vi.fn((payload: any) => {
        updatePayloads.push(payload)
        return builder
      }),
    }))

    mockedCreateAdminClient.mockResolvedValue({ from })

    const queue = UnifiedJobQueue.getInstance()
    ;(queue as any).executeJob = vi.fn().mockResolvedValue({ ok: true })

    const outcome = await (queue as any).processJob({
      id: 'job-1',
      type: 'send_sms',
      payload: { to: '+447700900123', message: 'Hello', customer_id: 'customer-1' },
      status: 'processing',
      priority: 0,
      attempts: 1,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
      processing_token: 'token-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    expect(outcome).toMatchObject({
      ok: false,
      fatalSmsSafetyFailure: true,
      fatalCode: 'logging_failed',
    })

    // Fatal logging_failed disables retries; the failure update should mark the job as failed.
    expect(updatePayloads.some((payload) => payload?.status === 'failed')).toBe(true)
  })

  it('treats SMS failure persistence DB errors as fatal safety_unavailable', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'job-2' }, error: null }) // initial lease refresh ok
      .mockResolvedValueOnce({ data: null, error: { message: 'db down' } }) // failure persistence fails

    const builder: any = {
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      maybeSingle,
    }

    const from = vi.fn(() => ({
      update: vi.fn(() => builder),
    }))

    mockedCreateAdminClient.mockResolvedValue({ from })

    const queue = UnifiedJobQueue.getInstance()
    ;(queue as any).executeJob = vi.fn().mockRejectedValue(new Error('boom'))

    const outcome = await (queue as any).processJob({
      id: 'job-2',
      type: 'send_sms',
      payload: { to: '+447700900124', message: 'Hello', customer_id: 'customer-2' },
      status: 'processing',
      priority: 0,
      attempts: 1,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
      processing_token: 'token-2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    expect(outcome).toMatchObject({
      ok: false,
      fatalSmsSafetyFailure: true,
      fatalCode: 'safety_unavailable',
    })
    expect(outcome.errorMessage).toContain('boom')
    expect(outcome.errorMessage).toContain('Failed to persist job failure state')
  })
})

describe('UnifiedJobQueue lease guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed before executing the job when the lease token cannot be refreshed', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null }) // initial lease refresh fails
      .mockResolvedValueOnce({ data: null, error: null }) // failure persistence (may be skipped)

    const builder: any = {
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      maybeSingle,
    }

    const from = vi.fn(() => ({
      update: vi.fn(() => builder),
    }))

    mockedCreateAdminClient.mockResolvedValue({ from })

    const queue = UnifiedJobQueue.getInstance()
    const executeSpy = vi.fn()
    ;(queue as any).executeJob = executeSpy

    await (queue as any).processJob({
      id: 'job-1',
      type: 'send_bulk_sms',
      payload: {},
      status: 'processing',
      priority: 0,
      attempts: 1,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
      processing_token: 'token-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('aborts job execution when the lease heartbeat fails mid-run', async () => {
    vi.useFakeTimers()

    try {
      const maybeSingle = vi
        .fn()
        .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null }) // initial lease refresh ok
        .mockResolvedValueOnce({ data: null, error: null }) // heartbeat refresh fails (no row updated)
        .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null }) // failure persistence

      const builder: any = {
        eq: vi.fn(() => builder),
        select: vi.fn(() => builder),
        maybeSingle,
      }

      const from = vi.fn(() => ({
        update: vi.fn(() => builder),
      }))

      mockedCreateAdminClient.mockResolvedValue({ from })

      const queue = UnifiedJobQueue.getInstance()
      const executeSpy = vi.fn(() => new Promise(() => {}))
      ;(queue as any).executeJob = executeSpy

      const jobPromise = (queue as any).processJob({
        id: 'job-1',
        type: 'send_bulk_sms',
        payload: {},
        status: 'processing',
        priority: 0,
        attempts: 1,
        max_attempts: 3,
        scheduled_for: new Date().toISOString(),
        processing_token: 'token-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      await vi.advanceTimersByTimeAsync(30000)
      await jobPromise

      expect(executeSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
