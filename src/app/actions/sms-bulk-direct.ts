// This file provides a direct send function for bulk SMS that doesn't always queue
// It's a temporary fix for the bulk SMS issue

'use server'

import { jobQueue } from '@/lib/background-jobs'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'
import { checkUserPermission } from './rbac'
import { sendSMS } from '@/lib/twilio'

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
    
    // For smaller batches, send directly
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

    const supabase = await createAdminClient()

    // Get customer details for all provided IDs
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, sms_opt_in')
      .in('id', customerIds)

    if (customerError || !customers || customers.length === 0) {
      return { error: 'No valid customers found' }
    }

    // Get event and category details if provided for personalization
    let eventDetails: { id: string; name: string; date: string; time: string } | null = null
    let categoryDetails: { id: string; name: string } | null = null

    if (eventId) {
      const { data: event } = await supabase
        .from('events')
        .select('id, name, date, time')
        .eq('id', eventId)
        .single()
      eventDetails = event
    }

    if (categoryId) {
      const { data: category } = await supabase
        .from('event_categories')
        .select('id, name')
        .eq('id', categoryId)
        .single()
      categoryDetails = category
    }

    const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'

    // Filter out customers who have not explicitly opted in or lack a mobile number
    const validCustomers = customers.filter(customer => {
      if (!customer.mobile_number) {
        logger.debug('Skipping customer with no mobile number', {
          metadata: { customerId: customer.id }
        })
        return false
      }
      if (customer.sms_opt_in !== true) {
        logger.debug('Skipping customer without SMS opt-in', {
          metadata: { customerId: customer.id }
        })
        return false
      }
      return true
    })

    if (validCustomers.length === 0) {
      return { error: 'No customers with valid mobile numbers and SMS opt-in' }
    }

    const personalizeMessage = (baseMessage: string, customer: (typeof validCustomers)[number]) => {
      const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
      let personalized = baseMessage
      personalized = personalized.replace(/{{customer_name}}/g, fullName || customer.first_name)
      personalized = personalized.replace(/{{first_name}}/g, customer.first_name)
      personalized = personalized.replace(/{{last_name}}/g, customer.last_name || '')
      personalized = personalized.replace(/{{venue_name}}/g, 'The Anchor')
      personalized = personalized.replace(/{{contact_phone}}/g, contactPhone)

      if (eventDetails) {
        personalized = personalized.replace(/{{event_name}}/g, eventDetails.name)
        personalized = personalized.replace(/{{event_date}}/g, new Date(eventDetails.date).toLocaleDateString('en-GB', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }))
        personalized = personalized.replace(/{{event_time}}/g, eventDetails.time)
      }

      if (categoryDetails) {
        personalized = personalized.replace(/{{category_name}}/g, categoryDetails.name)
      }

      return personalized
    }

    const results: Array<{ customerId: string; messageSid: string; success: true }> = []
    const errors: Array<{ customerId: string; error: string }> = []
    const messagesToInsert: Array<Record<string, unknown>> = []

    const concurrency = 5
    const delayBetweenBatchesMs = 500

    for (let i = 0; i < validCustomers.length; i += concurrency) {
      const batch = validCustomers.slice(i, i + concurrency)

      await Promise.all(batch.map(async customer => {
        try {
          const personalizedMessage = personalizeMessage(message, customer)
          const sendResult = await sendSMS(customer.mobile_number as string, personalizedMessage)

          if (!sendResult.success || !sendResult.sid) {
            const errorMessage = sendResult.error || 'Failed to send SMS'
            errors.push({ customerId: customer.id, error: errorMessage })
            return
          }

          const segments = personalizedMessage.length <= 160
            ? 1
            : Math.ceil(personalizedMessage.length / 153)
          const costUsd = segments * 0.04

          const fromNumber = sendResult.fromNumber ?? process.env.TWILIO_PHONE_NUMBER ?? null
          messagesToInsert.push({
            customer_id: customer.id,
            direction: 'outbound',
            message_sid: sendResult.sid,
            twilio_message_sid: sendResult.sid,
            body: personalizedMessage,
            status: 'sent',
            twilio_status: sendResult.status ?? 'queued',
            from_number: fromNumber,
            to_number: customer.mobile_number,
            message_type: 'sms',
            segments,
            cost_usd: costUsd,
            read_at: new Date().toISOString(),
            metadata: {
              bulk_sms: true,
              event_id: eventId,
              category_id: categoryId
            }
          })

          results.push({
            customerId: customer.id,
            messageSid: sendResult.sid,
            success: true
          })
        } catch (error) {
          logger.error('Failed to send SMS to customer', {
            error: error as Error,
            metadata: { customerId: customer.id }
          })
          errors.push({
            customerId: customer.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }))

      if (i + concurrency < validCustomers.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatchesMs))
      }
    }

    // Batch insert all messages to the database
    if (messagesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('messages')
        .insert(messagesToInsert)

      if (insertError) {
        logger.error('Failed to store messages in database', {
          error: insertError,
          metadata: { count: messagesToInsert.length }
        })
        return {
          error: 'Bulk SMS sent but failed to record message history',
          sent: results.length,
          failed: errors.length,
          results,
          loggingError: insertError.message
        }
      }
    }

    logger.info('Bulk SMS sent directly', {
      metadata: {
        total: validCustomers.length,
        success: results.length,
        failed: errors.length
      }
    })

    if (results.length === 0) {
      return { error: 'Failed to send any messages', errors }
    }

    if (errors.length > 0) {
      return {
        success: true,
        sent: results.length,
        failed: errors.length,
        results,
        errors
      }
    }

    return {
      success: true,
      sent: results.length,
      results
    }
  } catch (error) {
    logger.error('Bulk SMS operation failed', {
      error: error as Error
    })
    return { error: 'Failed to send bulk SMS' }
  }
}
