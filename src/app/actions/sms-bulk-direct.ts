// This file provides a direct send function for bulk SMS that doesn't always queue
// It's a temporary fix for the bulk SMS issue

'use server'

import { jobQueue } from '@/lib/background-jobs'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { headers } from 'next/headers'
import { rateLimiters } from '@/lib/rate-limit'

interface TwilioMessageCreateParams {
  body: string
  to: string
  from?: string
  messagingServiceSid?: string
}

// This is the corrected bulk SMS function that sends directly for small batches
export async function sendBulkSMSDirect(customerIds: string[], message: string) {
  try {
    // For large batches (>50), queue as a job
    if (customerIds.length > 50) {
      await jobQueue.enqueue('send_bulk_sms', {
        customerIds,
        message
      }, {
        priority: 5 // Medium priority for bulk operations
      })
      
      logger.info('Bulk SMS job queued for large batch', { 
        metadata: { badge: customerIds.length } 
      })
      
      return { 
        success: true, 
        message: `Queued SMS for ${customerIds.length} customers` 
      }
    }
    
    // For small batches, send directly
    return await sendBulkSMSImmediate(customerIds, message)
    
  } catch (error) {
    logger.error('Failed to process bulk SMS', { 
      error: error as Error,
      metadata: { badge: customerIds.length }
    })
    return { error: 'Failed to process bulk SMS' }
  }
}

// Send bulk SMS immediately (for small batches)
async function sendBulkSMSImmediate(customerIds: string[], message: string) {
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
      console.log('Skipping SMS - Twilio Account SID or Auth Token not configured')
      return { error: 'SMS service not configured' }
    }
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      console.log('Skipping SMS - Neither Twilio Phone Number nor Messaging Service SID is configured')
      return { error: 'SMS service not configured' }
    }

    const supabase = await createAdminClient()

    // Get customer details for all provided IDs
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .in('id', customerIds)

    if (customerError || !customers || customers.length === 0) {
      return { error: 'No valid customers found' }
    }

    // Filter out customers who have opted out or have no mobile number
    const validCustomers = customers.filter(customer => {
      if (customer.sms_opt_in === false) {
        console.log('Skipping customer - opted out of SMS')
        return false
      }
      if (!customer.mobile_number) {
        console.log('Skipping customer - no mobile number')
        return false
      }
      return true
    })

    if (validCustomers.length === 0) {
      return { error: 'No customers with valid mobile numbers and SMS opt-in' }
    }

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    // Calculate segments for cost estimation
    const messageLength = message.length
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
    const costUsd = segments * 0.04 // Approximate UK SMS cost per segment

    // Send SMS to each valid customer
    const results = []
    const errors = []
    const messagesToInsert = []

    for (const customer of validCustomers) {
      try {
        // Prepare message parameters
        const messageParams: TwilioMessageCreateParams = {
          body: message,
          to: customer.mobile_number,
        }

        if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
          messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
        } else if (process.env.TWILIO_PHONE_NUMBER) {
          messageParams.from = process.env.TWILIO_PHONE_NUMBER
        }

        // Send the SMS
        const twilioMessage = await twilioClientInstance.messages.create(messageParams)
        
        console.log('Bulk SMS sent successfully to', customer.mobile_number)

        // Collect message data for batch insert
        messagesToInsert.push({
          customer_id: customer.id,
          direction: 'outbound' as const,
          message_sid: twilioMessage.sid,
          twilio_message_sid: twilioMessage.sid,
          body: message,
          status: twilioMessage.status,
          twilio_status: 'queued' as const,
          from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
          to_number: twilioMessage.to,
          message_type: 'sms' as const,
          segments: segments,
          cost_usd: costUsd,
          read_at: new Date().toISOString() // Mark as read since it's outbound
        })

        results.push({
          customerId: customer.id,
          messageSid: twilioMessage.sid,
          success: true
        })
      } catch (error) {
        console.error('Failed to send SMS to customer:', error)
        errors.push({
          customerId: customer.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // Batch insert all messages to the database
    if (messagesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('messages')
        .insert(messagesToInsert)

      if (insertError) {
        console.error('Failed to store messages in database:', insertError)
        // Continue anyway - SMS were sent successfully
      }
    }

    logger.info('Bulk SMS sent directly', {
      metadata: {
        total: validCustomers.length,
        success: results.length,
        failed: errors.length
      }
    })

    if (errors.length > 0 && results.length === 0) {
      return { error: 'Failed to send any messages', errors }
    } else if (errors.length > 0) {
      return { 
        success: true,
        sent: results.length, 
        failed: errors.length,
        results,
        errors
      }
    } else {
      return { 
        success: true,
        sent: results.length,
        results
      }
    }
  } catch (error) {
    logger.error('Bulk SMS operation failed', { 
      error: error as Error 
    })
    return { error: 'Failed to send bulk SMS' }
  }
}