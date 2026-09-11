import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const runMock = vi.hoisted(() => vi.fn(async () => ({ outcome: 'sent', deliveryId: 'delivery-1', scheduledFor: null })))
vi.mock('@/lib/notifications/delayed-fallback/run', () => ({
  runDelayedFallbackJob: runMock,
}))

import { UnifiedJobQueue } from '@/lib/unified-job-queue'

describe('notification_delayed_fallback job type', () => {
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
})
