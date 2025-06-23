'use server'

import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import twilio from 'twilio'
import { smsTemplates, getMessageTemplate, getMessageTemplatesBatch, renderTemplate } from '@/lib/smsTemplates'
import { rateLimiters } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { logger } from '@/lib/logger'
import { jobQueue } from '@/lib/background-jobs'

// Define an interface for Twilio message creation parameters
interface TwilioMessageCreateParams {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
  // Add other potential parameters from Twilio.MessageListInstanceCreateOptions if needed
}

export async function sendBookingConfirmation(bookingId: string) {
  try {
    // Queue the booking confirmation job
    await jobQueue.enqueue('process_reminder', {
      bookingId,
      reminderType: '24_hour' // Using 24_hour as a confirmation type
    }, {
      priority: 10 // High priority for confirmations
    })
    
    logger.info('Booking confirmation SMS queued', { metadata: { bookingId } })
    return { success: true }
  } catch (error) {
    logger.error('Failed to queue booking confirmation', { 
      error: error as Error,
      metadata: { bookingId }
    })
    return { error: 'Failed to queue confirmation' }
  }
}

// Legacy synchronous version (kept for backward compatibility)
export async function sendBookingConfirmationSync(bookingId: string) {
  try {
    // Check for essential Twilio SID & Auth Token
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      logger.info('Skipping SMS - Twilio Account SID or Auth Token not configured')
      return
    }
    // Check for EITHER Twilio Phone Number OR Messaging Service SID
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      logger.info('Skipping SMS - Neither Twilio Phone Number nor Messaging Service SID is configured')
      return
    }
    // Check for Supabase admin credentials
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      logger.info('Skipping SMS - Supabase Admin credentials for DB operation not configured')
      return
    }

    const supabase = getSupabaseAdminClient()

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*, customer:customers(id, first_name, last_name, mobile_number, sms_opt_in), event:events(name, date, time)')
      .eq('id', bookingId)
      .single()

    if (bookingError || !booking) {
      console.error('Failed to fetch booking details for SMS:', bookingError)
      return
    }

    if (!booking.customer?.mobile_number) {
      console.log('Skipping SMS - No mobile number for customer')
      return
    }

    // Check if customer has opted out of SMS
    if (booking.customer.sms_opt_in === false) {
      console.log('Skipping SMS - Customer has opted out')
      return
    }

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    // Prepare variables for template
    const templateVariables = {
      customer_name: `${booking.customer.first_name} ${booking.customer.last_name}`,
      first_name: booking.customer.first_name,
      event_name: booking.event.name,
      event_date: new Date(booking.event.date).toLocaleDateString('en-GB', {
        month: 'long',
        day: 'numeric',
      }),
      event_time: booking.event.time,
      seats: booking.seats?.toString() || '0',
      venue_name: 'The Anchor',
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
      booking_reference: booking.id.substring(0, 8).toUpperCase()
    };

    // Try to get template from database
    const templateType = booking.seats ? 'bookingConfirmation' : 'reminderOnly';
    let message = await getMessageTemplate(booking.event.id, templateType, templateVariables);
    
    // Fall back to legacy templates if database template not found
    if (!message) {
      message = booking.seats
        ? smsTemplates.bookingConfirmation({
            firstName: booking.customer.first_name,
            seats: booking.seats,
            eventName: booking.event.name,
            eventDate: new Date(booking.event.date),
            eventTime: booking.event.time,
          })
        : smsTemplates.reminderOnly({
            firstName: booking.customer.first_name,
            eventName: booking.event.name,
            eventDate: new Date(booking.event.date),
            eventTime: booking.event.time,
          });
    }
    
    const messageParams: TwilioMessageCreateParams = {
      body: message,
      to: booking.customer.mobile_number,
    };

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (process.env.TWILIO_PHONE_NUMBER) {
      messageParams.from = process.env.TWILIO_PHONE_NUMBER;
    } else {
      // This case should be caught by the check at the beginning of the function
      console.error('Critical error: No sender ID (phone or service SID) for Twilio.');
      return;
    }

    const twilioMessage = await twilioClientInstance.messages.create(messageParams)
    
    console.log('Booking confirmation SMS sent successfully');

    // Calculate segments (SMS is 160 chars, or 153 for multi-part)
    const messageLength = message.length;
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153);
    const costUsd = segments * 0.04; // Approximate UK SMS cost per segment
    
    // Store the message in the database for tracking
    const messageData = {
      customer_id: booking.customer.id,
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
      cost_usd: costUsd
    };
    
    console.log('Attempting to store message in database:', messageData);
    
    const { data: insertedMessage, error: messageError } = await supabase
      .from('messages')
      .insert(messageData)
      .select()
      .single();

    if (messageError) {
      console.error('Failed to store message in database:', messageError);
      console.error('Message data that failed:', messageData);
      // Don't throw - SMS was sent successfully
    } else {
      console.log('Message stored successfully:', insertedMessage);
    }

    console.log('SMS sent successfully for bookingId:', bookingId, 'using', 
      process.env.TWILIO_MESSAGING_SERVICE_SID ? 'MessagingServiceSID' : 'FromNumber');
  } catch (error) {
    console.error('Failed to send SMS for bookingId:', bookingId, error)
  }
}

export async function sendEventReminders() {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('Skipping reminders - Twilio Account SID or Auth Token not configured')
      return
    }
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      console.log('Skipping reminders - Neither Twilio Phone Number nor Messaging Service SID is configured')
      return
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log('Skipping reminders - Supabase Admin credentials for DB operation not configured')
      throw new Error('Supabase Admin configuration missing for reminders')
    }

    const supabase = getSupabaseAdminClient()

    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)

    const tomorrowStr = tomorrow.toISOString().split('T')[0]
    const nextWeekStr = nextWeek.toISOString().split('T')[0]

    console.log('Checking for reminders for events on:', { tomorrowStr, nextWeekStr })
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*, customer:customers(id, first_name, last_name, mobile_number, sms_opt_in), event:events(name, date, time)')
      .in('event.date', [tomorrowStr, nextWeekStr])
      .not('customer.mobile_number', 'is', null)
      .eq('customer.sms_opt_in', true)

    if (bookingsError) {
      console.error('Database error fetching reminders:', bookingsError)
      throw new Error(`Failed to fetch bookings for reminders: ${bookingsError.message}`)
    }

    if (!bookings || bookings.length === 0) {
      console.log('No reminders to send - No bookings found for dates:', { tomorrowStr, nextWeekStr })
      return
    }

    const validBookings = bookings.filter(booking => {
      if (!booking.event || !booking.customer) {
        console.log('Skipping invalid booking for reminder - Missing event or customer data')
        return false
      }
      // Double-check SMS opt-in status
      if (booking.customer.sms_opt_in === false) {
        console.log('Skipping reminder - Customer has opted out')
        return false
      }
      return true
    })

    if (validBookings.length === 0) {
      console.log('No valid bookings found for reminders after filtering')
      return
    }

    console.log('Found valid bookings for reminders:', validBookings.length);

    // Batch check for existing reminders
    const bookingIds = validBookings.map(b => b.id)
    const { data: existingReminders } = await supabase
      .from('booking_reminders')
      .select('booking_id, reminder_type')
      .in('booking_id', bookingIds)
      .in('reminder_type', ['24_hour', '7_day'])

    // Create a set for quick lookup
    const existingReminderSet = new Set(
      existingReminders?.map(r => `${r.booking_id}-${r.reminder_type}`) || []
    )

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    // Collect all messages to insert at once
    const messagesToInsert = []
    const remindersToInsert = []

    // Pre-fetch all message templates for the events
    const templateRequests = []
    for (const booking of validBookings) {
      const eventDate = new Date(booking.event.date)
      const isNextDay = eventDate.toISOString().split('T')[0] === tomorrowStr
      const isBookingReminder = !booking.seats || booking.seats === 0
      const baseTemplateType = isNextDay ? 'dayBeforeReminder' : 'weekBeforeReminder'
      const templateType = isBookingReminder 
        ? (isNextDay ? 'booking_reminder_24_hour' : 'booking_reminder_7_day')
        : baseTemplateType
      
      templateRequests.push({
        eventId: booking.event.id,
        templateType: templateType
      })
    }
    
    const templateCache = await getMessageTemplatesBatch(templateRequests)

    for (const booking of validBookings) {
      try {
        const eventDate = new Date(booking.event.date)
        const isNextDay = eventDate.toISOString().split('T')[0] === tomorrowStr
        const reminderType = isNextDay ? '24_hour' : '7_day'
        
        // Check if reminder has already been sent using our pre-fetched set
        if (existingReminderSet.has(`${booking.id}-${reminderType}`)) {
          console.log(`Skipping ${reminderType} reminder for booking ${booking.id} - already sent`)
          continue
        }
        
        // Prepare variables for template
        const templateVariables = {
          customer_name: `${booking.customer.first_name} ${booking.customer.last_name}`,
          first_name: booking.customer.first_name,
          event_name: booking.event.name,
          event_date: eventDate.toLocaleDateString('en-GB', {
            month: 'long',
            day: 'numeric',
          }),
          event_time: booking.event.time,
          seats: booking.seats?.toString() || '0',
          venue_name: 'The Anchor',
          contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
        };

        // Determine template type based on whether it's a booking (with seats) or reminder (0 seats)
        const isBookingReminder = !booking.seats || booking.seats === 0;
        const baseTemplateType = isNextDay ? 'dayBeforeReminder' : 'weekBeforeReminder';
        const templateType = isBookingReminder 
          ? (isNextDay ? 'booking_reminder_24_hour' : 'booking_reminder_7_day')
          : baseTemplateType;
        
        // Try to get template from cache
        const cachedTemplate = templateCache.get(`${booking.event.id}-${templateType}`);
        let message = cachedTemplate ? renderTemplate(cachedTemplate, templateVariables) : null;
        
        // Fall back to legacy templates if database template not found
        if (!message) {
          message = isNextDay
            ? smsTemplates.dayBeforeReminder({
                firstName: booking.customer.first_name,
                eventName: booking.event.name,
                eventTime: booking.event.time,
                seats: booking.seats,
              })
            : smsTemplates.weekBeforeReminder({
                firstName: booking.customer.first_name,
                eventName: booking.event.name,
                eventDate: eventDate,
                eventTime: booking.event.time,
                seats: booking.seats,
              });
        }
        
        const messageParams: TwilioMessageCreateParams = {
          body: message,
          to: booking.customer.mobile_number,
        };

        if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
          messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
        } else if (process.env.TWILIO_PHONE_NUMBER) {
          messageParams.from = process.env.TWILIO_PHONE_NUMBER;
        } else {
          console.error('Critical error: No sender ID (phone or service SID) for Twilio reminder.');
          continue; // Skip this reminder
        }

        console.log('Sending reminder SMS');

        const twilioMessage = await twilioClientInstance.messages.create(messageParams)
        
        // Collect message data for batch insert
        messagesToInsert.push({
          customer_id: booking.customer.id,
          direction: 'outbound',
          message_sid: twilioMessage.sid,
          twilio_message_sid: twilioMessage.sid,
          body: message,
          status: twilioMessage.status,
          twilio_status: 'queued', // Initial status
          from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
          to_number: twilioMessage.to,
          message_type: 'sms'
        })
        
        // Collect reminder data for batch insert
        remindersToInsert.push({
          booking_id: booking.id,
          reminder_type: reminderType,
          twilio_message_sid: twilioMessage.sid // Store twilio sid for later linking
        })
        
        console.log(`${reminderType} reminder sent successfully`)
      } catch (error) {
        console.error(`Failed to send reminder for booking ${booking.id}:`, error)
      }
    }

    // Batch insert all messages
    if (messagesToInsert.length > 0) {
      const { data: insertedMessages, error: messageError } = await supabase
        .from('messages')
        .insert(messagesToInsert)
        .select('id, twilio_message_sid')

      if (messageError) {
        console.error('Failed to store messages in database:', messageError)
      } else if (insertedMessages) {
        // Create a map of twilio_message_sid to message id for linking reminders
        const messageIdMap = new Map(
          insertedMessages.map(m => [m.twilio_message_sid, m.id])
        )

        // Update reminders with message ids
        const remindersWithMessageIds = remindersToInsert.map(r => ({
          booking_id: r.booking_id,
          reminder_type: r.reminder_type,
          message_id: messageIdMap.get(r.twilio_message_sid) || null
        }))

        // Batch insert all reminders
        const { error: reminderError } = await supabase
          .from('booking_reminders')
          .insert(remindersWithMessageIds)

        if (reminderError) {
          console.error('Failed to record sent reminders:', reminderError)
        }
      }
    }
  } catch (error) {
    console.error('Failed to process event reminders:', error)
    if (error instanceof Error && error.message.includes('Supabase Admin configuration missing')) {
    } else {
        throw error; 
    }
  }
}

export async function sendSms(params: { to: string; body: string; bookingId?: string }) {
  'use server'
  
  try {
    // Apply rate limiting for SMS operations
    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'unknown'
    const { NextRequest } = await import('next/server')
    const mockReq = new NextRequest('http://localhost', {
      headers: { 'x-forwarded-for': ip }
    })
    
    const rateLimitResponse = await rateLimiters.sms(mockReq)
    if (rateLimitResponse) {
      return { error: 'Too many SMS requests. Please wait before sending more messages.' }
    }
    
    // Check for essential Twilio SID & Auth Token
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('Skipping SMS - Twilio Account SID or Auth Token not configured')
      return { error: 'SMS service not configured' }
    }
    
    // Check for EITHER Twilio Phone Number OR Messaging Service SID
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      console.log('Skipping SMS - Neither Twilio Phone Number nor Messaging Service SID is configured')
      return { error: 'SMS service not configured' }
    }

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    // Prepare message parameters
    const messageParams: TwilioMessageCreateParams = {
      body: params.body,
      to: params.to,
    }

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
    } else if (process.env.TWILIO_PHONE_NUMBER) {
      messageParams.from = process.env.TWILIO_PHONE_NUMBER
    }

    // Send the SMS
    const twilioMessage = await twilioClientInstance.messages.create(messageParams)
    
    console.log('SMS sent successfully')

    // If we have access to the database, store the message
    const supabase = getSupabaseAdminClient()
    if (supabase) {
      // Calculate segments
      const messageLength = params.body.length
      const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
      const costUsd = segments * 0.04 // Approximate UK SMS cost per segment

      // Store the message in the database
      const messageData = {
        direction: 'outbound' as const,
        message_sid: twilioMessage.sid,
        twilio_message_sid: twilioMessage.sid,
        body: params.body,
        status: twilioMessage.status,
        twilio_status: 'queued' as const,
        from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
        to_number: twilioMessage.to,
        message_type: 'sms' as const,
        segments: segments,
        cost_usd: costUsd,
        read_at: new Date().toISOString(), // Mark as read since it's outbound
        // Store booking reference if provided
        metadata: params.bookingId ? { private_booking_id: params.bookingId } : undefined
      }
      
      const { error: messageError } = await supabase
        .from('messages')
        .insert(messageData)

      if (messageError) {
        console.error('Error recording message:', messageError)
        // Don't fail the action if recording fails
      }
    }

    return { success: true, sid: twilioMessage.sid }
  } catch (error) {
    console.error('Error in sendSms:', error)
    return { error: 'Failed to send message' }
  }
}

// Async version for background processing
export async function sendBulkSMSAsync(customerIds: string[], message: string) {
  // Skip rate limiting for background jobs
  return sendBulkSMSInternal(customerIds, message, true)
}

export async function sendBulkSMS(customerIds: string[], message: string) {
  try {
    // Queue the bulk SMS job
    await jobQueue.enqueue('send_bulk_sms', {
      customerIds,
      message
    }, {
      priority: 5 // Medium priority for bulk operations
    })
    
    logger.info('Bulk SMS job queued', { 
      metadata: { count: customerIds.length } 
    })
    
    return { 
      success: true, 
      message: `Queued SMS for ${customerIds.length} customers` 
    }
  } catch (error) {
    logger.error('Failed to queue bulk SMS', { 
      error: error as Error,
      metadata: { count: customerIds.length }
    })
    return { error: 'Failed to queue bulk SMS' }
  }
}

async function sendBulkSMSInternal(customerIds: string[], message: string, skipRateLimit: boolean = false) {
  'use server'
  
  try {
    // Apply rate limiting for bulk SMS operations (skip for background jobs)
    if (!skipRateLimit) {
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

    const supabase = getSupabaseAdminClient()

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
        
        console.log('Bulk SMS sent successfully')

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
        console.error(`Failed to send SMS to customer ${customer.id}:`, error)
        errors.push({
          customerId: customer.id,
          error: error instanceof Error ? error.message : 'Failed to send message'
        })
      }
    }

    // Batch insert all messages
    if (messagesToInsert.length > 0) {
      const { error: batchError } = await supabase
        .from('messages')
        .insert(messagesToInsert)

      if (batchError) {
        console.error('Error recording messages in batch:', batchError)
        // Don't fail the action if recording fails
      }
    }

    // Return summary of results
    return { 
      success: true, 
      sent: results.length,
      failed: errors.length,
      total: customerIds.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    }
  } catch (error) {
    console.error('Error in sendBulkSMS:', error)
    return { error: 'Failed to send message' }
  }
} 