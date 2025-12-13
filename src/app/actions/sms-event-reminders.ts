'use server'

import { logger } from '@/lib/logger'
import { queueDueEventReminders } from '@/lib/reminders/event-reminder-pipeline'

const eventSmsPaused = () =>
  process.env.SUSPEND_EVENT_SMS === 'true' || process.env.SUSPEND_ALL_SMS === 'true'

interface ProcessOptions {
  reminderIds?: string[]
  limit?: number
  now?: Date
}

export async function processScheduledEventReminders(options: ProcessOptions = {}) {
  try {
    const now = options.now ?? new Date()

    if (eventSmsPaused()) {
      logger.warn('Event SMS paused, skipping reminder processing', {
        metadata: {
          reminderIds: options.reminderIds?.length || 0
        }
      })
      return { success: true, sent: 0, failed: 0, duplicates: 0, cancelled: 0, skipped: 0, message: 'Event SMS paused' }
    }

    const result = await queueDueEventReminders({
      reminderIds: options.reminderIds,
      limit: options.limit,
      now
    })

    if (!result.success) {
      return { error: result.error }
    }

    logger.info('Reminder enqueue complete', {
      metadata: {
        sent: result.sent,
        cancelled: result.cancelled,
        failed: result.failed,
        duplicates: result.duplicates,
        skipped: result.skipped
      }
    })

    return result
  } catch (error) {
    logger.error('Error processing scheduled reminders', {
      error: error as Error
    })
    return { error: 'Failed to process reminders' }
  }
}
