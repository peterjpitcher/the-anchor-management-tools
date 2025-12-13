import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getMessageTemplate } from '@/lib/smsTemplates'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { formatDateInLondon } from '@/lib/dateUtils'
import { normalizeReminderRow, buildReminderTemplate } from './reminder-utils'
import { sendSMS } from '@/lib/twilio'
import { formatPhoneForStorage } from '@/lib/validation'
import { fromZonedTime } from 'date-fns-tz'
import { differenceInHours, isAfter, subDays } from 'date-fns'

const eventSmsPaused = () =>
  process.env.SUSPEND_EVENT_SMS === 'true' || process.env.SUSPEND_ALL_SMS === 'true'

const LONDON_TZ = 'Europe/London'
const PAST_EVENT_GRACE_HOURS = 12
const MAX_FAILURES = 3
const FAILURE_LOOKBACK_DAYS = 30

type ReminderSendResult =
  | { success: true; reminderId: string; twilioSid: string | null }
  | { success: false; reminderId: string; error: string; cancelled?: boolean }

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

async function getSmsFailureCount(
  supabase: ReturnType<typeof createAdminClient>,
  phone: string
): Promise<number> {
  const cutoffIso = subDays(new Date(), FAILURE_LOOKBACK_DAYS).toISOString()

  const { count, error } = await supabase
    .from('messages')
    .select('id', { head: true, count: 'exact' })
    .eq('direction', 'outbound')
    .eq('message_type', 'sms')
    .eq('to_number', phone)
    .eq('status', 'failed')
    .gte('created_at', cutoffIso)

  if (error) {
    logger.error('Failed to fetch SMS failure count', {
      error: error as Error,
      metadata: { phone }
    })
    return 0
  }

  return count ?? 0
}

async function disableSmsForCustomer(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  reason: string
) {
  const { error } = await supabase
    .from('customers')
    .update({ sms_opt_in: false })
    .eq('id', customerId)

  if (error) {
    logger.error('Failed to disable SMS for customer', {
      error: error as Error,
      metadata: { customerId, reason }
    })
  }
}

export async function sendEventReminderById(reminderId: string): Promise<ReminderSendResult> {
  const { supabase, reminder, error } = await loadReminder(reminderId)

  if (!reminder) {
    logger.error('Reminder not found for send', { metadata: { reminderId, error } })
    return { success: false, reminderId, error: error ?? 'Reminder not found' }
  }

  if (eventSmsPaused()) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'cancelled', error_message: 'Event SMS paused' })
      .eq('id', reminder.id)

    logger.warn('Event SMS paused, skipping send', {
      metadata: {
        reminderId,
        bookingId: reminder.booking?.id,
        eventId: reminder.booking?.event?.id
      }
    })

    return { success: true, reminderId, twilioSid: null }
  }

  if (reminder.status === 'sent') {
    logger.info('Reminder already sent, skipping duplicate send', {
      metadata: { reminderId: reminder.id }
    })
    return { success: true, reminderId: reminder.id, twilioSid: null }
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

  let normalizedPhone = targetPhone
  try {
    normalizedPhone = formatPhoneForStorage(targetPhone)
  } catch (normalizeError) {
    logger.warn('Failed to normalize phone for failure tracking', {
      error: normalizeError as Error,
      metadata: { reminderId: reminder.id, targetPhone }
    })
  }

  const failureCount = await getSmsFailureCount(supabase, normalizedPhone)
  if (failureCount >= MAX_FAILURES) {
    await supabase
      .from('booking_reminders')
      .update({
        status: 'cancelled',
        error_message: 'SMS disabled after repeated failures',
        updated_at: nowIso
      })
      .eq('id', reminder.id)

    await disableSmsForCustomer(supabase, customer.id, 'exceeded_sms_failures')

    logger.warn('Skipping reminder send due to failure limit', {
      metadata: { reminderId: reminder.id, phone: normalizedPhone, failureCount }
    })

    return {
      success: false,
      reminderId: reminder.id,
      error: 'SMS disabled after repeated failures',
      cancelled: true
    }
  }

  const eventDateTime = fromZonedTime(
    `${event.date}T${event.time || '23:59:59'}`,
    LONDON_TZ
  )

  if (!isAfter(eventDateTime, new Date()) && differenceInHours(new Date(), eventDateTime) > PAST_EVENT_GRACE_HOURS) {
    await supabase
      .from('booking_reminders')
      .update({
        status: 'cancelled',
        error_message: 'Event already passed',
        updated_at: nowIso
      })
      .eq('id', reminder.id)

    return {
      success: false,
      reminderId: reminder.id,
      error: 'Event already passed',
      cancelled: true
    }
  }

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
    // Mark as in-flight to prevent duplicate processing; bail if someone else already claimed it
    const { data: claimed, error: claimError } = await supabase
      .from('booking_reminders')
      .update({ status: 'sending', updated_at: nowIso })
      .eq('id', reminder.id)
      .in('status', ['pending', 'queued', 'failed'])
      .select('id')
      .single()

    if (claimError && (claimError as any)?.code !== 'PGRST116') {
      throw claimError
    }

    if (!claimed) {
      logger.info('Reminder already processing or sent, skipping duplicate send', {
        metadata: { reminderId: reminder.id }
      })
      return {
        success: false,
        reminderId: reminder.id,
        error: 'Reminder already processing',
        cancelled: true
      }
    }

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
      const errorMessage = result.error || 'Failed to send SMS'

      // Twilio opt-out (21610) should permanently disable and cancel
      if ((result as any).code === 21610) {
        await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Recipient opted out via carrier',
            updated_at: nowIso
          })
          .eq('id', reminder.id)

        await disableSmsForCustomer(supabase, customer.id, 'carrier_opt_out')

        logger.warn('Recipient carrier opt-out, cancelling reminder', {
          metadata: { reminderId: reminder.id, phone: normalizedPhone }
        })

        return {
          success: false,
          reminderId: reminder.id,
          error: errorMessage,
          cancelled: true
        }
      }

      await supabase
        .from('booking_reminders')
        .update({
          status: 'failed',
          error_message: errorMessage,
          target_phone: targetPhone,
          updated_at: nowIso
        })
        .eq('id', reminder.id)

      logger.error('Failed to send reminder', {
        metadata: {
          reminderId: reminder.id,
          bookingId: reminder.booking.id,
          eventId: event.id,
          error: errorMessage
        }
      })

      return { success: false, reminderId: reminder.id, error: errorMessage }
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
        target_phone: targetPhone,
        updated_at: new Date().toISOString()
      })
      .eq('id', reminder.id)

    logger.error('Failed to send reminder', {
      error: sendError as Error,
      metadata: { reminderId: reminder.id, bookingId: reminder.booking.id }
    })

    return { success: false, reminderId: reminder.id, error: errorMessage }
  }
}
