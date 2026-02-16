'use server'

import { randomUUID } from 'crypto'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'
import {
  buildBulkSmsDispatchKey,
  normalizeBulkRecipientIds,
  validateBulkSmsRecipientCount
} from '@/lib/sms/bulk-dispatch-key'
import { checkUserPermission } from './rbac'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'

async function ensureBulkRateLimitNotExceeded() {
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'unknown'
  const { NextRequest } = await import('next/server')
  const mockReq = new NextRequest('http://localhost', {
    headers: { 'x-forwarded-for': ip }
  })

  const rateLimitResponse = await rateLimiters.bulk(mockReq)
  if (rateLimitResponse) {
    return 'Too many bulk SMS operations. Please wait before sending more bulk messages.'
  }

  return null
}

export async function enqueueBulkSMSJob(
  customerIds: string[],
  message: string,
  eventId?: string,
  categoryId?: string
) {
  // Check permission
  const hasPermission = await checkUserPermission('messages', 'send')
  if (!hasPermission) {
    return { error: 'Insufficient permissions to send messages' }
  }

  const rateLimitError = await ensureBulkRateLimitNotExceeded()
  if (rateLimitError) {
    return { error: rateLimitError }
  }

  // Get current user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'User not authenticated' }
  }

  try {
    const BATCH_SIZE = 50
    const jobIds: string[] = []
    const normalizedCustomerIds = normalizeBulkRecipientIds(customerIds)

    if (normalizedCustomerIds.length === 0) {
      return { error: 'No valid recipients to queue' }
    }

    const recipientLimitError = validateBulkSmsRecipientCount(normalizedCustomerIds.length)
    if (recipientLimitError) {
      return { error: recipientLimitError }
    }

    // Split normalized recipients into deterministic batches
    for (let i = 0; i < normalizedCustomerIds.length; i += BATCH_SIZE) {
      const batch = normalizedCustomerIds.slice(i, i + BATCH_SIZE)
      const batchIndex = i / BATCH_SIZE
      const uniqueKey = buildBulkSmsDispatchKey({
        customerIds: batch,
        message,
        eventId,
        categoryId,
        batchIndex
      })
      const dispatchId = randomUUID()

      const result = await jobQueue.enqueue(
        'send_bulk_sms',
        {
          customerIds: batch,
          message,
          eventId,
          categoryId,
          jobId: dispatchId
        },
        {
          unique: uniqueKey
        }
      )

      if (!result.success || !result.jobId) {
        return { error: result.error || 'Failed to queue bulk SMS job' }
      }

      jobIds.push(result.jobId)
    }

    return { success: true, jobId: jobIds[0] } // Return first job ID for reference
  } catch (error) {
    logger.error('Error enqueueing bulk SMS job', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        recipientCount: customerIds.length,
        messageLength: typeof message === 'string' ? message.length : null,
        eventId: eventId ?? null,
        categoryId: categoryId ?? null,
      },
    })
    return { error: 'Failed to queue bulk SMS job' }
  }
}
