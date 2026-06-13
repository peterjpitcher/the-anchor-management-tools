import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';
import { buildShortLinkUrl } from '@/lib/short-links/base-url';
import { resolveEventPaymentMode, resolveEventPriceAmount } from '@/lib/events/pricing';
import { EVENT_MARKETING_CHANNEL_MAP, isEventMarketingQrChannel, type EventMarketingChannelKey } from '@/lib/event-marketing-links';

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
  content: string | null;
};

type EventCapacityRow = {
  event_id: string
  seats_remaining: number | null
  seated_remaining: number | null
  standing_remaining: number | null
  total_remaining: number | null
  is_full: boolean
}

type EventShortLinkRow = {
  short_code: string
  destination_url: string | null
  updated_at: string | null
  metadata: {
    channel?: string | null
  } | null
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

    let faqs: EventFaqRow[] = [];
    const { data: faqRows, error: faqsError } = await supabase
      .from('event_faqs')
      .select('id, question, answer, sort_order')
      .eq('event_id', event.id)
      .order('sort_order', { ascending: true });

    if (faqsError) {
      console.error('[events:id] failed to load event FAQs', faqsError);
    } else if (Array.isArray(faqRows)) {
      faqs = faqRows as EventFaqRow[];
    }

    let messageTemplatesRows: EventMessageTemplateRow[] = [];
    const { data: rawMessageTemplatesRows, error: messageTemplatesError } = await supabase
      .from('event_message_templates')
      .select('template_type, content')
      .eq('event_id', event.id);

    if (messageTemplatesError) {
      console.error('[events:id] failed to load event message templates', messageTemplatesError);
    } else if (Array.isArray(rawMessageTemplatesRows)) {
      messageTemplatesRows = rawMessageTemplatesRows as EventMessageTemplateRow[];
    }

    let marketingShortLinks: EventShortLinkRow[] = [];
    const { data: shortLinksRows, error: shortLinksError } = await supabase
      .from('short_links')
      .select('short_code, destination_url, updated_at, metadata')
      .contains('metadata', { event_id: event.id });

    if (shortLinksError) {
      console.error('[events:id] failed to load marketing short links', shortLinksError);
    } else if (Array.isArray(shortLinksRows)) {
      marketingShortLinks = shortLinksRows as EventShortLinkRow[];
    }

    const sortedFaqs = [...faqs].sort(
      (a: EventFaqRow, b: EventFaqRow) => (a.sort_order || 0) - (b.sort_order || 0)
    );

    const customMessages = messageTemplatesRows.reduce(
      (acc, template) => {
        acc[template.template_type] = template.content;
        return acc;
      },
      {} as Record<string, string | null>
    );

    const lastUpdated = event.updated_at || event.created_at;
    let seatsRemaining: number | null =
      typeof event.capacity === 'number' ? event.capacity : null
    let seatedRemaining: number | null = null
    let standingRemaining: number | null = null
    let totalRemaining: number | null = seatsRemaining
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
        seatedRemaining = capacityRow.seated_remaining ?? null
        standingRemaining = capacityRow.standing_remaining ?? null
        totalRemaining = capacityRow.total_remaining ?? seatsRemaining
        isFull = capacityRow.is_full
      }
    }

    const price = resolveEventPriceAmount(event)
    const paymentMode = resolveEventPaymentMode(event)
    const facebookShortLinkRow = resolveMarketingShortLinkRow(marketingShortLinks, 'facebook');
    const linkInBioShortLinkRow = resolveMarketingShortLinkRow(marketingShortLinks, 'lnk_bio');
    const googleBusinessProfileShortLinkRow = resolveMarketingShortLinkRow(marketingShortLinks, 'google_business_profile');
    const metaAdsShortLinkRow = resolveMarketingShortLinkRow(marketingShortLinks, 'meta_ads');
    const facebookShortLink = formatMarketingShortLink(facebookShortLinkRow);
    const linkInBioShortLink = formatMarketingShortLink(linkInBioShortLinkRow);
    const googleBusinessProfileShortLink = formatMarketingShortLink(googleBusinessProfileShortLinkRow);
    const metaAdsShortLink = formatMarketingShortLink(metaAdsShortLinkRow);
    const marketingShortLinksByChannel = buildMarketingShortLinkMap(marketingShortLinks);
    const marketingDestinationUrlsByChannel = buildMarketingDestinationUrlMap(marketingShortLinks);
    const qrShortLinksByChannel = Object.fromEntries(
      Object.entries(marketingShortLinksByChannel).filter(([channel]) => {
        const config = EVENT_MARKETING_CHANNEL_MAP.get(channel as EventMarketingChannelKey);
        return config ? isEventMarketingQrChannel(config) : false;
      })
    );
    const ctaLinks = {
      ...marketingShortLinksByChannel,
      facebook: facebookShortLink,
      instagram: linkInBioShortLink,
      google_business_profile: googleBusinessProfileShortLink,
      gbp: googleBusinessProfileShortLink,
      meta_ads: metaAdsShortLink,
    };

    // Add extended details with all SEO fields
    const extendedEvent = {
      id: event.id,
      slug: event.slug,
      brief: event.brief || null,
      event_type: category?.slug ?? event.event_type ?? null,
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
      googleBusinessProfileShortLink: googleBusinessProfileShortLink,
      google_business_profile_short_link: googleBusinessProfileShortLink,
      metaAdsShortLink: metaAdsShortLink,
      meta_ads_short_link: metaAdsShortLink,
      metaAdsDestinationUrl: metaAdsShortLinkRow?.destination_url || null,
      meta_ads_destination_url: metaAdsShortLinkRow?.destination_url || null,
      printedMenuShortLink: marketingShortLinksByChannel.printed_menu || null,
      printed_menu_short_link: marketingShortLinksByChannel.printed_menu || null,
      gameSheetShortLink: marketingShortLinksByChannel.game_sheet || null,
      game_sheet_short_link: marketingShortLinksByChannel.game_sheet || null,
      inGameScreenShortLink: marketingShortLinksByChannel.in_game_screen || null,
      in_game_screen_short_link: marketingShortLinksByChannel.in_game_screen || null,
      venueScreenShortLink: marketingShortLinksByChannel.venue_screen || null,
      venue_screen_short_link: marketingShortLinksByChannel.venue_screen || null,
      marketingShortLinks: marketingShortLinksByChannel,
      marketing_short_links: marketingShortLinksByChannel,
      marketingDestinationUrls: marketingDestinationUrlsByChannel,
      marketing_destination_urls: marketingDestinationUrlsByChannel,
      qrShortLinks: qrShortLinksByChannel,
      qr_short_links: qrShortLinksByChannel,
      ctaLinks,
      cta_links: ctaLinks,
      booking_mode: ['table', 'general', 'mixed', 'communal'].includes(String(event.booking_mode))
        ? event.booking_mode
        : 'table',
      payment_mode: paymentMode,
      price,
      price_per_seat: event.price_per_seat ?? null,
      is_free: event.is_free === true,
      capacity: event.capacity,
      seated_capacity: event.seated_capacity ?? null,
      standing_capacity: event.standing_capacity ?? null,
      seats_remaining: seatsRemaining,
      seated_remaining: seatedRemaining,
      standing_remaining: standingRemaining,
      total_remaining: totalRemaining,
      is_full: isFull,
      waitlist_enabled: typeof event.capacity === 'number' && event.capacity > 0,
      performer_name: event.performer_name || null,
      performer_type: event.performer_type || null,
      created_at: event.created_at,
      updated_at: event.updated_at,
      highlights: event.highlights || [],
      keywords: event.keywords || [],
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

function resolveMarketingShortLinkRow(rows: EventShortLinkRow[], channel: string): EventShortLinkRow | null {
  return rows
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
    })[0] ?? null;
}

function formatMarketingShortLink(row: EventShortLinkRow | null): string | null {
  if (!row) {
    return null;
  }

  return buildShortLinkUrl(row.short_code);
}

function buildMarketingShortLinkMap(rows: EventShortLinkRow[]): Record<string, string> {
  return buildMarketingLinkMap(rows, (row) => buildShortLinkUrl(row.short_code));
}

function buildMarketingDestinationUrlMap(rows: EventShortLinkRow[]): Record<string, string> {
  return buildMarketingLinkMap(rows, (row) => row.destination_url || '');
}

function buildMarketingLinkMap(
  rows: EventShortLinkRow[],
  formatter: (row: EventShortLinkRow) => string
): Record<string, string> {
  const result: Record<string, string> = {};
  const channels = Array.from(new Set(rows
    .map(row => row.metadata?.channel)
    .filter((channel): channel is string => typeof channel === 'string' && channel.length > 0)));

  for (const channel of channels) {
    const row = resolveMarketingShortLinkRow(rows, channel);
    if (!row) continue;

    const value = formatter(row);
    if (value) {
      result[channel] = value;
    }
  }

  return result;
}
