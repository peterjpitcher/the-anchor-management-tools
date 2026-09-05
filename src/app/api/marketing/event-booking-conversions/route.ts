import { NextRequest } from 'next/server'
import { z } from 'zod'

import { withApiAuth, createApiResponse, createErrorResponse, createCorsPreflightResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.generated'

const QuerySchema = z.object({
  event_ids: z.string().transform((value) => value.split(',').map((id) => id.trim()))
    .pipe(z.array(z.string().uuid('event_ids must contain valid UUIDs')).min(1).max(100))
    .transform((ids) => [...new Set(ids)]),
  since: z.string().datetime().optional(),
})

// Seating is recorded by seated_at, not a booking status. Review transitions
// must retain the completed visit as conversion evidence.
const CONVERTED_STATUSES = [
  'confirmed', 'completed', 'visited_waiting_for_review', 'review_clicked',
] satisfies Database['public']['Enums']['table_booking_status'][]

type BookingConversionRow = {
  id: string
  event_id: string | null
  event_booking_id: string | null
  party_size: number | null
  status: string | null
  source: string | null
  created_at: string | null
}

export async function GET(request: NextRequest) {
  return withApiAuth(async (req) => {
    const url = new URL(req.url)
    const parsed = QuerySchema.safeParse({
      event_ids: url.searchParams.get('event_ids') ?? '',
      since: url.searchParams.get('since') ?? undefined,
    })

    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.issues[0]?.message || 'Invalid query string',
        'VALIDATION_ERROR',
        400,
        { issues: parsed.error.issues },
        'private'
      )
    }

    const eventIds = parsed.data.event_ids

    const supabase = createAdminClient()
    let query = supabase
      .from('table_bookings')
      .select('id, event_id, event_booking_id, party_size, status, source, created_at')
      .in('event_id', eventIds)
      .in('status', CONVERTED_STATUSES)
      .order('created_at', { ascending: true })

    if (parsed.data.since) {
      query = query.gte('created_at', parsed.data.since)
    }

    const { data, error } = await query

    if (error) {
      console.error('[marketing-conversions] Booking query failed', { code: error.code })
      return createErrorResponse('Failed to load event booking conversions', 'DATABASE_ERROR', 500, undefined, 'private')
    }

    const conversions = ((data ?? []) as BookingConversionRow[])
      .filter((row) => row.event_id)
      .map((row) => ({
        booking_id: row.event_booking_id || row.id,
        table_booking_id: row.id,
        event_id: row.event_id,
        booking_type: 'event',
        tickets: typeof row.party_size === 'number' && Number.isFinite(row.party_size) ? row.party_size : 1,
        source: row.source || 'management_app',
        occurred_at: row.created_at || new Date().toISOString(),
      }))

    return createApiResponse({
      conversions,
      count: conversions.length,
    }, 200, {}, 'GET', 'private')
  }, ['read:events'], request, { cacheMode: 'private' })
}

export async function OPTIONS(request: NextRequest) {
  return createCorsPreflightResponse({ request, methods: 'GET, OPTIONS' })
}
