import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import {
  processPubOpsCalendarNoteQueueItem,
  type PubOpsCalendarNoteQueueItem,
} from '@/lib/google-calendar-notes'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_LIMIT = 100
const HARD_LIMIT = 200
const SYNC_CONCURRENCY = 2
const BATCH_DELAY_MS = 500
const RECONCILIATION_LIMIT = 25
const RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000
const CALENDAR_TIME_ZONE = 'Europe/London'

export const maxDuration = 300

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT
  }
  return Math.min(parsed, HARD_LIMIT)
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function calendarNoteSyncQueue(client: unknown) {
  return (client as { from: (table: string) => any }).from('calendar_note_google_sync_queue')
}

function calendarNoteSyncRpc(client: unknown) {
  return client as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  }
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const noteId = url.searchParams.get('noteId')?.trim() || null
  const supabase = createAdminClient()

  try {
    if (noteId) {
      const result = await processPubOpsCalendarNoteQueueItem(supabase, noteId, {
        force: true,
        context: { context: 'pub_ops_calendar_note_single_sync' },
      })

      return NextResponse.json({
        success: result.state !== 'failed',
        processed: 1,
        result,
      })
    }

    const { data, error } = await calendarNoteSyncQueue(supabase)
      .select('note_id, operation, generation, attempts')
      .eq('status', 'pending')
      .lte('available_at', new Date().toISOString())
      .order('available_at', { ascending: true })
      .order('updated_at', { ascending: true })
      .limit(limit)

    if (error) {
      throw error
    }

    const queueItems = (data || []) as PubOpsCalendarNoteQueueItem[]
    let reconciliationItems: PubOpsCalendarNoteQueueItem[] = []
    const remainingCapacity = Math.min(
      limit - queueItems.length,
      RECONCILIATION_LIMIT
    )

    if (remainingCapacity > 0) {
      const reconciliationNow = new Date()
      const { data: reconciliationData, error: reconciliationError } =
        await calendarNoteSyncRpc(supabase).rpc(
          'requeue_stale_calendar_note_google_sync',
          {
            p_today: formatInTimeZone(
              reconciliationNow,
              CALENDAR_TIME_ZONE,
              'yyyy-MM-dd'
            ),
            p_synced_before: new Date(
              reconciliationNow.getTime() - RECONCILIATION_INTERVAL_MS
            ).toISOString(),
            p_limit: remainingCapacity,
          }
        )

      if (reconciliationError) {
        throw new Error(reconciliationError.message)
      }

      reconciliationItems = (reconciliationData || []) as PubOpsCalendarNoteQueueItem[]
    }

    const workItems = [
      ...queueItems.map((item) => ({
        item,
        context: 'pub_ops_calendar_note_queue',
      })),
      ...reconciliationItems.map((item) => ({
        item,
        context: 'pub_ops_calendar_note_reconciliation',
      })),
    ]
    const results = []
    const counts = {
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
    }
    const batches = chunkItems(workItems, SYNC_CONCURRENCY)

    for (const [batchIndex, batch] of batches.entries()) {
      const batchResults = await Promise.all(
        batch.map(({ item, context }) =>
          processPubOpsCalendarNoteQueueItem(supabase, item.note_id, {
            expectedGeneration: item.generation,
            context: { context },
          })
        )
      )

      for (const result of batchResults) {
        counts[result.state] += 1
        results.push(result)
      }

      if (batchIndex < batches.length - 1) {
        await delay(BATCH_DELAY_MS)
      }
    }

    return NextResponse.json({
      success: true,
      processed: workItems.length,
      queued: queueItems.length,
      reconciled: reconciliationItems.length,
      limit,
      counts,
      results,
    })
  } catch (error) {
    logger.error('Failed to reconcile Pub Ops calendar notes', {
      error: error instanceof Error ? error : new Error(String(error)),
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sync Pub Ops calendar notes',
      },
      { status: 500 }
    )
  }
}
