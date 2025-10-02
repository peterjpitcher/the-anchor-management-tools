'use server'

import { createAdminClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { smsTemplates, getMessageTemplate } from '@/lib/smsTemplates'
import { logger } from '@/lib/logger'
import { ReminderType } from './event-sms-scheduler'
import { formatTime12Hour } from '@/lib/dateUtils'
import { ensureReplyInstruction } from '@/lib/sms/support'

interface ProcessOptions {
  reminderIds?: string[]
  limit?: number
  now?: Date
}

type ReminderRow = {
  id: string
  reminder_type: ReminderType
  scheduled_for: string
  target_phone: string | null
  event_id: string | null
  booking: {
    id: string
    seats: number | null
    customer: {
      id: string
      first_name: string
      last_name: string | null
      mobile_number: string | null
      sms_opt_in: boolean | null
    } | null
    event: {
      id: string
      name: string
      date: string
      time: string
    } | null
  } | null
}

function normalizeReminderRow(raw: any): ReminderRow {
  const bookingRecord = Array.isArray(raw?.booking) ? raw.booking[0] : raw?.booking
  const customerRecord = Array.isArray(bookingRecord?.customer) ? bookingRecord.customer[0] : bookingRecord?.customer
  const eventRecord = Array.isArray(bookingRecord?.event) ? bookingRecord.event[0] : bookingRecord?.event

  return {
    id: raw?.id,
    reminder_type: raw?.reminder_type,
    scheduled_for: raw?.scheduled_for,
    target_phone: raw?.target_phone ?? null,
    event_id: raw?.event_id ?? null,
    booking: bookingRecord
      ? {
          id: bookingRecord.id,
          seats: bookingRecord.seats ?? null,
          customer: customerRecord
            ? {
                id: customerRecord.id,
                first_name: customerRecord.first_name,
                last_name: customerRecord.last_name ?? null,
                mobile_number: customerRecord.mobile_number ?? null,
                sms_opt_in: customerRecord.sms_opt_in ?? null
              }
            : null,
          event: eventRecord
            ? {
                id: eventRecord.id,
                name: eventRecord.name,
                date: eventRecord.date,
                time: eventRecord.time
              }
            : null
        }
      : null
  }
}

function buildTemplate(reminder: ReminderRow): string {
  const booking = reminder.booking
  if (!booking?.event || !booking.customer) {
    return ''
  }

  const eventDate = new Date(booking.event.date)
  const common = {
    firstName: booking.customer.first_name,
    eventName: booking.event.name,
    eventDate,
    eventTime: booking.event.time ? formatTime12Hour(booking.event.time) : 'TBC',
    seats: booking.seats || 0
  }

  switch (reminder.reminder_type) {
    case 'booking_confirmation':
      return smsTemplates.bookingConfirmationNew({
        ...common,
        seats: common.seats || 0
      })
    case 'booked_1_month':
      return smsTemplates.bookedOneMonth(common)
    case 'booked_1_week':
      return smsTemplates.bookedOneWeek(common)
    case 'booked_1_day':
      return smsTemplates.bookedOneDay(common)
    case 'reminder_invite_1_month':
      return smsTemplates.reminderInviteOneMonth(common)
    case 'reminder_invite_1_week':
      return smsTemplates.reminderInviteOneWeek(common)
    case 'reminder_invite_1_day':
      return smsTemplates.reminderInviteOneDay(common)
    case 'no_seats_2_weeks':
      return smsTemplates.noSeats2Weeks(common)
    case 'no_seats_1_week':
      return smsTemplates.noSeats1Week(common)
    case 'no_seats_day_before':
      return smsTemplates.noSeatsDayBefore(common)
    default:
      return ''
  }
}

export async function processScheduledEventReminders(options: ProcessOptions = {}) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      logger.info('Skipping reminders - Twilio not configured')
      return { success: true, sent: 0, message: 'SMS not configured' }
    }

    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      logger.info('Skipping reminders - No phone number or messaging service')
      return { success: true, sent: 0, message: 'SMS not configured' }
    }

    const now = options.now ?? new Date()
    const nowIso = now.toISOString()

    const supabase = createAdminClient()
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    let query = supabase
      .from('booking_reminders')
      .select(`
        id,
        reminder_type,
        scheduled_for,
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
      .eq('status', 'pending')

    if (options.reminderIds && options.reminderIds.length > 0) {
      query = query.in('id', options.reminderIds)
    } else {
      query = query.lte('scheduled_for', nowIso).order('scheduled_for', { ascending: true }).limit(options.limit ?? 50)
    }

    // Ensure we only process reminders that are due
    query = query.lte('scheduled_for', nowIso)

    const { data: dueReminders, error: fetchError } = await query

    if (fetchError) {
      logger.error('Failed to fetch due reminders', {
        error: fetchError,
        metadata: { time: nowIso }
      })
      return { error: 'Failed to fetch reminders' }
    }

    if (!dueReminders || dueReminders.length === 0) {
      logger.info('No reminders due', { metadata: { time: nowIso } })
      return { success: true, sent: 0, message: 'No reminders due' }
    }

    const reminders: ReminderRow[] = (dueReminders || []).map(normalizeReminderRow)

    const eventIds = new Set<string>()
    const reminderTypes = new Set<ReminderType>()
    const phones = new Set<string>()

    for (const reminder of reminders) {
      if (reminder.event_id) {
        eventIds.add(reminder.event_id)
      }
      reminderTypes.add(reminder.reminder_type)
      if (reminder.target_phone) {
        phones.add(reminder.target_phone)
      } else if (reminder.booking?.customer?.mobile_number) {
        phones.add(reminder.booking.customer.mobile_number)
      }
    }

    let existingKeys = new Set<string>()
    if (eventIds.size > 0 && reminderTypes.size > 0 && phones.size > 0) {
      const { data: sentRows } = await supabase
        .from('booking_reminders')
        .select('event_id, reminder_type, target_phone')
        .eq('status', 'sent')
        .in('event_id', Array.from(eventIds))
        .in('reminder_type', Array.from(reminderTypes))
        .in('target_phone', Array.from(phones))

      if (sentRows) {
        existingKeys = new Set(sentRows.map(row => `${row.target_phone}|${row.event_id}|${row.reminder_type}`))
      }
    }

    const processedKeys = new Set<string>()
    let sentCount = 0
    let failedCount = 0
    let skippedDuplicates = 0

    for (const reminder of reminders) {
      const booking = reminder.booking
      const event = booking?.event
      const customer = booking?.customer
      const seats = booking?.seats || 0

      if (!booking || !event || !customer) {
        await supabase
          .from('booking_reminders')
          .update({ status: 'failed', error_message: 'Incomplete booking context' })
          .eq('id', reminder.id)
        failedCount++
        continue
      }

      if (!customer.sms_opt_in) {
        await supabase
          .from('booking_reminders')
          .update({ status: 'cancelled', error_message: 'Customer opted out' })
          .eq('id', reminder.id)
        continue
      }

      const targetPhone = reminder.target_phone || customer.mobile_number

      if (!targetPhone) {
        await supabase
          .from('booking_reminders')
          .update({ status: 'failed', error_message: 'No mobile number' })
          .eq('id', reminder.id)
        failedCount++
        continue
      }

      const key = `${targetPhone}|${event.id}|${reminder.reminder_type}`
      if (existingKeys.has(key) || processedKeys.has(key)) {
        skippedDuplicates++
        await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Duplicate reminder suppressed'
          })
          .eq('id', reminder.id)
        continue
      }

      const messageFromDb = await getMessageTemplate(event.id, reminder.reminder_type, {
        customer_name: `${customer.first_name} ${customer.last_name || ''}`.trim(),
        first_name: customer.first_name,
        event_name: event.name,
        event_date: new Date(event.date).toLocaleDateString('en-GB', {
          month: 'long',
          day: 'numeric'
        }),
        event_time: event.time,
        seats: seats.toString(),
        venue_name: 'The Anchor',
        contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
      })

      const messageBody = messageFromDb || buildTemplate(reminder)

      if (!messageBody) {
        await supabase
          .from('booking_reminders')
          .update({ status: 'failed', error_message: 'Missing SMS template' })
          .eq('id', reminder.id)
        failedCount++
        continue
      }

      const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
      const messageWithSupport = ensureReplyInstruction(messageBody, supportPhone)

      const messageParams: any = {
        body: messageWithSupport,
        to: targetPhone
      }

      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
      } else if (process.env.TWILIO_PHONE_NUMBER) {
        messageParams.from = process.env.TWILIO_PHONE_NUMBER
      }

      try {
        const twilioMessage = await twilioClient.messages.create(messageParams)

        const messageLength = messageWithSupport.length
        const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
        const costUsd = segments * 0.04

        const messageInsertBase = {
          customer_id: customer.id,
          direction: 'outbound' as const,
          message_sid: twilioMessage.sid,
          twilio_message_sid: twilioMessage.sid,
          body: messageWithSupport,
          status: twilioMessage.status || 'queued',
          twilio_status: twilioMessage.status || 'queued',
          from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
          to_number: twilioMessage.to,
          message_type: 'sms' as const,
          segments,
          cost_usd: costUsd,
          read_at: new Date().toISOString()
        }

        let loggedMessageId: string | null = null

        const messagePayloads = [
          {
            ...messageInsertBase,
            metadata: {
              reminder_id: reminder.id,
              reminder_type: reminder.reminder_type,
              booking_id: booking.id,
              event_id: event.id
            }
          },
          messageInsertBase
        ]

        for (const payload of messagePayloads) {
          if (loggedMessageId) break

          const { data, error: messageInsertError } = await supabase
            .from('messages')
            .insert(payload)
            .select('id')
            .single()

          if (messageInsertError) {
            logger.error('Failed to log reminder SMS message', {
              error: messageInsertError,
              metadata: {
                reminderId: reminder.id,
                customerId: customer.id,
                hasMetadata: 'metadata' in payload
              }
            })

            continue
          }

          loggedMessageId = data?.id ?? null
        }

        const { error: reminderUpdateError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'sent',
            sent_at: nowIso,
            message_id: loggedMessageId,
            target_phone: targetPhone,
            event_id: event.id
          })
          .eq('id', reminder.id)

        if (reminderUpdateError) {
          logger.error('Failed to update booking reminder after send', {
            error: reminderUpdateError,
            metadata: {
              reminderId: reminder.id,
              bookingId: booking.id,
              type: reminder.reminder_type
            }
          })
        }

        const { error: bookingUpdateError } = await supabase
          .from('bookings')
          .update({ last_reminder_sent: nowIso })
          .eq('id', booking.id)

        if (bookingUpdateError) {
          logger.error('Failed to stamp booking with last reminder sent', {
            error: bookingUpdateError,
            metadata: {
              bookingId: booking.id,
              reminderId: reminder.id
            }
          })
        }

        sentCount++
        processedKeys.add(key)

        logger.info('Reminder sent successfully', {
          metadata: {
            reminderId: reminder.id,
            bookingId: booking.id,
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
            bookingId: booking.id,
            type: reminder.reminder_type
          }
        })

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
        failed: failedCount,
        duplicates: skippedDuplicates
      }
    })

    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      duplicates: skippedDuplicates,
      message: `Processed ${dueReminders.length} reminders: ${sentCount} sent, ${failedCount} failed, ${skippedDuplicates} suppressed`
    }
  } catch (error) {
    logger.error('Error processing scheduled reminders', {
      error: error as Error
    })
    return { error: 'Failed to process reminders' }
  }
}
