import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const runMock = vi.hoisted(() => vi.fn(async (): Promise<Record<string, unknown>> => ({ outcome: 'sent', deliveryId: 'delivery-1', scheduledFor: null })))
vi.mock('@/lib/notifications/delayed-fallback/run', () => ({
  runDelayedFallbackJob: runMock,
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { JobReschedule, UnifiedJobQueue } from '@/lib/unified-job-queue'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const DEFERRED = { outcome: 'deferred', deliveryId: 'delivery-1', runAt: '2026-09-21T08:00:00.000Z' }

function processingJob() {
  return {
    id: 'job-1',
    type: 'notification_delayed_fallback',
    payload: { deliveryId: 'delivery-1', trigger_event: 'email.bounced', unique_key: 'notification_delayed_fallback:delivery-1' },
    status: 'processing',
    priority: 0,
    attempts: 1,
    max_attempts: 3,
    scheduled_for: '2026-09-20T21:30:00.000Z',
    processing_token: 'token-1',
    created_at: '2026-09-20T21:30:00.000Z',
    updated_at: '2026-09-20T21:30:00.000Z',
  }
}

/** A jobs table stand-in that records every update and the filters it was scoped by. */
function fakeJobsTable(results: Array<{ data: unknown; error: unknown }>) {
  const updates: Array<Record<string, unknown>> = []
  const filters: Array<[string, unknown]> = []
  const maybeSingle = vi.fn()
  for (const result of results) maybeSingle.mockResolvedValueOnce(result)
  const builder: any = {
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      return builder
    }),
    select: vi.fn(() => builder),
    maybeSingle,
  }
  const from = vi.fn(() => ({
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload)
      return builder
    }),
  }))
  mockedCreateAdminClient.mockResolvedValue({ from })
  return { updates, filters }
}

describe('notification_delayed_fallback job type', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches to the delayed fallback runner with the delivery id', async () => {
    const queue = UnifiedJobQueue.getInstance()

    const result = await (queue as any).executeJob('notification_delayed_fallback', {
      deliveryId: 'delivery-1',
      trigger_event: 'email.bounced',
      __job_id: 'job-1',
    })

    expect(runMock).toHaveBeenCalledWith({ deliveryId: 'delivery-1' })
    expect(result).toEqual({ outcome: 'sent', deliveryId: 'delivery-1', scheduledFor: null })
  })

  it('turns a job that has to wait for the morning into a reschedule for that time', async () => {
    runMock.mockResolvedValueOnce(DEFERRED)
    const queue = UnifiedJobQueue.getInstance()

    const result = await (queue as any).executeJob('notification_delayed_fallback', { deliveryId: 'delivery-1', __job_id: 'job-1' })

    expect(result).toBeInstanceOf(JobReschedule)
    expect(result.runAt.toISOString()).toBe('2026-09-21T08:00:00.000Z')
    expect(result.result).toEqual(DEFERRED)
  })

  it('puts the same row back to pending at that time, unclaimed, without using up an attempt', async () => {
    runMock.mockResolvedValueOnce(DEFERRED)
    const { updates, filters } = fakeJobsTable([
      { data: { id: 'job-1' }, error: null }, // lease refresh
      { data: { id: 'job-1' }, error: null }, // reschedule
    ])
    const queue = UnifiedJobQueue.getInstance()

    const outcome = await (queue as any).processJob(processingJob())

    expect(outcome).toEqual({ ok: true, fatalSmsSafetyFailure: false })
    const reschedule = updates.find((update) => update.status === 'pending')
    expect(reschedule).toMatchObject({
      status: 'pending',
      scheduled_for: '2026-09-21T08:00:00.000Z',
      attempts: 0,
      started_at: null,
      processing_token: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
      error_message: null,
      result: DEFERRED,
    })
    // Scoped to this row and this worker's claim, and never marked completed.
    expect(filters).toContainEqual(['id', 'job-1'])
    expect(filters).toContainEqual(['processing_token', 'token-1'])
    expect(updates.some((update) => update.status === 'completed')).toBe(false)
  })

  it('retries with backoff, as for any failed attempt, when the reschedule cannot be written', async () => {
    runMock.mockResolvedValueOnce(DEFERRED)
    const { updates } = fakeJobsTable([
      { data: { id: 'job-1' }, error: null }, // lease refresh
      { data: null, error: { message: 'jobs unavailable' } }, // reschedule fails
      { data: { id: 'job-1' }, error: null }, // failure persisted
    ])
    const queue = UnifiedJobQueue.getInstance()

    const outcome = await (queue as any).processJob(processingJob())

    expect(outcome).toMatchObject({ ok: false, fatalSmsSafetyFailure: false })
    expect(outcome.errorMessage).toContain('Failed to reschedule job')
    const failure = updates[updates.length - 1]
    expect(failure).toMatchObject({ status: 'pending', error_message: expect.stringContaining('Failed to reschedule job') })
    expect(updates.some((update) => update.status === 'completed')).toBe(false)
  })

  it('finishes a job that did not ask to wait exactly as before', async () => {
    const { updates } = fakeJobsTable([
      { data: { id: 'job-1' }, error: null }, // lease refresh
      { data: { id: 'job-1' }, error: null }, // completion
    ])
    const queue = UnifiedJobQueue.getInstance()

    const outcome = await (queue as any).processJob(processingJob())

    expect(outcome).toEqual({ ok: true, fatalSmsSafetyFailure: false })
    expect(updates.find((update) => update.status === 'completed')).toMatchObject({
      status: 'completed',
      result: { outcome: 'sent', deliveryId: 'delivery-1', scheduledFor: null },
    })
    expect(updates.some((update) => update.status === 'pending')).toBe(false)
  })
})
