import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimiters: {
    bulk: vi.fn(),
  },
}))

import { jobQueue } from '@/lib/unified-job-queue'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'

describe('job queue bulk SMS action guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(headers as unknown as vi.Mock).mockResolvedValue({
      get: vi.fn().mockReturnValue(null),
    })
    ;(rateLimiters.bulk as unknown as vi.Mock).mockResolvedValue(null)
    ;(createClient as unknown as vi.Mock).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: 'user-1' },
          },
        }),
      },
    })
    ;(jobQueue.enqueue as unknown as vi.Mock).mockResolvedValue({
      success: true,
      jobId: 'job-1',
    })
  })

  it('normalizes recipients before batching to keep queue dedupe deterministic', async () => {
    const result = await enqueueBulkSMSJob(
      ['customer-b', 'customer-a', 'customer-a', 'customer-c'],
      'Hello from Anchor'
    )

    expect(result).toEqual({ success: true, jobId: 'job-1' })
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1)
    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      'send_bulk_sms',
      expect.objectContaining({
        customerIds: ['customer-a', 'customer-b', 'customer-c'],
      }),
      expect.objectContaining({
        unique: expect.stringMatching(/^bulk_sms:/),
      })
    )
  })

  it('returns an error when recipient input normalizes to an empty set', async () => {
    const result = await enqueueBulkSMSJob(['', '', ''], 'Hello from Anchor')

    expect(result).toEqual({ error: 'No valid recipients to queue' })
    expect(jobQueue.enqueue).not.toHaveBeenCalled()
  })

  it('returns a rate-limit error when bulk limiter blocks the request', async () => {
    ;(rateLimiters.bulk as unknown as vi.Mock).mockResolvedValue(new Response('limited', { status: 429 }))

    const result = await enqueueBulkSMSJob(['customer-1'], 'Hello from Anchor')

    expect(result).toEqual({
      error: 'Too many bulk SMS operations. Please wait before sending more bulk messages.',
    })
    expect(jobQueue.enqueue).not.toHaveBeenCalled()
  })

  it('rejects requests above the configured bulk recipient cap', async () => {
    const previousLimit = process.env.BULK_SMS_MAX_RECIPIENTS
    process.env.BULK_SMS_MAX_RECIPIENTS = '2'

    try {
      const result = await enqueueBulkSMSJob(['customer-1', 'customer-2', 'customer-3'], 'Hello from Anchor')

      expect(result).toEqual({
        error: 'Bulk SMS recipient limit exceeded (3/2). Split this send into smaller batches.',
      })
      expect(jobQueue.enqueue).not.toHaveBeenCalled()
    } finally {
      if (previousLimit === undefined) {
        delete process.env.BULK_SMS_MAX_RECIPIENTS
      } else {
        process.env.BULK_SMS_MAX_RECIPIENTS = previousLimit
      }
    }
  })
})
