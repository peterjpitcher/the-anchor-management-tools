import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { logger } from '@/lib/logger'

const DEFAULT_LIMIT = 200
const HARD_LIMIT = 500
const SYNC_CONCURRENCY = 10
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

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const includePast = url.searchParams.get('includePast') === 'true'
  const eventId = url.searchParams.get('eventId')?.trim() || null
  const supabase = createAdminClient()

  try {
    let eventIds: string[]

    if (eventId) {
      eventIds = [eventId]
    } else {
      let query = supabase
        .from('events')
        .select('id')
        .order('date', { ascending: true })
        .order('time', { ascending: true })
        .limit(limit)

      if (!includePast) {
        query = query.gte(
          'date',
          formatInTimeZone(new Date(), CALENDAR_TIME_ZONE, 'yyyy-MM-dd')
        )
      }

      const { data, error } = await query

      if (error) {
        throw error
      }

      eventIds = (data || []).map((event) => event.id).filter(Boolean)
    }

    const results = []
    const counts = {
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
    }

    for (const batch of chunkItems(eventIds, eventId ? 1 : SYNC_CONCURRENCY)) {
      const batchResults = await Promise.all(
        batch.map((id) =>
          syncPubOpsEventCalendarByEventId(supabase, id, {
            context: eventId
              ? 'pub_ops_event_calendar_single_sync'
              : 'pub_ops_event_calendar_backfill',
          })
        )
      )

      for (const result of batchResults) {
        counts[result.state] += 1
        results.push(result)
      }
    }

    return NextResponse.json({
      success: true,
      processed: eventIds.length,
      limit,
      includePast,
      counts,
      results,
    })
  } catch (error) {
    logger.error('Failed to sync Pub Ops event calendar backfill', {
      error: error instanceof Error ? error : new Error(String(error)),
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sync Pub Ops event calendar',
      },
      { status: 500 }
    )
  }
}
