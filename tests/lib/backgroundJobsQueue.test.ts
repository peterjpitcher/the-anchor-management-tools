import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { JobQueue } from '@/lib/background-jobs'

describe('Legacy background JobQueue race guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when send_sms payload is missing customer_id', async () => {
    const queue = JobQueue.getInstance() as any

    await expect(
      queue.processSendSms({
        to: '+447700900123',
        message: 'Hello',
      })
    ).rejects.toThrow('send_sms job blocked: missing customer_id')
  })

  it('fails closed when outbound message log persistence fails after transport send', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM-1',
      status: 'queued',
      code: 'logging_failed',
      logFailure: true,
    })

    const queue = JobQueue.getInstance() as any

    await expect(
      queue.processSendSms({
        to: '+447700900124',
        message: 'Hello',
        customer_id: 'customer-1',
      })
    ).rejects.toThrow('message persistence failed')
  })

  it('treats suppressed_duplicate results as success when sendSMS returns success but no SID', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: null,
      status: 'suppressed_duplicate',
      suppressed: true,
    })

    const queue = JobQueue.getInstance() as any

    await expect(
      queue.processSendSms({
        to: '+447700900125',
        message: 'Hello',
        customer_id: 'customer-1',
      })
    ).resolves.toMatchObject({
      success: true,
      sid: null,
      suppressed: true,
    })
  })

  it('treats deferred results as success when sendSMS returns success but no SID', async () => {
    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: null,
      status: 'scheduled',
      deferred: true,
      scheduledFor: '2026-02-15T12:00:00.000Z',
    })

    const queue = JobQueue.getInstance() as any

    await expect(
      queue.processSendSms({
        to: '+447700900126',
        message: 'Hello',
        customer_id: 'customer-1',
      })
    ).resolves.toMatchObject({
      success: true,
      sid: null,
      deferred: true,
      scheduledFor: '2026-02-15T12:00:00.000Z',
    })
  })

  it('skips execution when pending claim affects no rows', async () => {
    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimEqStatus = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })
    const update = vi.fn().mockReturnValue({ eq: claimEqId })

    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return { update }
      }),
    }

    ;(createAdminClient as unknown as vi.Mock).mockResolvedValue(client)

    const queue = JobQueue.getInstance() as any
    const executeJobSpy = vi.fn().mockResolvedValue({ success: true })
    queue.executeJob = executeJobSpy

    await queue.processJob({
      id: 'job-1',
      type: 'send_sms',
      payload: {},
      attempts: 0,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
    })

    expect(claimEqId).toHaveBeenCalledWith('id', 'job-1')
    expect(claimEqStatus).toHaveBeenCalledWith('status', 'pending')
    expect(executeJobSpy).not.toHaveBeenCalled()
  })

  it('applies processing-status guard when persisting failure state', async () => {
    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'job-2' }, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimEqStatus = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })

    const failMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'job-2' }, error: null })
    const failSelect = vi.fn().mockReturnValue({ maybeSingle: failMaybeSingle })
    const failEqStatus = vi.fn().mockReturnValue({ select: failSelect })
    const failEqId = vi.fn().mockReturnValue({ eq: failEqStatus })

    const update = vi
      .fn()
      .mockReturnValueOnce({ eq: claimEqId })
      .mockReturnValueOnce({ eq: failEqId })

    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'jobs') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return { update }
      }),
    }

    ;(createAdminClient as unknown as vi.Mock).mockResolvedValue(client)

    const queue = JobQueue.getInstance() as any
    queue.executeJob = vi.fn().mockRejectedValue(new Error('boom'))

    await queue.processJob({
      id: 'job-2',
      type: 'send_sms',
      payload: {},
      attempts: 0,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
    })

    expect(claimEqStatus).toHaveBeenCalledWith('status', 'pending')
    expect(failEqStatus).toHaveBeenCalledWith('status', 'processing')
  })
})
