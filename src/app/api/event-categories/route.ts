import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const supabase = createAdminClient();
    
    const { data: categories, error } = await supabase
      .from('event_categories')
      .select('*')
      .or('is_active.eq.true,is_active.is.null')
      .order('sort_order', { ascending: true });

    if (error) {
      return createErrorResponse('Failed to fetch event categories', 'DATABASE_ERROR', 500);
    }

    const formattedCategories = categories?.map(category => ({
      id: category.id,
      name: category.name,
      description: category.description,
      color: category.color,
      icon: category.icon,
      slug: category.slug,
      // Image fields - currently no image_url in database
      // These will work once migration is applied
      imageUrl: null, // category.image_url once migration applied
      defaultImageUrl: null, // category.image_url once migration applied
      thumbnailImageUrl: null, // category.image_url once migration applied
      posterImageUrl: null, // category.image_url once migration applied
      // SEO/Content fields
      shortDescription: category.short_description,
      longDescription: category.long_description,
      highlights: category.highlights || [],
      metaTitle: category.meta_title,
      metaDescription: category.meta_description,
      keywords: category.keywords || [],
      // Video fields
      promoVideoUrl: category.promo_video_url,
      highlightVideoUrls: category.highlight_video_urls || [],
      // Default event settings
      default_start_time: category.default_start_time,
      default_end_time: category.default_end_time,
      default_capacity: category.default_capacity,
      default_reminder_hours: category.default_reminder_hours,
      default_price: category.default_price,
      default_is_free: category.default_is_free,
      default_performer_type: category.default_performer_type,
      default_event_status: category.default_event_status,
      default_duration_minutes: category.default_duration_minutes,
      default_doors_time: category.default_doors_time,
      default_last_entry_time: category.default_last_entry_time,
      default_booking_url: category.default_booking_url,
      faqs: category.faqs || [],
      sort_order: category.sort_order,
      is_active: category.is_active,
    })) || [];

    return createApiResponse({
      categories: formattedCategories,
      meta: {
        total: formattedCategories.length,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:events'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
