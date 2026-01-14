import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';
import { getTodayIsoDate } from '@/lib/dateUtils';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const { searchParams } = new URL(_request.url);
    const status = searchParams.get('status');
    const supabase = createAdminClient();
    const today = getTodayIsoDate();

    let query = supabase
      .from('events')
      .select(`
        *,
        category:event_categories(
          id,
          name,
          description,
          color,
          icon
        ),
        booking_totals:bookings(sum:seats)
      `)
      .eq('date', today)
      .order('time', { ascending: true });

    // Apply filters
    if (status && status !== 'all') {
      const statuses = status.split(',').map(s => s.trim());
      query = query.in('event_status', statuses);
    } else if (!status) {
      query = query.eq('event_status', 'scheduled');
    }

    const { data: events, error } = await query;

    if (error) {
      return createErrorResponse('Failed to fetch today\'s events', 'DATABASE_ERROR', 500);
    }

    // Transform events to Schema.org format
    const schemaEvents = events?.map(event => {
      const bookedSeats = (event.booking_totals?.[0]?.sum as number | null) ?? 0;
      return {
        id: event.id,
        slug: event.slug,
        bookingUrl: event.booking_url || null,
        event_status: event.event_status,
        ...eventToSchema(event, bookedSeats),
      };
    }) || [];

    return createApiResponse({
      events: schemaEvents,
      meta: {
        date: today,
        total: schemaEvents.length,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:events'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
