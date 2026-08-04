import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { reportCronFailure } from '@/lib/cron/alerting'
import { getLocalIsoDateDaysAgo } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'
import { GdprService } from '@/services/gdpr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Seasonal pre-orders, spec section 9: two years, everything, one rule.
 *
 * The owner's purpose is preparing food safely and recognising a returning guest's requirements, so
 * dish choices, guest names and dietary notes all share one period rather than being split. Nothing
 * here is gated on the `preorder_enabled` switch: retention is a promise made to guests about data
 * already collected, and a feature flag turned off must not quietly stop the pub honouring it.
 */
const PREORDER_RETENTION_DAYS = 730
/** PostgREST puts `in` lists in the query string, so they are chunked to keep the URL sane. */
const ID_CHUNK_SIZE = 200

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function runPreorderRetentionCleanup() {
  const supabase = createAdminClient()
  const cutoffDate = getLocalIsoDateDaysAgo(PREORDER_RETENTION_DAYS)

  // Walked from the pre-order tables inwards rather than from table_bookings outwards: only bookings
  // that ever took a pre-order have rows here, so this reads thousands of ids rather than every
  // booking the pub has ever taken.
  const [{ data: coverRows, error: coverError }, { data: reminderRows, error: reminderError }] =
    await Promise.all([
      supabase.from('booking_preorder_covers').select('table_booking_id'),
      supabase.from('booking_preorder_reminders').select('table_booking_id'),
    ])

  if (coverError) throw coverError
  if (reminderError) throw reminderError

  const candidateIds = Array.from(
    new Set(
      [...(coverRows ?? []), ...(reminderRows ?? [])].map(
        (row) => (row as { table_booking_id: string }).table_booking_id,
      ),
    ),
  )

  if (candidateIds.length === 0) {
    return { cutoffDate, bookingsPurged: 0, covers: 0, reminders: 0 }
  }

  const expiredIds: string[] = []
  for (const ids of chunk(candidateIds, ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('table_bookings')
      .select('id')
      .in('id', ids)
      .lt('booking_date', cutoffDate)

    if (error) throw error
    expiredIds.push(...((data ?? []) as Array<{ id: string }>).map((row) => row.id))
  }

  if (expiredIds.length === 0) {
    return { cutoffDate, bookingsPurged: 0, covers: 0, reminders: 0 }
  }

  let covers = 0
  let reminders = 0
  for (const ids of chunk(expiredIds, ID_CHUNK_SIZE)) {
    // Selections carry no date of their own and cascade from the cover, so deleting covers takes
    // the dish choices with them.
    const { data: deletedCovers, error: deleteCoverError } = await supabase
      .from('booking_preorder_covers')
      .delete()
      .in('table_booking_id', ids)
      .select('id')

    if (deleteCoverError) throw deleteCoverError
    covers += (deletedCovers ?? []).length

    const { data: deletedReminders, error: deleteReminderError } = await supabase
      .from('booking_preorder_reminders')
      .delete()
      .in('table_booking_id', ids)
      .select('id')

    if (deleteReminderError) throw deleteReminderError
    reminders += (deletedReminders ?? []).length
  }

  return { cutoffDate, bookingsPurged: expiredIds.length, covers, reminders }
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Communications first, so a fault in the newer pre-order purge cannot hold up the older
    // cleanup that has been running to a schedule for years.
    const result = await GdprService.runCommunicationRetentionCleanup()
    logger.info('Communications retention cleanup completed', {
      metadata: result,
    })

    const preorders = await runPreorderRetentionCleanup()
    logger.info('Pre-order retention cleanup completed', {
      metadata: preorders,
    })

    return NextResponse.json({ success: true, result, preorders })
  } catch (error) {
    logger.error('Retention cleanup failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await reportCronFailure('communications-retention', error)
    return NextResponse.json({ success: false, error: 'Retention cleanup failed' }, { status: 500 })
  }
}
