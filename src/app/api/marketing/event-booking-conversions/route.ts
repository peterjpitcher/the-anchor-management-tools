import { NextRequest } from 'next/server'
import { z } from 'zod'

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const QuerySchema = z.object({
  event_ids: z.string().trim().min(1, 'event_ids is required'),
  since: z.string().datetime().optional(),
})

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
        { issues: parsed.error.issues }
      )
    }

    const eventIds = parsed.data.event_ids
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    if (eventIds.length === 0 || eventIds.length > 100) {
      return createErrorResponse('event_ids must contain 1 to 100 ids', 'VALIDATION_ERROR', 400)
    }

    const supabase = createAdminClient()
    let query = supabase
      .from('table_bookings')
      .select('id, event_id, event_booking_id, party_size, status, source, created_at')
      .in('event_id', eventIds)
      .in('status', ['confirmed', 'seated', 'completed'])
      .order('created_at', { ascending: true })

    if (parsed.data.since) {
      query = query.gte('created_at', parsed.data.since)
    }

    const { data, error } = await query

    if (error) {
      return createErrorResponse('Failed to load event booking conversions', 'DATABASE_ERROR', 500)
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
    })
  }, ['read:events'], request)
}

export async function OPTIONS() {
  return createApiResponse({}, 200)
}
