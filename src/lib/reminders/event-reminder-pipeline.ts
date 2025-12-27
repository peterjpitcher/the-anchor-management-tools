import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { differenceInHours, isAfter } from 'date-fns'
import { ReminderRow, normalizeReminderRow } from './reminder-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { formatPhoneForStorage } from '@/lib/validation'
import { sendEventReminderById } from './send-event-reminder'

const LONDON_TZ = 'Europe/London'
const PAST_EVENT_GRACE_HOURS = 12 // Do not send reminders for events more than 12h in the past

type QueueOptions = {
  reminderIds?: string[]
  limit?: number
  now?: Date
}

export type QueueResult = {
  success: true
  sent: number
  cancelled: number
  failed: number
  duplicates: number
  skipped: number
  queued: number
  message: string
} | { success: false; error: string }

function buildEventDate(reminder: ReminderRow): Date | null {
  const event = reminder.booking?.event
  if (!event?.date) return null

  const time = event.time || '23:59:59'
  const zoned = fromZonedTime(`${event.date}T${time}`, LONDON_TZ)
  return toZonedTime(zoned, LONDON_TZ)
}

function buildKey(reminder: ReminderRow, phone: string) {
  return `${reminder.event_id}|${phone}|${reminder.reminder_type}`
}

async function cancelReminder(
  supabase: ReturnType<typeof createAdminClient>,
  reminderId: string,
  error_message: string
) {
  await supabase
    .from('booking_reminders')
    .update({ status: 'cancelled', error_message, updated_at: new Date().toISOString() })
    .eq('id', reminderId)
}

async function failReminder(
  supabase: ReturnType<typeof createAdminClient>,
  reminderId: string,
  error_message: string
) {
  await supabase
    .from('booking_reminders')
    .update({ status: 'failed', error_message, updated_at: new Date().toISOString() })
    .eq('id', reminderId)
}

export async function queueDueEventReminders(options: QueueOptions = {}): Promise<QueueResult> {
  try {
    const now = options.now ?? new Date()
    const nowIso = now.toISOString()
    const supabase = createAdminClient()
    const batchSize = options.limit ?? 50
    const drainFully = !options.reminderIds?.length

    const totals = {
      sent: 0,
      cancelled: 0,
      failed: 0,
      duplicates: 0,
      skipped: 0,
      queued: 0
    }

    const seenKeys = new Set<string>()
    let batchCount = 0

    while (true) {
      batchCount += 1

      let query = supabase
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
        .in('status', ['pending', 'queued'])
        .lte('scheduled_for', nowIso)

      if (options.reminderIds?.length) {
        query = query.in('id', options.reminderIds)
      } else {
        query = query
          .order('scheduled_for', { ascending: true })
          .limit(batchSize)
      }

      const { data, error } = await query

      if (error) {
        logger.error('Failed to fetch due reminders', { error, metadata: { time: nowIso } })
        return { success: false, error: 'Failed to fetch reminders' }
      }

      if (!data || data.length === 0) {
        if (batchCount === 1) {
          return {
            success: true,
            queued: 0,
            cancelled: 0,
            failed: 0,
            duplicates: 0,
            skipped: 0,
            sent: 0,
            message: 'No reminders due'
          }
        }
        break
      }

      const reminders: ReminderRow[] = data.map(normalizeReminderRow)
      const validReminders: Array<{ reminder: ReminderRow; phone: string }> = []
      const duplicateIds: string[] = []
      const cancelIds: Array<{ id: string; reason: string }> = []

      // Local dedupe and validation pass
      for (const reminder of reminders) {
        const booking = reminder.booking
        const event = booking?.event
        const customer = booking?.customer

        if (!booking || !event || !customer) {
          cancelIds.push({ id: reminder.id, reason: 'Incomplete booking context' })
          continue
        }

        if (customer.sms_opt_in === false) {
          cancelIds.push({ id: reminder.id, reason: 'Customer opted out' })
          continue
        }

        const phoneCandidate = reminder.target_phone || customer.mobile_number
        if (!phoneCandidate) {
          cancelIds.push({ id: reminder.id, reason: 'Missing phone number' })
          continue
        }

        let normalizedPhone: string
        try {
          normalizedPhone = formatPhoneForStorage(phoneCandidate)
        } catch (err) {
          cancelIds.push({ id: reminder.id, reason: 'Invalid phone number' })
          continue
        }

        const eventDate = buildEventDate(reminder)
        if (!eventDate) {
          cancelIds.push({ id: reminder.id, reason: 'Missing event date' })
          continue
        }

        if (!isAfter(eventDate, now) && differenceInHours(now, eventDate) > PAST_EVENT_GRACE_HOURS) {
          cancelIds.push({ id: reminder.id, reason: 'Event already passed' })
          continue
        }

        const key = buildKey(reminder, normalizedPhone)
        if (seenKeys.has(key)) {
          duplicateIds.push(reminder.id)
          continue
        }

        seenKeys.add(key)
        validReminders.push({ reminder, phone: normalizedPhone })
      }

      // Persist cancellations
      if (cancelIds.length > 0) {
        const { error: cancelError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Suppressed by new reminder pipeline',
            updated_at: nowIso
          })
          .in('id', cancelIds.map(item => item.id))

        if (cancelError) {
          logger.error('Failed to cancel invalid reminders', { error: cancelError })
        }
      }

      // Persist duplicate suppression
      if (duplicateIds.length > 0) {
        const { error: dupError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Duplicate reminder suppressed',
            updated_at: nowIso
          })
          .in('id', duplicateIds)

        if (dupError) {
          logger.error('Failed to cancel duplicate reminders', { error: dupError })
        }
      }

      totals.cancelled += cancelIds.length + duplicateIds.length
      totals.duplicates += duplicateIds.length
      totals.skipped += cancelIds.length

      if (validReminders.length === 0) {
        if (!drainFully) break
        continue
      }

      // Check already sent/queued in DB to enforce idempotency across runs
      const eventIds = Array.from(new Set(validReminders.map(item => item.reminder.event_id).filter(Boolean)))
      const phones = Array.from(new Set(validReminders.map(item => item.phone)))
      const reminderTypes = Array.from(new Set(validReminders.map(item => item.reminder.reminder_type)))

      let existingKeys = new Set<string>()
      if (eventIds.length && phones.length && reminderTypes.length) {
        const { data: existingRows, error: existingError } = await supabase
          .from('booking_reminders')
          .select('event_id, target_phone, reminder_type, status')
          .in('event_id', eventIds)
          .in('target_phone', phones)
          .in('reminder_type', reminderTypes)
          .in('status', ['sent', 'queued', 'sending'])

        if (!existingError && existingRows) {
          existingKeys = new Set(
            existingRows.map(row => `${row.event_id}|${row.target_phone}|${row.reminder_type}`)
          )
        }
      }

      let suppressed = 0
      let jobQueueErrors = 0
      const { jobQueue } = await import('@/lib/background-jobs')

      for (const { reminder, phone } of validReminders) {
        const key = buildKey(reminder, phone)
        if (existingKeys.has(key)) {
          suppressed += 1
          await cancelReminder(supabase, reminder.id, 'Duplicate reminder suppressed (already sent/queued)')
          continue
        }

        try {
          // Changed: Instead of sending directly, we enqueue a background job.
          // We mark the status as 'queued' immediately to prevent re-processing in the next tick.

          await jobQueue.enqueue('process_event_reminder', { reminderId: reminder.id })

          const { error: updateError } = await supabase
            .from('booking_reminders')
            .update({
              status: 'queued',
              updated_at: new Date().toISOString()
            })
            .eq('id', reminder.id)

          if (updateError) {
            // If we can't update status, we log it but the job will likely still run.
            // This is a rare edge case.
            logger.error('Failed to update reminder status to queued', {
              error: updateError,
              metadata: { reminderId: reminder.id }
            })
          }

          totals.queued += 1
          existingKeys.add(key)
        } catch (err) {
          jobQueueErrors += 1
          totals.failed += 1
          // If queueing fails, we mark as failed so it can be retried or investigated later
          await failReminder(supabase, reminder.id, err instanceof Error ? err.message : 'Failed to enqueue reminder job')
        }
      }

      totals.cancelled += suppressed
      totals.duplicates += suppressed

      // Carry over dedupe keys so later batches remain idempotent within this run
      existingKeys.forEach(key => seenKeys.add(key))

      const drainedBatch = !drainFully || data.length < batchSize
      if (drainedBatch) {
        break
      }

      // Safety to prevent unbounded loops
      if (batchCount > 50) {
        logger.warn('Stopping reminder drain after 50 batches to avoid runaway loop', {
          metadata: { queued: totals.queued, failed: totals.failed, cancelled: totals.cancelled }
        })
        break
      }
    }

    return {
      success: true,
      sent: 0, // No longer sending synchronously
      cancelled: totals.cancelled,
      failed: totals.failed,
      duplicates: totals.duplicates,
      skipped: totals.skipped,
      queued: totals.queued,
      message: `Queued ${totals.queued}, cancelled ${totals.cancelled}, failed ${totals.failed}`
    }
  } catch (error) {
    logger.error('queueDueEventReminders error', { error: error as Error })
    return { success: false, error: 'Failed to queue reminders' }
  }
}
