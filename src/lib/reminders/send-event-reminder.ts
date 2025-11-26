import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getMessageTemplate } from '@/lib/smsTemplates'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { formatDateInLondon } from '@/lib/dateUtils'
import { normalizeReminderRow, buildReminderTemplate } from './reminder-utils'
import { sendSMS } from '@/lib/twilio'

type ReminderSendResult =
  | { success: true; reminderId: string; twilioSid: string | null }
  | { success: false; reminderId: string; error: string }

async function loadReminder(reminderId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('booking_reminders')
    .select(`
      id,
      reminder_type,
      scheduled_for,
      status,
      target_phone,
      event_id,
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
    .eq('id', reminderId)
    .single()

  if (error || !data) {
    return { supabase, reminder: null, error: error?.message ?? 'Reminder not found' }
  }

  return { supabase, reminder: normalizeReminderRow(data) }
}

export async function sendEventReminderById(reminderId: string): Promise<ReminderSendResult> {
  const { supabase, reminder, error } = await loadReminder(reminderId)

  if (!reminder) {
    logger.error('Reminder not found for send', { metadata: { reminderId, error } })
    return { success: false, reminderId, error: error ?? 'Reminder not found' }
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'SMS not configured' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'SMS not configured' }
  }

  if (!process.env.TWILIO_MESSAGING_SERVICE_SID && !process.env.TWILIO_PHONE_NUMBER) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'No SMS sender configured' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'SMS sender not configured' }
  }

  if (!reminder.booking || !reminder.booking.customer || !reminder.booking.event) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'Booking context missing' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Booking context missing' }
  }

  if (reminder.booking.customer.sms_opt_in === false) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'cancelled', error_message: 'Customer opted out' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Customer opted out' }
  }

  const targetPhone = reminder.target_phone || reminder.booking.customer.mobile_number

  if (!targetPhone) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'Missing customer phone number' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Missing phone number' }
  }

  const customer = reminder.booking.customer
  const event = reminder.booking.event
  const seats = reminder.booking.seats || 0
  const nowIso = new Date().toISOString()

  const templateVariables = {
    customer_name: `${customer.first_name} ${customer.last_name || ''}`.trim(),
    first_name: customer.first_name,
    event_name: event.name,
    event_date: formatDateInLondon(event.date, { month: 'long', day: 'numeric' }),
    event_time: event.time,
    seats: seats.toString(),
    venue_name: 'The Anchor',
    contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
  }

  const messageFromDb = await getMessageTemplate(event.id, reminder.reminder_type, templateVariables)
  const fallbackMessage = buildReminderTemplate(reminder)
  const finalMessage = messageFromDb || fallbackMessage

  if (!finalMessage) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'Missing reminder template' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Missing reminder template' }
  }

  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const messageWithSupport = ensureReplyInstruction(finalMessage, supportPhone)

  try {
    // Use sendSMS which now handles DB logging
    const result = await sendSMS(targetPhone, messageWithSupport, {
      customerId: customer.id,
      metadata: {
        reminder_id: reminder.id,
        reminder_type: reminder.reminder_type,
        booking_id: reminder.booking.id,
        event_id: event.id
      }
    })

    if (!result.success || !result.sid) {
      throw new Error(result.error || 'Failed to send SMS')
    }

    await supabase
      .from('booking_reminders')
      .update({
        status: 'sent',
        sent_at: nowIso,
        target_phone: targetPhone,
        event_id: event.id,
        message_id: result.messageId, // Use the ID returned from logging
        error_message: null
      })
      .eq('id', reminder.id)

    await supabase
      .from('bookings')
      .update({ last_reminder_sent: nowIso })
      .eq('id', reminder.booking.id)

    logger.info('Reminder sent via job queue', {
      metadata: {
        reminderId: reminder.id,
        bookingId: reminder.booking.id,
        eventId: event.id,
        messageSid: result.sid
      }
    })

    return { success: true, reminderId: reminder.id, twilioSid: result.sid }
  } catch (sendError) {
    const errorMessage = sendError instanceof Error ? sendError.message : 'Failed to send reminder'

    await supabase
      .from('booking_reminders')
      .update({
        status: 'failed',
        error_message: errorMessage,
        target_phone: targetPhone
      })
      .eq('id', reminder.id)

    logger.error('Failed to send reminder', {
      error: sendError as Error,
      metadata: { reminderId: reminder.id, bookingId: reminder.booking.id }
    })

    return { success: false, reminderId: reminder.id, error: errorMessage }
  }
}