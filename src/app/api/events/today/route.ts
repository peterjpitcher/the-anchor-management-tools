import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const supabase = createAdminClient();
    const today = new Date().toISOString().split('T')[0];
    
    const { data: events, error } = await supabase
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
        bookings(count)
      `)
      .eq('date', today)
      .eq('event_status', 'scheduled')
      .order('time', { ascending: true });

    if (error) {
      return createErrorResponse('Failed to fetch today\'s events', 'DATABASE_ERROR', 500);
    }

    // Transform events to Schema.org format
    const schemaEvents = events?.map(event => {
      const bookingCount = event.bookings?.[0]?.count || 0;
      return {
        id: event.id,
        ...eventToSchema(event, bookingCount),
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