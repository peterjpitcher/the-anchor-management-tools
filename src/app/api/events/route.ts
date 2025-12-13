import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';
import { getTodayIsoDate } from '@/lib/dateUtils';
// Removed unused date-fns imports

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
    const availableOnly = searchParams.get('available_only') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const fetchLimit = availableOnly ? limit * 3 : limit; // Over-fetch when filtering to reduce empty pages

    const supabase = createAdminClient();
    
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
        booking_totals:bookings(sum:seats),
        event_faqs(
          id,
          question,
          answer,
          sort_order
        )
      `, { count: 'exact' })
      .eq('event_status', 'scheduled')
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .range(offset, offset + fetchLimit - 1);

    // Apply filters
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
    const filtered = (events || []).filter((event) => {
      const bookedSeats = (event.booking_totals?.[0]?.sum as number | null) ?? 0;
      if (!availableOnly) return true;
      if (event.capacity === null) return true; // uncapped events are always available
      return bookedSeats < event.capacity;
    });

    const schemaEvents = filtered.slice(0, limit).map(event => {
      const bookedSeats = (event.booking_totals?.[0]?.sum as number | null) ?? 0;
      
      // Sort FAQs by sort_order
      const faqs = event.event_faqs?.sort((a: any, b: any) => a.sort_order - b.sort_order) || [];
      
      return {
        id: event.id,
        slug: event.slug,
        highlights: event.highlights || [],
        ...eventToSchema(event, bookedSeats, faqs),
      };
    });

    return createApiResponse({
      events: schemaEvents,
      meta: {
        total: availableOnly ? Math.max(filtered.length + offset, schemaEvents.length) : (count || 0),
        limit,
        offset,
        has_more: availableOnly
          ? filtered.length > limit || (count || 0) > offset + fetchLimit
          : (count || 0) > offset + limit,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:events'], _request);
}
