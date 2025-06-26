import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const supabase = createAdminClient();
    
    // Get parent recurring events
    const { data: recurringEvents, error } = await supabase
      .from('events')
      .select(`
        *,
        category:event_categories(
          id,
          name,
          description,
          color,
          icon
        )
      `)
      .eq('is_recurring', true)
      .is('parent_event_id', null)
      .order('name', { ascending: true });

    if (error) {
      return createErrorResponse('Failed to fetch recurring events', 'DATABASE_ERROR', 500);
    }

    // Transform to include recurrence information
    const formattedEvents = recurringEvents?.map(event => ({
      id: event.id,
      name: event.name,
      description: event.description,
      category: event.category,
      recurrence_rule: event.recurrence_rule || 'weekly',
      default_time: event.time,
      default_capacity: event.capacity,
      performer: event.performer_name ? {
        name: event.performer_name,
        type: event.performer_type || 'Person',
      } : undefined,
      price: {
        amount: event.price || 0,
        currency: event.price_currency || 'GBP',
        is_free: event.is_free !== false,
      },
    })) || [];

    return createApiResponse({
      recurring_events: formattedEvents,
      meta: {
        total: formattedEvents.length,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:events'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}