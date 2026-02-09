import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';

type EventFaqRow = {
  sort_order: number | null;
};

type EventMessageTemplateRow = {
  template_type: string;
  custom_content: string | null;
};

type EventCapacityRow = {
  event_id: string
  seats_remaining: number | null
  is_full: boolean
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withApiAuth(async (_req, _apiKey) => {
    const params = await context.params;
    const supabase = createAdminClient();
    
    // Check if id is a UUID pattern
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id);
    
    // Build query
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
        ),
        event_message_templates(
          template_type,
          custom_content
        )
      `);
    
    // Query by ID or slug
    if (isUUID) {
      query = query.eq('id', params.id);
    } else {
      query = query.eq('slug', params.id);
    }
    
    const { data: event, error } = await query.single();

    if (error || !event) {
      return createErrorResponse('Event not found', 'NOT_FOUND', 404);
    }
    
    // Sort FAQs by sort_order
    const faqs = [...(event.event_faqs || [])].sort(
      (a: EventFaqRow, b: EventFaqRow) => (a.sort_order || 0) - (b.sort_order || 0)
    );

    const messageTemplates = (event.event_message_templates || []) as EventMessageTemplateRow[];
    const customMessages = messageTemplates.reduce(
      (acc, template) => {
        acc[template.template_type] = template.custom_content;
        return acc;
      },
      {} as Record<string, string | null>
    );

    const lastUpdated = event.updated_at || event.created_at;
    let seatsRemaining: number | null =
      typeof event.capacity === 'number' ? event.capacity : null
    let isFull =
      typeof seatsRemaining === 'number' ? seatsRemaining <= 0 : false

    if (event.id) {
      const { data: capacityRows, error: capacityError } = await supabase.rpc(
        'get_event_capacity_snapshot_v05',
        { p_event_ids: [event.id] }
      )

      if (!capacityError && Array.isArray(capacityRows) && capacityRows.length > 0) {
        const capacityRow = capacityRows[0] as EventCapacityRow
        seatsRemaining = capacityRow.seats_remaining
        isFull = capacityRow.is_full
      }
    }

    const paymentMode =
      event.payment_mode ||
      ((event.is_free === true || Number(event.price || 0) === 0) ? 'free' : 'cash_only')
    const price = event.price_per_seat ?? event.price ?? 0

    // Add extended details with all SEO fields
    const extendedEvent = {
      id: event.id,
      slug: event.slug,
      brief: event.brief || null,
      event_type: event.event_type || null,
      date: event.date,
      time: event.time,
      end_time: event.end_time || null,
      doors_time: event.doors_time || null,
      duration_minutes: event.duration_minutes || null,
      last_entry_time: event.last_entry_time || null,
      event_status: event.event_status,
      bookingUrl: event.booking_url || null,
      booking_url: event.booking_url || null,
      booking_mode: ['table', 'general', 'mixed'].includes(String(event.booking_mode))
        ? event.booking_mode
        : 'table',
      payment_mode: paymentMode,
      price,
      price_per_seat: event.price_per_seat ?? null,
      is_free: event.is_free === true,
      capacity: event.capacity,
      seats_remaining: seatsRemaining,
      is_full: isFull,
      waitlist_enabled: typeof event.capacity === 'number' && event.capacity > 0,
      performer_name: event.performer_name || null,
      performer_type: event.performer_type || null,
      created_at: event.created_at,
      updated_at: event.updated_at,
      highlights: event.highlights || [],
      keywords: event.keywords || [],
      shortDescription: event.short_description,
      longDescription: event.long_description,
      metaTitle: event.meta_title,
      metaDescription: event.meta_description,
      // Map hero_image_url to all image fields for backwards compatibility
      heroImageUrl: event.hero_image_url || event.image_url,
      thumbnailImageUrl: event.thumbnail_image_url || event.hero_image_url || event.image_url,
      posterImageUrl: event.poster_image_url || event.hero_image_url || event.image_url,
      galleryImages:
        Array.isArray(event.gallery_image_urls) && event.gallery_image_urls.length > 0
          ? event.gallery_image_urls
          : event.hero_image_url
            ? [event.hero_image_url]
            : [],
      imageUrl: event.hero_image_url || event.image_url, // Single image field for compatibility
      promoVideoUrl: event.promo_video_url,
      highlightVideos: event.highlight_video_urls || [],
      lastEntryTime: event.last_entry_time,
      category: event.category ? {
        id: event.category.id,
        name: event.category.name,
        slug: event.category.slug,
        color: event.category.color,
        icon: event.category.icon
      } : null,
      ...eventToSchema(event, faqs),
      custom_messages: customMessages,
      _meta: {
        lastUpdated,
      },
    };

    return createApiResponse(extendedEvent);
  }, ['read:events'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
