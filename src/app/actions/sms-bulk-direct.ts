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
export async function sendBulkSMSDirect(customerIds: string[], message: string, eventId?: string, categoryId?: string) {
  try {
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
    
    // Get event and category details if provided for personalization
    let eventDetails = null
    let categoryDetails = null
    
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
        // Personalize the message for this customer
        let personalizedMessage = message
        personalizedMessage = personalizedMessage.replace(/{{customer_name}}/g, `${customer.first_name} ${customer.last_name}`)
        personalizedMessage = personalizedMessage.replace(/{{first_name}}/g, customer.first_name)
        personalizedMessage = personalizedMessage.replace(/{{last_name}}/g, customer.last_name || '')
        personalizedMessage = personalizedMessage.replace(/{{venue_name}}/g, 'The Anchor')
        personalizedMessage = personalizedMessage.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707')
        
        // Add event-specific variables if available
        if (eventDetails) {
          personalizedMessage = personalizedMessage.replace(/{{event_name}}/g, eventDetails.name)
          personalizedMessage = personalizedMessage.replace(/{{event_date}}/g, new Date(eventDetails.date).toLocaleDateString('en-GB', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }))
          personalizedMessage = personalizedMessage.replace(/{{event_time}}/g, eventDetails.time)
        }
        
        // Add category-specific variables if available
        if (categoryDetails) {
          personalizedMessage = personalizedMessage.replace(/{{category_name}}/g, categoryDetails.name)
        }
        
        // Prepare message parameters
        const messageParams: TwilioMessageCreateParams = {
          body: personalizedMessage,
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
          body: personalizedMessage, // Use the personalized message here
          status: twilioMessage.status,
          twilio_status: 'queued' as const,
          from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
          to_number: twilioMessage.to,
          message_type: 'sms' as const,
          segments: segments,
          cost_usd: costUsd,
          read_at: new Date().toISOString(), // Mark as read since it's outbound
          metadata: {
            bulk_sms: true,
            event_id: eventId,
            category_id: categoryId
          }
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