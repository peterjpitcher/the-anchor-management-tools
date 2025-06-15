'use server'

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { smsTemplates } from '@/lib/smsTemplates'

// Define an interface for Twilio message creation parameters
interface TwilioMessageCreateParams {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
  // Add other potential parameters from Twilio.MessageListInstanceCreateOptions if needed
}

// Helper function to create Supabase client with Service Role Key for server-side actions
function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client')
    return null
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

export async function sendBookingConfirmation(bookingId: string) {
  try {
    // Check for essential Twilio SID & Auth Token
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('Skipping SMS - Twilio Account SID or Auth Token not configured')
      return
    }
    // Check for EITHER Twilio Phone Number OR Messaging Service SID
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      console.log('Skipping SMS - Neither Twilio Phone Number nor Messaging Service SID is configured')
      return
    }
    // Check for Supabase admin credentials
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log('Skipping SMS - Supabase Admin credentials for DB operation not configured')
      return
    }

    const supabase = createAdminSupabaseClient()
    if (!supabase) {
        console.error('Failed to initialize Supabase admin client for booking confirmation.')
        return;
    }

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*, customer:customers(first_name, last_name, mobile_number), event:events(name, date, time)')
      .eq('id', bookingId)
      .single()

    if (bookingError || !booking) {
      console.error('Failed to fetch booking details for SMS:', bookingError)
      return
    }

    if (!booking.customer?.mobile_number) {
      console.log('Skipping SMS - No mobile number for customer:', booking.customer)
      return
    }

    // Check if customer has opted out of SMS
    if (booking.customer.sms_opt_in === false) {
      console.log('Skipping SMS - Customer has opted out:', booking.customer.id)
      return
    }

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    const message = booking.seats
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
        })
    
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
    
    console.log('Twilio message created:', {
      sid: twilioMessage.sid,
      status: twilioMessage.status,
      to: twilioMessage.to,
      from: twilioMessage.from
    });

    // Store the message in the database for tracking
    const messageData = {
      customer_id: booking.customer.id,
      direction: 'outbound' as const,
      message_sid: twilioMessage.sid,
      twilio_message_sid: twilioMessage.sid,
      body: message,
      status: twilioMessage.status,
      twilio_status: 'queued' as const
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

    const supabase = createAdminSupabaseClient()
    if (!supabase) {
        console.error('Failed to initialize Supabase admin client for event reminders.')
        throw new Error('Supabase admin client initialization failed for reminders');
    }

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
      .select('*, customer:customers(first_name, last_name, mobile_number), event:events(name, date, time)')
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
        console.log('Skipping invalid booking for reminder - Missing event or customer data:', {
          bookingId: booking.id,
          hasEvent: !!booking.event,
          hasCustomer: !!booking.customer
        })
        return false
      }
      // Double-check SMS opt-in status
      if (booking.customer.sms_opt_in === false) {
        console.log('Skipping reminder - Customer has opted out:', booking.customer.id)
        return false
      }
      return true
    })

    if (validBookings.length === 0) {
      console.log('No valid bookings found for reminders after filtering')
      return
    }

    console.log('Found valid bookings for reminders:', validBookings.length);

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    for (const booking of validBookings) {
      try {
        const eventDate = new Date(booking.event.date)
        const isNextDay = eventDate.toISOString().split('T')[0] === tomorrowStr
        
        const message = isNextDay
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
            })
        
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

        console.log('Sending reminder SMS to:', booking.customer.mobile_number, 'for event:', booking.event.name, 'using', 
          process.env.TWILIO_MESSAGING_SERVICE_SID ? 'MessagingServiceSID' : 'FromNumber');

        const twilioMessage = await twilioClientInstance.messages.create(messageParams)
        
        // Store the message in the database for tracking
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            customer_id: booking.customer.id,
            direction: 'outbound',
            message_sid: twilioMessage.sid,
            twilio_message_sid: twilioMessage.sid,
            body: message,
            status: twilioMessage.status,
            twilio_status: 'queued' // Initial status
          });

        if (messageError) {
          console.error('Failed to store reminder message in database:', messageError);
          // Don't throw - SMS was sent successfully
        }
        
        console.log(`Reminder sent to ${booking.customer.first_name} for ${booking.event.name}`)
      } catch (error) {
        console.error(`Failed to send reminder for booking ${booking.id}:`, error)
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