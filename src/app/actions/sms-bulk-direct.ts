// This file provides a direct send function for bulk SMS that doesn't always queue
// It's a temporary fix for the bulk SMS issue

'use server'

import { randomUUID } from 'crypto'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'
import {
  buildBulkSmsDispatchKey,
  normalizeBulkRecipientIds,
  validateBulkSmsRecipientCount
} from '@/lib/sms/bulk-dispatch-key'
import { checkUserPermission } from './rbac'
import { sendBulkSms } from '@/lib/sms/bulk'

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

function extractBulkSafetyAbortCode(errorMessage: string): string | null {
  const match = errorMessage.match(/Bulk SMS aborted due to safety failure \(([^)]+)\):/)
  return match?.[1] ?? null
}

// This is the corrected bulk SMS function that sends directly for small batches
export async function sendBulkSMSDirect(customerIds: string[], message: string, eventId?: string, categoryId?: string) {
  try {
    const hasPermission = await checkUserPermission('messages', 'send')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to send messages' }
    }

    const rateLimitError = await ensureBulkRateLimitNotExceeded()
    if (rateLimitError) {
      return { error: rateLimitError }
    }

    const normalizedCustomerIds = normalizeBulkRecipientIds(customerIds)
    if (normalizedCustomerIds.length === 0) {
      return { error: 'No valid recipients to send' }
    }

    const recipientLimitError = validateBulkSmsRecipientCount(normalizedCustomerIds.length)
    if (recipientLimitError) {
      return { error: recipientLimitError }
    }

    const dispatchKey = buildBulkSmsDispatchKey({
      customerIds: normalizedCustomerIds,
      message,
      eventId,
      categoryId
    })

    // Increased threshold from 50 to 100 for better performance
    // Queue for very large batches to avoid timeouts
    if (normalizedCustomerIds.length > 100) {
      const dispatchId = randomUUID()

      const enqueueResult = await jobQueue.enqueue('send_bulk_sms', {
        customerIds: normalizedCustomerIds,
        message,
        eventId,
        categoryId,
        jobId: dispatchId
      }, {
        priority: 10, // High priority for bulk operations
        unique: dispatchKey
      })

      if (!enqueueResult.success) {
        return { error: enqueueResult.error || 'Failed to queue SMS job' }
      }
      
      logger.info('Bulk SMS job queued for large batch', { 
        metadata: { badge: normalizedCustomerIds.length } 
      })
      
      return { 
        success: true, 
        message: `Queued SMS for ${normalizedCustomerIds.length} customers. Messages will be sent within the next few minutes.` 
      }
    }
    
    // For smaller batches, send directly via shared bulk helper
    return await sendBulkSMSImmediate(normalizedCustomerIds, message, dispatchKey, eventId, categoryId)
    
  } catch (error) {
    logger.error('Failed to process bulk SMS', { 
      error: error as Error,
      metadata: { badge: customerIds.length }
    })
    return { error: 'Failed to process bulk SMS' }
  }
}

// Send bulk SMS immediately (for small/medium batches)
async function sendBulkSMSImmediate(
  customerIds: string[],
  message: string,
  bulkJobId: string,
  eventId?: string,
  categoryId?: string
) {
  try {
    // Check for essential Twilio credentials
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      logger.warn('Skipping SMS send - Twilio Account SID or Auth Token not configured')
      return { error: 'SMS service not configured' }
    }
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      logger.warn('Skipping SMS send - No Twilio sender configured')
      return { error: 'SMS service not configured' }
    }

    const result = await sendBulkSms({
      customerIds,
      message,
      eventId,
      categoryId,
      bulkJobId
    })

    if (!result.success) {
      const abortCode = extractBulkSafetyAbortCode(result.error)
      if (abortCode === 'logging_failed') {
        // Fail-safe: some messages may have been sent but outbound logging failed, so we must not
        // encourage retries that could amplify duplicate sends under degraded persistence.
        return {
          success: true,
          message:
            'Bulk SMS aborted because outbound message logging failed after sends may have occurred. Do not retry; please refresh and contact engineering.',
          code: abortCode,
          logFailure: true,
        }
      }
      return { error: result.error }
    }

    if (result.errors && result.errors.length > 0) {
      return {
        success: true,
        sent: result.sent,
        failed: result.failed,
        results: result.results,
        errors: result.errors
      }
    }

    return {
      success: true,
      sent: result.sent,
      results: result.results
    }
  } catch (error) {
    logger.error('Bulk SMS operation failed', {
      error: error as Error
    })
    return { error: 'Failed to send bulk SMS' }
  }
}
