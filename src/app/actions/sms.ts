'use server'

import { createAdminClient } from '@/lib/supabase/server'
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

    const supabase = createAdminClient()

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*, customer:customers(id, first_name, last_name, mobile_number, sms_opt_in), event:events(name, date, time)')
      .eq('id', bookingId)
      .single()

    if (bookingError || !booking) {
      console.error('Failed to fetch booking details for SMS:', bookingError)
      logger.error('SMS: Failed to fetch booking', {
        error: bookingError ? new Error(bookingError.message) : new Error('Booking not found'),
        metadata: { bookingId }
      })
      return
    }
    
    console.log('SMS: Booking details fetched:', {
      bookingId,
      customerId: booking.customer?.id,
      hasCustomer: !!booking.customer,
      hasMobileNumber: !!booking.customer?.mobile_number,
      smsOptIn: booking.customer?.sms_opt_in
    })

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

    // Check if customer is a loyalty member and generate QR code if applicable
    let qrCodeUrl = '';
    const { data: loyaltyMember } = await supabase
      .from('loyalty_members')
      .select('id')
      .eq('customer_id', booking.customer.id)
      .eq('status', 'active')
      .single();
    
    if (loyaltyMember) {
      // Generate QR code for loyalty check-in
      const { generateBookingQRCode } = await import('./loyalty-checkins');
      const qrResult = await generateBookingQRCode(booking.event.id, booking.id);
      if (qrResult.qrUrl) {
        qrCodeUrl = qrResult.qrUrl;
      }
    }

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
      booking_reference: booking.id.substring(0, 8).toUpperCase(),
      qr_code_url: qrCodeUrl,
      loyalty_checkin_url: qrCodeUrl || `${process.env.NEXT_PUBLIC_APP_URL}/loyalty/checkin?event=${booking.event.id}`
    };

    // Try to get template from database
    const templateType = booking.seats ? 'bookingConfirmation' : 'reminderOnly';
    console.log('[SMS] Template lookup:', {
      eventId: booking.event.id,
      templateType,
      mappedType: templateType === 'bookingConfirmation' ? 'booking_confirmation' : 'booking_reminder_confirmation',
      seats: booking.seats
    });
    
    let message = await getMessageTemplate(booking.event.id, templateType, templateVariables);
    console.log('[SMS] Template result:', message ? 'Found template' : 'No template found');
    
    // Fall back to legacy templates if database template not found
    if (!message) {
      console.log('[SMS] Falling back to hard-coded template');
      message = booking.seats
        ? smsTemplates.bookingConfirmation({
            firstName: booking.customer.first_name,
            seats: booking.seats,
            eventName: booking.event.name,
            eventDate: new Date(booking.event.date),
            eventTime: booking.event.time,
            qrCodeUrl: qrCodeUrl,
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

    console.log('SMS: Attempting to send message via Twilio:', {
      to: messageParams.to,
      bodyLength: messageParams.body.length,
      from: messageParams.from,
      messagingServiceSid: messageParams.messagingServiceSid
    })
    
    const twilioMessage = await twilioClientInstance.messages.create(messageParams)
    
    console.log('Booking confirmation SMS sent successfully:', {
      sid: twilioMessage.sid,
      status: twilioMessage.status,
      to: twilioMessage.to,
      from: twilioMessage.from
    });

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

// Send OTP message
export async function sendOTPMessage(phoneNumber: string, message: string) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured');
    }
    
    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    const messageParams: TwilioMessageCreateParams = {
      body: message,
      to: phoneNumber,
    };
    
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (process.env.TWILIO_PHONE_NUMBER) {
      messageParams.from = process.env.TWILIO_PHONE_NUMBER;
    } else {
      throw new Error('No Twilio sender configured');
    }
    
    const twilioMessage = await twilioClientInstance.messages.create(messageParams);
    
    console.log('OTP SMS sent successfully:', {
      sid: twilioMessage.sid,
      to: twilioMessage.to
    });
    
    return { success: true, messageSid: twilioMessage.sid };
  } catch (error) {
    console.error('Failed to send OTP SMS:', error);
    throw error;
  }
}

// sendEventReminders removed — scheduled pipeline is the single source of truth

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
    const supabase = createAdminClient()
    if (supabase) {
      // Try to resolve customer_id for private booking messages
      let customerIdForLog: string | undefined
      if (params.bookingId) {
        try {
          const { data: pb } = await supabase
            .from('private_bookings')
            .select('customer_id')
            .eq('id', params.bookingId)
            .single()
          if (pb?.customer_id) customerIdForLog = pb.customer_id
        } catch (e) {
          console.warn('[sendSms] Could not resolve customer_id for bookingId', params.bookingId, e)
        }
      }

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
        metadata: params.bookingId ? { private_booking_id: params.bookingId } : undefined,
        // Link to customer for visibility on customer page (when known)
        customer_id: customerIdForLog
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
      metadata: { badge: customerIds.length } 
    })
    
    return { 
      success: true, 
      message: `Queued SMS for ${customerIds.length} customers` 
    }
  } catch (error) {
    logger.error('Failed to queue bulk SMS', { 
      error: error as Error,
      metadata: { badge: customerIds.length }
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

    const supabase = createAdminClient()

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
