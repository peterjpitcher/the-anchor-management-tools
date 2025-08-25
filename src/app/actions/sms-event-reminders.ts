'use server'

import { createAdminClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { smsTemplates, getMessageTemplate } from '@/lib/smsTemplates'
import { logger } from '@/lib/logger'

/**
 * Process scheduled event reminders from the booking_reminders table
 */
export async function processScheduledEventReminders() {
  try {
    // Check for essential configuration
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      logger.info('Skipping reminders - Twilio not configured')
      return { success: true, sent: 0, message: 'SMS not configured' }
    }
    
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      logger.info('Skipping reminders - No phone number or messaging service')
      return { success: true, sent: 0, message: 'SMS not configured' }
    }
    
    const supabase = createAdminClient()
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )
    
    // Get reminders that are due to be sent
    const now = new Date()
    const { data: dueReminders, error: fetchError } = await supabase
      .from('booking_reminders')
      .select(`
        *,
        booking:bookings(
          id,
          seats,
          customer:customers(
            id,
            first_name,
            last_name,
            mobile_number,
            sms_opt_in
          ),
          event:events(
            id,
            name,
            date,
            time
          )
        )
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', now.toISOString())
      .limit(50) // Process in batches
    
    if (fetchError) {
      logger.error('Failed to fetch due reminders', {
        error: fetchError,
        metadata: { time: now.toISOString() }
      })
      return { error: 'Failed to fetch reminders' }
    }
    
    if (!dueReminders || dueReminders.length === 0) {
      logger.info('No reminders due', { metadata: { time: now.toISOString() } })
      return { success: true, sent: 0, message: 'No reminders due' }
    }
    
    let sentCount = 0
    let failedCount = 0
    
    for (const reminder of dueReminders) {
      try {
        // CRITICAL FIX: Skip if event is in the past
        if (reminder.booking?.event?.date) {
          const eventDate = new Date(reminder.booking.event.date)
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          
          if (eventDate < today) {
            logger.warn('Skipping reminder for past event', {
              metadata: {
                reminderId: reminder.id,
                eventName: reminder.booking.event.name,
                eventDate: reminder.booking.event.date
              }
            })
            
            await supabase
              .from('booking_reminders')
              .update({ 
                status: 'cancelled',
                error_message: 'Event has already passed'
              })
              .eq('id', reminder.id)
            continue
          }
        }
        
        // Skip if customer opted out
        if (!reminder.booking?.customer?.sms_opt_in) {
          await supabase
            .from('booking_reminders')
            .update({ 
              status: 'cancelled',
              error_message: 'Customer opted out'
            })
            .eq('id', reminder.id)
          continue
        }
        
        // Skip if no mobile number
        if (!reminder.booking?.customer?.mobile_number) {
          await supabase
            .from('booking_reminders')
            .update({ 
              status: 'failed',
              error_message: 'No mobile number'
            })
            .eq('id', reminder.id)
          failedCount++
          continue
        }
        
        // Prepare template variables
        const customer = reminder.booking.customer
        const event = reminder.booking.event
        const seats = reminder.booking.seats || 0
        
        // Get the appropriate template based on reminder type
        let message = ''
        const templateParams = {
          firstName: customer.first_name,
          eventName: event.name,
          eventDate: new Date(event.date),
          eventTime: event.time,
          seats: seats
        }
        
        switch (reminder.reminder_type) {
          case 'no_seats_2_weeks':
            message = smsTemplates.noSeats2Weeks(templateParams)
            break
          case 'no_seats_1_week':
            message = smsTemplates.noSeats1Week(templateParams)
            break
          case 'no_seats_day_before':
            message = smsTemplates.noSeatsDayBefore({
              firstName: customer.first_name,
              eventName: event.name,
              eventTime: event.time
            })
            break
          case 'has_seats_1_week':
            message = smsTemplates.hasSeats1Week({
              ...templateParams,
              seats: seats
            })
            break
          case 'has_seats_day_before':
            message = smsTemplates.hasSeatsDayBefore({
              firstName: customer.first_name,
              eventName: event.name,
              eventTime: event.time,
              seats: seats
            })
            break
          default:
            // Try to get from database templates
            const templateMessage = await getMessageTemplate(event.id, reminder.reminder_type, {
              customer_name: `${customer.first_name} ${customer.last_name}`,
              first_name: customer.first_name,
              event_name: event.name,
              event_date: new Date(event.date).toLocaleDateString('en-GB', {
                month: 'long',
                day: 'numeric',
              }),
              event_time: event.time,
              seats: seats.toString(),
              venue_name: 'The Anchor',
              contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
            })
            
            if (!templateMessage) {
              // Fallback to generic reminder
              message = smsTemplates.dayBeforeReminder({
                firstName: customer.first_name,
                eventName: event.name,
                eventTime: event.time,
                seats: seats > 0 ? seats : undefined
              })
            } else {
              message = templateMessage
            }
        }
        
        // Send the SMS
        const messageParams: any = {
          body: message,
          to: customer.mobile_number
        }
        
        if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
          messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
        } else if (process.env.TWILIO_PHONE_NUMBER) {
          messageParams.from = process.env.TWILIO_PHONE_NUMBER
        }
        
        const twilioMessage = await twilioClient.messages.create(messageParams)
        
        // Update reminder as sent
        await supabase
          .from('booking_reminders')
          .update({ 
            status: 'sent',
            sent_at: now.toISOString(),
            message_id: twilioMessage.sid
          })
          .eq('id', reminder.id)
        
        // Update booking's last_reminder_sent
        await supabase
          .from('bookings')
          .update({ 
            last_reminder_sent: now.toISOString()
          })
          .eq('id', reminder.booking.id)
        
        sentCount++
        
        logger.info('Reminder sent successfully', {
          metadata: {
            reminderId: reminder.id,
            bookingId: reminder.booking.id,
            type: reminder.reminder_type,
            messageSid: twilioMessage.sid
          }
        })
        
      } catch (error) {
        failedCount++
        logger.error('Failed to send reminder', {
          error: error as Error,
          metadata: {
            reminderId: reminder.id,
            bookingId: reminder.booking?.id,
            type: reminder.reminder_type
          }
        })
        
        // Update reminder as failed
        await supabase
          .from('booking_reminders')
          .update({ 
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', reminder.id)
      }
    }
    
    logger.info('Reminder processing complete', {
      metadata: {
        processed: dueReminders.length,
        sent: sentCount,
        failed: failedCount
      }
    })
    
    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      message: `Processed ${dueReminders.length} reminders: ${sentCount} sent, ${failedCount} failed`
    }
    
  } catch (error) {
    logger.error('Error processing scheduled reminders', {
      error: error as Error
    })
    return { error: 'Failed to process reminders' }
  }
}