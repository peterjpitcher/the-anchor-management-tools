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

const promoContextMocks = vi.hoisted(() => ({
  mockedBackfillSmsPromoContextMessageId: vi.fn(),
}))
vi.mock('@/lib/sms/promo-context', () => ({
  backfillSmsPromoContextMessageId: promoContextMocks.mockedBackfillSmsPromoContextMessageId,
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
    promoContextMocks.mockedBackfillSmsPromoContextMessageId.mockResolvedValue({ skipped: false, updated: 1 })
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

  it('backfills promo context when a deferred marketing SMS job is sent and logged', async () => {
    twilioMocks.mockedSendSMS.mockResolvedValue({
      success: true,
      sid: 'SM-1',
      status: 'sent',
      messageId: 'message-1',
      customerId: 'customer-1',
    })

    const queue = UnifiedJobQueue.getInstance()

    await (queue as any).executeJob('send_sms', {
      to: '+447700900123',
      message: 'Hello',
      customer_id: 'customer-1',
      metadata: {
        event_id: 'event-1',
        template_key: 'event_reminder_promo_3d',
        marketing: true,
        idempotency_key: 'event_reminder_promo_3d_customer-1_event-1',
      },
    })

    expect(promoContextMocks.mockedBackfillSmsPromoContextMessageId).toHaveBeenCalledWith({
      customerId: 'customer-1',
      to: '+447700900123',
      messageId: 'message-1',
      metadata: expect.objectContaining({
        event_id: 'event-1',
        template_key: 'event_reminder_promo_3d',
        marketing: true,
      }),
    })
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

// Receipts background work shares the queue with text messages. A slow call to OpenAI used to be
// able to sit in front of a text, and a classification job that timed out ran on regardless.
describe('UnifiedJobQueue receipts jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const jobBase = {
    status: 'processing' as const,
    priority: 0,
    attempts: 1,
    max_attempts: 3,
    scheduled_for: new Date().toISOString(),
    processing_token: 'token-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    payload: {},
  }

  function claimed() {
    return [
      { ...jobBase, id: 'classify', type: 'classify_receipt_transactions' as const },
      { ...jobBase, id: 'sms', type: 'send_sms' as const },
      { ...jobBase, id: 'batch', type: 'process_receipt_batch' as const },
      { ...jobBase, id: 'other', type: 'send_email' as const },
      { ...jobBase, id: 'suggest', type: 'suggest_receipt_rules' as const },
    ]
  }

  function spies(queue: UnifiedJobQueue, jobs: unknown[]) {
    const order: string[] = []
    const list = [
      vi.spyOn(queue as any, 'resetStaleJobs').mockResolvedValue(undefined),
      vi.spyOn(queue as any, 'claimJobs').mockResolvedValue(jobs),
      vi.spyOn(queue as any, 'processJob').mockImplementation(async (job: any) => {
        order.push(job.id)
        return { ok: true, fatalSmsSafetyFailure: false }
      }),
    ]
    const reschedule = vi.spyOn(queue as any, 'persistJobReschedule').mockResolvedValue(undefined)
    return { order, reschedule, restore: () => [...list, reschedule].forEach((spy) => spy.mockRestore()) }
  }

  it('runs every receipts job after the messages, whatever order they were claimed in', async () => {
    mockedCreateAdminClient.mockResolvedValue({})
    const queue = UnifiedJobQueue.getInstance()
    const { order, reschedule, restore } = spies(queue, claimed())

    try {
      await queue.processJobs(10)

      expect(order.slice(0, 2)).toEqual(['other', 'sms'])
      expect(order.slice(2).sort()).toEqual(['batch', 'classify', 'suggest'])
      expect(reschedule).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('hands receipts jobs back, unstarted, when the run has too little time left for one to finish', async () => {
    mockedCreateAdminClient.mockResolvedValue({})
    const queue = UnifiedJobQueue.getInstance()
    const { order, reschedule, restore } = spies(queue, claimed())

    try {
      // 46 seconds left: less than the 45 second receipts timeout plus its margin.
      await queue.processJobs(10, { deadlineAt: Date.now() + 46_000 })

      // The messages still went.
      expect(order).toEqual(['other', 'sms'])
      expect(reschedule.mock.calls.map((call) => (call[1] as { id: string }).id).sort()).toEqual([
        'batch',
        'classify',
        'suggest',
      ])
      // Handed back to run straight away next time, with the claim's token.
      const [, , token, request] = reschedule.mock.calls[0] as [unknown, unknown, string, { runAt: Date; result: unknown }]
      expect(token).toBe('token-1')
      expect(request.runAt.getTime()).toBeLessThanOrEqual(Date.now())
      expect(request.result).toEqual({ deferred: 'not enough time left in the run' })
    } finally {
      restore()
    }
  })

  it('starts receipts jobs when there is time for them', async () => {
    mockedCreateAdminClient.mockResolvedValue({})
    const queue = UnifiedJobQueue.getInstance()
    const { order, reschedule, restore } = spies(queue, claimed())

    try {
      await queue.processJobs(10, { deadlineAt: Date.now() + 55_000 })

      expect(order).toHaveLength(5)
      expect(reschedule).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('does not count the wait against a job that was handed back', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'classify' }, error: null })
    const builder: any = { eq: vi.fn(() => builder), select: vi.fn(() => builder), maybeSingle }
    const update = vi.fn((_payload: Record<string, unknown>) => builder)
    mockedCreateAdminClient.mockResolvedValue({ from: vi.fn(() => ({ update })) })

    const queue = UnifiedJobQueue.getInstance()
    const resetSpy = vi.spyOn(queue as any, 'resetStaleJobs').mockResolvedValue(undefined)
    const claimSpy = vi
      .spyOn(queue as any, 'claimJobs')
      .mockResolvedValue([{ ...jobBase, id: 'classify', type: 'classify_receipt_transactions' as const, attempts: 2 }])
    const executeSpy = vi.fn()
    const originalExecute = (queue as any).executeJob
    ;(queue as any).executeJob = executeSpy

    try {
      await queue.processJobs(10, { deadlineAt: Date.now() + 1_000 })

      expect(executeSpy).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledTimes(1)
      expect(update.mock.calls[0][0]).toMatchObject({ status: 'pending', attempts: 1, processing_token: null })
      expect(builder.eq).toHaveBeenCalledWith('processing_token', 'token-1')
    } finally {
      ;(queue as any).executeJob = originalExecute
      resetSpy.mockRestore()
      claimSpy.mockRestore()
    }
  })

  it('stops a classification job after 45 seconds and cancels its call to OpenAI', async () => {
    vi.useFakeTimers()

    try {
      const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'classify' }, error: null })
      const builder: any = { eq: vi.fn(() => builder), select: vi.fn(() => builder), maybeSingle }
      mockedCreateAdminClient.mockResolvedValue({ from: vi.fn(() => ({ update: vi.fn(() => builder) })) })

      const queue = UnifiedJobQueue.getInstance()
      let seenSignal: AbortSignal | undefined
      const originalExecute = (queue as any).executeJob
      ;(queue as any).executeJob = vi.fn((_type: string, _payload: unknown, signal: AbortSignal) => {
        seenSignal = signal
        return new Promise(() => {})
      })

      try {
        const jobPromise = (queue as any).processJob({
          ...jobBase,
          id: 'classify',
          type: 'classify_receipt_transactions',
        })

        await vi.advanceTimersByTimeAsync(44_000)
        expect(seenSignal?.aborted).toBe(false)

        await vi.advanceTimersByTimeAsync(1_000)
        const outcome = await jobPromise

        expect(seenSignal?.aborted).toBe(true)
        expect(outcome.ok).toBe(false)
        expect(outcome.errorMessage ?? '').toMatch(/45000ms/)
      } finally {
        ;(queue as any).executeJob = originalExecute
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

const classifierMocks = vi.hoisted(() => ({
  mockedClassify: vi.fn(),
}))
vi.mock('@/lib/receipts/ai-classification', () => ({
  classifyReceiptTransactionsWithAI: classifierMocks.mockedClassify,
}))

describe('UnifiedJobQueue classify_receipt_transactions handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReturnValue({ marker: 'admin' })
  })

  function run(payload: Record<string, unknown>, signal?: AbortSignal) {
    const queue = UnifiedJobQueue.getInstance()
    // From the class, not the instance: earlier tests in this file replace the instance's
    // `executeJob` with a stub and leave it there.
    return (UnifiedJobQueue.prototype as any).executeJob.call(queue, 'classify_receipt_transactions', payload, signal)
  }

  it('passes the cancel signal and the retry flag to the classifier', async () => {
    classifierMocks.mockedClassify.mockResolvedValue({ vendorsWritten: 0 })
    const controller = new AbortController()

    await run({ transactionIds: ['a', '', 'b', 7], retryFinalFailures: true }, controller.signal)

    expect(classifierMocks.mockedClassify).toHaveBeenCalledWith({ marker: 'admin' }, ['a', 'b'], {
      signal: controller.signal,
      retryFinalFailures: true,
    })
  })

  it('does not retry the given-up ones unless the job says so', async () => {
    classifierMocks.mockedClassify.mockResolvedValue({ vendorsWritten: 0 })

    await run({ transactionIds: ['a'], retryFinalFailures: 'yes' })

    expect(classifierMocks.mockedClassify.mock.calls[0][2]).toMatchObject({ retryFinalFailures: false })
  })

  it('skips a job with no transactions without calling the classifier', async () => {
    expect(await run({ transactionIds: [] })).toEqual({ skipped: true })
    expect(await run({})).toEqual({ skipped: true })
    expect(classifierMocks.mockedClassify).not.toHaveBeenCalled()
  })

  it('queues rule suggestions once a day when vendors were written, below messages', async () => {
    classifierMocks.mockedClassify.mockResolvedValue({ vendorsWritten: 2 })
    const queue = UnifiedJobQueue.getInstance()
    const enqueueSpy = vi.spyOn(queue, 'enqueue').mockResolvedValue({ success: true } as never)

    try {
      const summary = await run({ transactionIds: ['a'] })

      expect(summary).toEqual({ vendorsWritten: 2 })
      expect(enqueueSpy).toHaveBeenCalledTimes(1)
      const [type, payload, options] = enqueueSpy.mock.calls[0]
      expect(type).toBe('suggest_receipt_rules')
      expect(payload).toEqual({})
      expect(options).toMatchObject({ priority: -10 })
      expect(String(options?.unique)).toMatch(/^receipts:suggest_receipt_rules:\d{4}-\d{2}-\d{2}$/)
    } finally {
      enqueueSpy.mockRestore()
    }
  })

  it('queues nothing more when no vendor was written', async () => {
    classifierMocks.mockedClassify.mockResolvedValue({ vendorsWritten: 0 })
    const queue = UnifiedJobQueue.getInstance()
    const enqueueSpy = vi.spyOn(queue, 'enqueue').mockResolvedValue({ success: true } as never)

    try {
      await run({ transactionIds: ['a'] })
      expect(enqueueSpy).not.toHaveBeenCalled()
    } finally {
      enqueueSpy.mockRestore()
    }
  })

  it('lets a failed classification throw, so the queue retries it', async () => {
    classifierMocks.mockedClassify.mockRejectedValue(new Error('OpenAI returned 503'))

    await expect(run({ transactionIds: ['a'] })).rejects.toThrow('OpenAI returned 503')
  })
})
