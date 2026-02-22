import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';

type EventFaqRow = {
  sort_order: number | null;
};

type EventCategoryRow = {
  id: string
  name: string | null
  description: string | null
  color: string | null
  icon: string | null
  slug: string | null
}

type EventMessageTemplateRow = {
  template_type: string;
  custom_content: string | null;
};

type EventCapacityRow = {
  event_id: string
  seats_remaining: number | null
  is_full: boolean
}

type EventShortLinkRow = {
  short_code: string
  updated_at: string | null
  metadata: {
    channel?: string | null
  } | null
}

const SHORT_LINK_BASE_URL = process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://vip-club.uk';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withApiAuth(async (_req, _apiKey) => {
    const params = await context.params;
    const supabase = createAdminClient();

    // Check if id is a UUID pattern
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id);
    const lookupById = async (id: string) =>
      supabase.from('events').select('*').eq('id', id).maybeSingle();
    const lookupBySlug = async (slug: string) =>
      supabase.from('events').select('*').eq('slug', slug).maybeSingle();

    let event: Record<string, any> | null = null;

    if (isUUID) {
      const { data, error } = await lookupById(params.id);
      if (error) {
        return createErrorResponse('Failed to load event details', 'DATABASE_ERROR', 500);
      }
      event = (data as Record<string, any> | null) ?? null;
    } else {
      const { data: slugData, error: slugError } = await lookupBySlug(params.id);
      if (slugError) {
        return createErrorResponse('Failed to load event details', 'DATABASE_ERROR', 500);
      }
      event = (slugData as Record<string, any> | null) ?? null;

      // Legacy fallback: if this is not a UUID and slug lookup missed, try id directly.
      if (!event) {
        const { data: idData, error: idError } = await lookupById(params.id);
        if (idError) {
          return createErrorResponse('Failed to load event details', 'DATABASE_ERROR', 500);
        }
        event = (idData as Record<string, any> | null) ?? null;
      }
    }

    if (!event) {
      return createErrorResponse('Event not found', 'NOT_FOUND', 404);
    }

    let category: EventCategoryRow | null = null;
    if (event.category_id) {
      const { data: categoryRow, error: categoryError } = await supabase
        .from('event_categories')
        .select('id, name, description, color, icon, slug')
        .eq('id', event.category_id)
        .maybeSingle<EventCategoryRow>();

      if (categoryError) {
        return createErrorResponse('Failed to load event category', 'DATABASE_ERROR', 500);
      }

      category = categoryRow ?? null;
    }

    const { data: faqs, error: faqsError } = await supabase
      .from('event_faqs')
      .select('id, question, answer, sort_order')
      .eq('event_id', event.id)
      .order('sort_order', { ascending: true });

    if (faqsError) {
      return createErrorResponse('Failed to load event FAQs', 'DATABASE_ERROR', 500);
    }

    const { data: messageTemplatesRows, error: messageTemplatesError } = await supabase
      .from('event_message_templates')
      .select('template_type, custom_content')
      .eq('event_id', event.id);

    if (messageTemplatesError) {
      return createErrorResponse('Failed to load event message templates', 'DATABASE_ERROR', 500);
    }

    let marketingShortLinks: EventShortLinkRow[] = [];
    const { data: shortLinksRows, error: shortLinksError } = await supabase
      .from('short_links')
      .select('short_code, updated_at, metadata')
      .contains('metadata', { event_id: event.id });

    if (shortLinksError) {
      console.error('[events:id] failed to load marketing short links', shortLinksError);
    } else if (Array.isArray(shortLinksRows)) {
      marketingShortLinks = shortLinksRows as EventShortLinkRow[];
    }

    const sortedFaqs = [...(faqs || [])].sort(
      (a: EventFaqRow, b: EventFaqRow) => (a.sort_order || 0) - (b.sort_order || 0)
    );

    const messageTemplates = (messageTemplatesRows || []) as EventMessageTemplateRow[];
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
    const facebookShortLink = resolveMarketingShortLink(marketingShortLinks, 'facebook');
    const linkInBioShortLink = resolveMarketingShortLink(marketingShortLinks, 'lnk_bio');

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
      facebookShortLink: facebookShortLink,
      facebook_short_link: facebookShortLink,
      linkInBioShortLink: linkInBioShortLink,
      link_in_bio_short_link: linkInBioShortLink,
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
      category: category ? {
        id: category.id,
        name: category.name,
        slug: category.slug,
        color: category.color,
        icon: category.icon
      } : null,
      ...eventToSchema(event, sortedFaqs),
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

function resolveMarketingShortLink(rows: EventShortLinkRow[], channel: string): string | null {
  const candidate = rows
    .filter((row) => {
      if (!row || typeof row.short_code !== 'string' || !row.short_code.trim()) {
        return false;
      }
      if (!row.metadata || typeof row.metadata !== 'object') {
        return false;
      }
      return row.metadata.channel === channel;
    })
    .sort((left, right) => {
      const leftTime = left.updated_at ? Date.parse(left.updated_at) : 0;
      const rightTime = right.updated_at ? Date.parse(right.updated_at) : 0;
      return rightTime - leftTime;
    })[0];

  if (!candidate) {
    return null;
  }

  return `${SHORT_LINK_BASE_URL.replace(/\/$/, '')}/${candidate.short_code}`;
}
