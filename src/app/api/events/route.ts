import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse, createCorsPreflightResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { resolveStatusFilters } from '@/lib/events/status-filters';
import { buildEventSearchOrFilter } from '@/lib/events/api-search';
import { resolveEventPaymentMode, resolveEventPriceAmount } from '@/lib/events/pricing';
import {
  eventTicketTypesEnabled,
  serializeTicketType,
  type EventTicketTypeDTO,
  type EventTicketTypeRow,
} from '@/lib/events/ticket-types';
import { logger } from '@/lib/logger';
// Removed unused date-fns imports

type EventFaqRow = {
  sort_order: number | null;
};

type EventCategoryRow = {
  id: string
  name: string | null
  color: string | null
  icon: string | null
  slug: string | null
}

type EventCapacityRow = {
  event_id: string
  seats_remaining: number | null
  seated_remaining: number | null
  standing_remaining: number | null
  total_remaining: number | null
  is_full: boolean
}

/**
 * PostgREST returns a to-one embed as an object, but the generated types model
 * the same shape as a possible array. Normalise both so the category emitted
 * here matches the detail route's exactly.
 */
function normaliseCategoryRow(raw: unknown): EventCategoryRow | null {
  const row = Array.isArray(raw) ? raw[0] : raw
  if (!row || typeof row !== 'object') return null
  return row as EventCategoryRow
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return createCorsPreflightResponse({
    request,
    methods: 'GET, POST, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-API-Key',
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
    const eventSearch = searchParams.get('search') ?? searchParams.get('q');
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
          icon,
          slug
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

    const searchFilter = buildEventSearchOrFilter(eventSearch);
    if (searchFilter) {
      query = query.or(searchFilter);
    }

    const { data: events, error, count } = await query;

    if (error) {
      return createErrorResponse('Failed to fetch events', 'DATABASE_ERROR', 500);
    }

    const eventIds = (events || []).map((event: any) => event.id).filter(Boolean)
    const capacityByEventId = new Map<string, EventCapacityRow>()

    if (eventIds.length > 0) {
      const { data: capacityRows, error: capacityError } = await supabase.rpc(
        'get_event_capacity_snapshot_v05',
        { p_event_ids: eventIds }
      )

      if (capacityError) {
        logger.warn('Failed to load event capacity snapshot; falling back to static capacity fields', {
          metadata: { error: capacityError.message }
        })
      } else if (Array.isArray(capacityRows)) {
        for (const row of capacityRows as EventCapacityRow[]) {
          capacityByEventId.set(row.event_id, row)
        }
      }
    }

    // Multiple ticket options (feature-flagged, same gate as the detail route).
    // Loaded for the whole page in ONE query: without this a list-sourced event
    // with several differently-priced types advertises a single price, because
    // the website only ever sees ticket_types from the detail endpoint.
    const ticketTypeRowsByEventId = new Map<string, EventTicketTypeRow[]>()

    if (eventTicketTypesEnabled() && eventIds.length > 0) {
      const { data: ticketTypeRows, error: ticketTypesError } = await supabase
        .from('event_ticket_types')
        .select('id, event_id, name, description, base_price, capacity, sort_order, is_active')
        .in('event_id', eventIds)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (ticketTypesError) {
        logger.warn('Failed to load event ticket types for the events list', {
          metadata: { error: ticketTypesError.message }
        })
      } else if (Array.isArray(ticketTypeRows)) {
        for (const row of ticketTypeRows as EventTicketTypeRow[]) {
          const current = ticketTypeRowsByEventId.get(row.event_id) ?? []
          current.push(row)
          ticketTypeRowsByEventId.set(row.event_id, current)
        }
      }
    }

    // Transform events to Schema.org format with FAQs and booking availability fields
    const schemaEvents = (events || []).map(event => {
      // Sort FAQs by sort_order
      const faqs = [...(event.event_faqs || [])].sort(
        (a: EventFaqRow, b: EventFaqRow) => (a.sort_order || 0) - (b.sort_order || 0)
      );

      const capacityRow = capacityByEventId.get(event.id)
      const seatsRemaining =
        capacityRow?.seats_remaining ??
        (typeof event.capacity === 'number' ? event.capacity : null)
      const isFull =
        capacityRow?.is_full ??
        (typeof seatsRemaining === 'number' ? seatsRemaining <= 0 : false)
      const totalRemaining = capacityRow?.total_remaining ?? seatsRemaining
      const price = resolveEventPriceAmount(event)
      const paymentMode = resolveEventPaymentMode(event)
      const category = normaliseCategoryRow(event.category)

      // Per-type remaining is deliberately null here: the capacity RPC behind it
      // takes a single event, so filling it in would mean one round trip per
      // event. The website treats null as "unknown" and only needs the seat
      // maths on the detail page, which does load the real figures.
      const ticketTypeRows = ticketTypeRowsByEventId.get(event.id) ?? []
      const ticketTypes: EventTicketTypeDTO[] | null =
        ticketTypeRows.length > 0
          ? ticketTypeRows.map((row) => serializeTicketType(row, event, null))
          : null

      return {
        id: event.id,
        slug: event.slug,
        date: event.date,
        time: event.time,
        bookingUrl: event.booking_url || null,
        highlights: event.highlights || [],
        event_status: event.event_status, // Expose raw status
        seats_remaining: seatsRemaining,
        is_full: isFull,
        waitlist_enabled: typeof event.capacity === 'number' && event.capacity > 0,
        payment_mode: paymentMode,
        booking_mode: ['table', 'general', 'mixed', 'communal'].includes(String(event.booking_mode))
          ? event.booking_mode
          : 'table',
        seated_capacity: event.seated_capacity ?? null,
        standing_capacity: event.standing_capacity ?? null,
        seated_remaining: capacityRow?.seated_remaining ?? null,
        standing_remaining: capacityRow?.standing_remaining ?? null,
        total_remaining: totalRemaining,
        price,
        // Only present when the flag is on AND the event has active types, so the
        // pre-launch response is byte-for-byte unchanged (same rule as the detail route).
        ...(ticketTypes ? { ticket_types: ticketTypes } : {}),
        ticket_price: event.price ?? null,
        online_discount_type: event.online_discount_type ?? null,
        online_discount_value: event.online_discount_value ?? null,
        primary_keywords: event.primary_keywords || [],
        secondary_keywords: event.secondary_keywords || [],
        local_seo_keywords: event.local_seo_keywords || [],
        image_alt_text: event.image_alt_text || null,
        social_copy_whatsapp: event.social_copy_whatsapp || null,
        previous_event_summary: event.previous_event_summary || null,
        attendance_note: event.attendance_note || null,
        cancellation_policy: event.cancellation_policy || null,
        accessibility_notes: event.accessibility_notes || null,
        bookings_enabled: event.bookings_enabled ?? true,
        booking_cutoff_at: event.booking_cutoff_at ?? null,
        // Same shape as the detail route, so the website's category chip and
        // "More {category}" link work off the list without a website change.
        category: category ? {
          id: category.id,
          name: category.name,
          slug: category.slug,
          color: category.color,
          icon: category.icon
        } : null,
        ...eventToSchema(event, faqs),
        // Schema.org capacity names. The website reads ONLY these two for its
        // scarcity and sold-out copy, so they have to carry the live snapshot.
        // Placed after the eventToSchema spread so a future change there cannot
        // clobber them. Left undefined (absent from the JSON, as before they were
        // dropped) when the event has no capacity: emitting 0 would make every
        // uncapped event read as sold out on the website.
        // Both are gated on the SAME condition on purpose. An event with no
        // capacity configured must emit neither: sending remaining 0 without a
        // maximum makes the website read an uncapped event as sold out.
        ...(typeof event.capacity === 'number'
          ? {
              maximumAttendeeCapacity: event.capacity,
              remainingAttendeeCapacity: isFull
                ? 0
                : typeof totalRemaining === 'number'
                  ? totalRemaining
                  : undefined,
            }
          : {}),
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
