// This file provides a direct send function for bulk SMS that doesn't always queue
// It's a temporary fix for the bulk SMS issue

'use server'

import { jobQueue } from '@/lib/background-jobs'
import { logger } from '@/lib/logger'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'
import { checkUserPermission } from './rbac'
import { sendBulkSms } from '@/lib/sms/bulk'

// This is the corrected bulk SMS function that sends directly for small batches
export async function sendBulkSMSDirect(customerIds: string[], message: string, eventId?: string, categoryId?: string) {
  try {
    const hasPermission = await checkUserPermission('messages', 'send')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to send messages' }
    }

    // Increased threshold from 50 to 100 for better performance
    // Queue for very large batches to avoid timeouts
    if (customerIds.length > 100) {
      await jobQueue.enqueue('send_bulk_sms', {
        customerIds,
        message,
        eventId,
        categoryId
      }, {
        priority: 10 // High priority for bulk operations
      })
      
      logger.info('Bulk SMS job queued for large batch', { 
        metadata: { badge: customerIds.length } 
      })
      
      return { 
        success: true, 
        message: `Queued SMS for ${customerIds.length} customers. Messages will be sent within the next few minutes.` 
      }
    }
    
    // For smaller batches, send directly via shared bulk helper
    return await sendBulkSMSImmediate(customerIds, message, eventId, categoryId)
    
  } catch (error) {
    logger.error('Failed to process bulk SMS', { 
      error: error as Error,
      metadata: { badge: customerIds.length }
    })
    return { error: 'Failed to process bulk SMS' }
  }
}

// Send bulk SMS immediately (for small/medium batches)
async function sendBulkSMSImmediate(customerIds: string[], message: string, eventId?: string, categoryId?: string) {
  try {
    // Apply rate limiting
    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'unknown'
    const { NextRequest } = await import('next/server')
    const mockReq = new NextRequest('http://localhost', {
      headers: { 'x-forwarded-for': ip }
    })

    const rateLimitResponse = await rateLimiters.bulk(mockReq)
    if (rateLimitResponse) {
      return { error: 'Too many bulk SMS operations. Please wait before sending more bulk messages.' }
    }

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
      bulkJobId: 'direct'
    })

    if (!result.success) {
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
