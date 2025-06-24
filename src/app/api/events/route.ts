import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';
import { startOfDay, endOfDay, parseISO } from 'date-fns';

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

export async function GET(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    const { searchParams } = new URL(request.url);
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const categoryId = searchParams.get('category_id');
    const availableOnly = searchParams.get('available_only') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

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
        bookings(count),
        event_faqs(
          id,
          question,
          answer,
          sort_order
        )
      `)
      .eq('event_status', 'scheduled')
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (fromDate) {
      query = query.gte('date', fromDate);
    } else {
      // Default to today
      query = query.gte('date', new Date().toISOString().split('T')[0]);
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
    const schemaEvents = events?.map(event => {
      const bookingCount = event.bookings?.[0]?.count || 0;
      
      // Filter out sold out events if requested
      if (availableOnly && event.capacity && bookingCount >= event.capacity) {
        return null;
      }
      
      // Sort FAQs by sort_order
      const faqs = event.event_faqs?.sort((a: any, b: any) => a.sort_order - b.sort_order) || [];
      
      return {
        id: event.id,
        slug: event.slug,
        highlights: event.highlights || [],
        ...eventToSchema(event, bookingCount, faqs),
      };
    }).filter(Boolean) || [];

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
  }, ['read:events'], request);
}

