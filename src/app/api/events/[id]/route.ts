import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';

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
        bookings(count),
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

    const bookingCount = event.bookings?.[0]?.count || 0;
    
    // Sort FAQs by sort_order
    const faqs = event.event_faqs?.sort((a: any, b: any) => a.sort_order - b.sort_order) || [];

    // Add extended details with all SEO fields
    const extendedEvent = {
      id: event.id,
      slug: event.slug,
      highlights: event.highlights || [],
      keywords: event.keywords || [],
      shortDescription: event.short_description,
      longDescription: event.long_description,
      metaTitle: event.meta_title,
      metaDescription: event.meta_description,
      // Map single image_url to all image fields for backwards compatibility
      heroImageUrl: event.image_url,
      thumbnailImageUrl: event.image_url,
      posterImageUrl: event.image_url,
      galleryImages: event.image_url ? [event.image_url] : [],
      imageUrl: event.image_url, // New single image field
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
      ...eventToSchema(event, bookingCount, faqs),
      booking_rules: {
        max_seats_per_booking: 6,
        requires_customer_details: true,
        allows_notes: true,
        sms_confirmation_enabled: true,
      },
      custom_messages: event.event_message_templates?.reduce((acc: any, template: any) => {
        acc[template.template_type] = template.custom_content;
        return acc;
      }, {}),
    };

    return createApiResponse({
      event: extendedEvent,
      meta: {
        lastUpdated: event.updated_at || event.created_at,
      }
    });
  }, ['read:events'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}