'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'
import { ReminderType } from './event-sms-scheduler'
import { ReminderRow, normalizeReminderRow } from '@/lib/reminders/reminder-utils'

interface ProcessOptions {
  reminderIds?: string[]
  limit?: number
  now?: Date
}

export async function processScheduledEventReminders(options: ProcessOptions = {}) {
  try {
    const now = options.now ?? new Date()
    const nowIso = now.toISOString()

    const supabase = createAdminClient()

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
      return { success: true, queued: 0, message: 'No reminders due' }
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
    let queuedCount = 0
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

      try {
        const enqueueResult = await jobQueue.enqueue(
          'process_event_reminder',
          { reminder_id: reminder.id },
          { priority: 5, unique: `event-reminder-${reminder.id}` }
        )

        if (!enqueueResult.success) {
          throw new Error(enqueueResult.error || 'Failed to enqueue reminder job')
        }

        await supabase
          .from('booking_reminders')
          .update({
            target_phone: targetPhone,
            event_id: event.id,
            error_message: null
          })
          .eq('id', reminder.id)

        queuedCount++
        processedKeys.add(key)

        logger.info('Reminder job enqueued', {
          metadata: {
            reminderId: reminder.id,
            bookingId: booking.id,
            type: reminder.reminder_type,
            jobId: enqueueResult.jobId
          }
        })
      } catch (error) {
        failedCount++
        logger.error('Failed to enqueue reminder job', {
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
            error_message: error instanceof Error ? error.message : 'Failed to enqueue reminder job'
          })
          .eq('id', reminder.id)
      }
    }

    logger.info('Reminder enqueue complete', {
      metadata: {
        processed: dueReminders.length,
        queued: queuedCount,
        failed: failedCount,
        duplicates: skippedDuplicates
      }
    })

    return {
      success: true,
      queued: queuedCount,
      failed: failedCount,
      duplicates: skippedDuplicates,
      message: `Processed ${dueReminders.length} reminders: ${queuedCount} queued, ${failedCount} failed, ${skippedDuplicates} suppressed`
    }
  } catch (error) {
    logger.error('Error processing scheduled reminders', {
      error: error as Error
    })
    return { error: 'Failed to process reminders' }
  }
}
