import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { EventMarketingService } from '@/services/event-marketing'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { EVENT_MARKETING_CHANNELS } from '@/lib/event-marketing-links'

// Always-on channel keys — we check for these to determine if a backfill is needed
const ALWAYS_ON_KEYS = EVENT_MARKETING_CHANNELS
  .filter(c => c.tier === 'always_on')
  .map(c => c.key)

const CHUNK_SIZE = 10 // Smaller chunks to avoid DB overload during backfill

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export async function GET(request: Request) {
  try {
    const auth = authorizeCronRequest(request)
    if (!auth.authorized) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // target=draft|scheduled|all (default: all)
    const url = new URL(request.url)
    const target = url.searchParams.get('target') ?? 'all'

    const supabase = createAdminClient()
    const todayIso = getTodayIsoDate()

    // Build query based on target
    let query = supabase.from('events').select('id, name, event_status')

    if (target === 'draft') {
      query = query.eq('event_status', 'draft')
    } else if (target === 'scheduled') {
      query = query
        .in('event_status', ['scheduled', 'sold_out', 'rescheduled', 'postponed'])
        .gte('date', todayIso)
    } else {
      // all: draft + upcoming scheduled variants
      query = query
        .or(`event_status.eq.draft,and(event_status.in.(scheduled,sold_out,rescheduled,postponed),date.gte.${todayIso})`)
    }

    const { data: events, error: eventsError } = await query.order('id')

    if (eventsError) {
      console.error('[Backfill Marketing Links] Failed to load events', eventsError)
      return new NextResponse('Failed to load events', { status: 500 })
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ success: true, processed: 0, skipped: 0, failed: 0, message: 'No events to backfill' })
    }

    const eventIds = events.map(e => e.id)

    // Find which events are already missing at least one always-on channel
    // by loading existing short_links metadata for these events
    const { data: existingLinks, error: linksError } = await supabase
      .from('short_links')
      .select('metadata')
      .filter('metadata->>event_id', 'in', `(${eventIds.map(id => `"${id}"`).join(',')})`)

    if (linksError) {
      console.error('[Backfill Marketing Links] Failed to load existing links', linksError)
      return new NextResponse('Failed to load existing links', { status: 500 })
    }

    // Build a Set<eventId> for events that have all always-on channels
    const channelsByEvent = new Map<string, Set<string>>()
    for (const row of existingLinks ?? []) {
      const meta = row.metadata as { event_id?: string; channel?: string } | null
      if (!meta?.event_id || !meta?.channel) continue
      const existing = channelsByEvent.get(meta.event_id) ?? new Set()
      existing.add(meta.channel)
      channelsByEvent.set(meta.event_id, existing)
    }

    const eventsNeedingBackfill = events.filter(event => {
      const existing = channelsByEvent.get(event.id) ?? new Set()
      return ALWAYS_ON_KEYS.some(key => !existing.has(key))
    })

    if (eventsNeedingBackfill.length === 0) {
      return NextResponse.json({
        success: true,
        total: events.length,
        processed: 0,
        skipped: events.length,
        failed: 0,
        message: 'All events already have always-on links — no backfill needed'
      })
    }

    let processed = 0
    let failed = 0
    const failures: { id: string; name: string; error: string }[] = []

    const chunks = chunkArray(eventsNeedingBackfill, CHUNK_SIZE)

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async event => {
          try {
            await EventMarketingService.generateLinks(event.id)
            processed++
          } catch (err) {
            failed++
            failures.push({
              id: event.id,
              name: event.name,
              error: err instanceof Error ? err.message : 'Unknown error'
            })
            console.error(`[Backfill Marketing Links] Failed for event ${event.id} (${event.name})`, err)
          }
        })
      )
    }

    return NextResponse.json({
      success: true,
      target,
      total: events.length,
      needingBackfill: eventsNeedingBackfill.length,
      processed,
      skipped: events.length - eventsNeedingBackfill.length,
      failed,
      ...(failures.length > 0 ? { failures } : {})
    })
  } catch (error) {
    console.error('[Backfill Marketing Links] Unexpected error', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
