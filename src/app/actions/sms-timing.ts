'use server'

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { smsTemplates, getMessageTemplate } from '@/lib/smsTemplates'

// Define an interface for Twilio message creation parameters
interface TwilioMessageCreateParams {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
}

// Define interface for booking reminder data
interface BookingReminderData {
  booking_id: string;
  customer_id: string;
  event_id: string;
  template_type: string;
  reminder_type: string;
  send_timing: string;
  custom_timing_hours: number | null;
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

export async function sendEventRemindersWithTiming() {
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

    // Log cron run
    await supabase.rpc('log_reminder_processing', {
      p_processing_type: 'cron_run',
      p_message: 'Started reminder processing with timing-based approach'
    })

    // Get bookings that need reminders based on template timing configuration
    const { data: bookingsNeedingReminders, error: queryError } = await supabase
      .rpc('get_bookings_needing_reminders') as { data: BookingReminderData[] | null, error: { message: string } | null }

    if (queryError) {
      console.error('Failed to get bookings needing reminders:', queryError)
      throw new Error(`Failed to fetch bookings for reminders: ${queryError.message}`)
    }

    if (!bookingsNeedingReminders || bookingsNeedingReminders.length === 0) {
      console.log('No reminders to send based on template timing configuration')
      await supabase.rpc('log_reminder_processing', {
        p_processing_type: 'cron_run',
        p_message: 'No bookings found needing reminders'
      })
      return
    }

    console.log(`Found ${bookingsNeedingReminders.length} bookings needing reminders based on template timing`)
    await supabase.rpc('log_reminder_processing', {
      p_processing_type: 'cron_run',
      p_message: `Found ${bookingsNeedingReminders.length} bookings needing reminders`,
      p_metadata: { booking_badge: bookingsNeedingReminders.length }
    })

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    // Group by booking ID to handle multiple templates per booking
    const bookingGroups = bookingsNeedingReminders.reduce((acc: Record<string, BookingReminderData[]>, item: BookingReminderData) => {
      if (!acc[item.booking_id]) {
        acc[item.booking_id] = [];
      }
      acc[item.booking_id].push(item);
      return acc;
    }, {});

    // Batch fetch all bookings
    const bookingIds = Object.keys(bookingGroups)
    const { data: allBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*, customer:customers(id, first_name, last_name, mobile_number, sms_opt_in), event:events(id, name, date, time)')
      .in('id', bookingIds)

    if (bookingsError || !allBookings) {
      console.error('Failed to fetch booking details:', bookingsError)
      throw new Error('Failed to fetch booking details for reminders')
    }

    // Create a map for quick lookup
    const bookingMap = new Map(allBookings.map(b => [b.id, b]))

    // Collect all messages and reminders to insert
    const messagesToInsert = []
    const remindersToInsert = []

    for (const [bookingId, templates] of Object.entries(bookingGroups)) {
      // Get booking from map
      const booking = bookingMap.get(bookingId)
      
      if (!booking) {
        console.error(`Booking not found in map: ${bookingId}`)
        continue
      }

      if (!booking.customer?.mobile_number) {
        console.log('Skipping SMS - No mobile number for customer')
        continue
      }

      // Process each template for this booking
      for (const templateConfig of templates) {
        try {
          // Prepare variables for template
          const eventDate = new Date(booking.event.date)
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

          // Get the template message
          let message = await getMessageTemplate(booking.event.id, templateConfig.template_type, templateVariables);
          
          // Fall back to legacy templates if database template not found
          if (!message) {
            // Map new template types to legacy functions
            const legacyMapping: Record<string, () => string> = {
              'dayBeforeReminder': () => smsTemplates.dayBeforeReminder({
                firstName: booking.customer.first_name,
                eventName: booking.event.name,
                eventTime: booking.event.time,
                seats: booking.seats,
              }),
              'weekBeforeReminder': () => smsTemplates.weekBeforeReminder({
                firstName: booking.customer.first_name,
                eventName: booking.event.name,
                eventDate: eventDate,
                eventTime: booking.event.time,
                seats: booking.seats,
              }),
              'booking_reminder_24_hour': () => smsTemplates.dayBeforeReminder({
                firstName: booking.customer.first_name,
                eventName: booking.event.name,
                eventTime: booking.event.time,
                seats: 0,
              }),
              'booking_reminder_7_day': () => smsTemplates.weekBeforeReminder({
                firstName: booking.customer.first_name,
                eventName: booking.event.name,
                eventDate: eventDate,
                eventTime: booking.event.time,
                seats: 0,
              })
            };

            const legacyFunction = legacyMapping[templateConfig.template_type];
            if (legacyFunction) {
              message = legacyFunction();
            } else {
              console.error(`No fallback template for type: ${templateConfig.template_type}`)
              continue;
            }
          }
          
          if (!message) {
            console.error(`No message content available for template type: ${templateConfig.template_type}`)
            continue;
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
            continue;
          }

          console.log(`Sending ${templateConfig.reminder_type} reminder`);

          const twilioMessage = await twilioClientInstance.messages.create(messageParams)
          
          // Calculate segments
          const messageLength = message.length;
          const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153);
          const costUsd = segments * 0.04;

          // Collect message data for batch insert
          messagesToInsert.push({
            customer_id: booking.customer.id,
            direction: 'outbound',
            message_sid: twilioMessage.sid,
            twilio_message_sid: twilioMessage.sid,
            body: message,
            status: twilioMessage.status,
            twilio_status: 'queued',
            from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
            to_number: twilioMessage.to,
            message_type: 'sms',
            segments: segments,
            cost_usd: costUsd
          })
          
          // Collect reminder data for batch insert
          remindersToInsert.push({
            booking_id: booking.id,
            reminder_type: templateConfig.reminder_type,
            twilio_message_sid: twilioMessage.sid // Store twilio sid for later linking
          })
          
          console.log(`${templateConfig.reminder_type} reminder sent successfully`)
        } catch (error) {
          console.error(`Failed to send ${templateConfig.reminder_type} reminder for booking ${bookingId}:`, error)
        }
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
    console.error('Failed to process event reminders with timing:', error)
    throw error
  }
}