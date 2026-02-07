import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { resolveStatusFilters } from '@/lib/events/status-filters';
// Removed unused date-fns imports

type EventFaqRow = {
  sort_order: number | null;
};

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const { searchParams } = new URL(_request.url);
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const categoryId = searchParams.get('category_id');
    const status = searchParams.get('status');
    const availableOnly = searchParams.get('available_only') === 'true';
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

    const supabase = createAdminClient();
    const { statuses, applyAvailabilityFilter, emptyResult } = resolveStatusFilters(status, availableOnly);

    if (emptyResult) {
      return createApiResponse({
        events: [],
        meta: {
          total: 0,
          limit,
          offset,
          has_more: false,
          lastUpdated: new Date().toISOString(),
        },
      });
    }

    // Build query with all enhanced fields
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
        event_faqs(
          id,
          question,
          answer,
          sort_order
        )
      `, { count: 'exact' })
      // Removed hardcoded .eq('event_status', 'scheduled')
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (statuses) {
      query = query.in('event_status', statuses);
    }
    if (applyAvailabilityFilter) {
      query = query.or('event_status.is.null,event_status.not.in.(sold_out,cancelled,draft)');
    }

    if (fromDate) {
      query = query.gte('date', fromDate);
    } else {
      // Default to today
      query = query.gte('date', getTodayIsoDate());
    }

    if (toDate) {
      query = query.lte('date', toDate);
    }

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data: events, error, count } = await query;

    if (error) {
      return createErrorResponse('Failed to fetch events', 'DATABASE_ERROR', 500);
    }

    // Transform events to Schema.org format with FAQs
    const schemaEvents = (events || []).map(event => {
      // Sort FAQs by sort_order
      const faqs = [...(event.event_faqs || [])].sort(
        (a: EventFaqRow, b: EventFaqRow) => (a.sort_order || 0) - (b.sort_order || 0)
      );

      return {
        id: event.id,
        slug: event.slug,
        bookingUrl: event.booking_url || null,
        highlights: event.highlights || [],
        event_status: event.event_status, // Expose raw status
        ...eventToSchema(event, faqs),
      };
    });

    return createApiResponse({
      events: schemaEvents,
      meta: {
        total: count || 0,
        limit,
        offset,
        has_more: (count || 0) > offset + limit,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:events'], _request);
}
