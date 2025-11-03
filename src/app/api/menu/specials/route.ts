import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { SCHEMA_AVAILABILITY } from '@/lib/api/schema';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const supabase = createAdminClient();
    const now = new Date();

    const { data: specials, error } = await supabase
      .from('menu_dishes_with_costs')
      .select('*')
      .eq('menu_code', 'website_food')
      .eq('is_special', true)
      .eq('is_active', true)
      .order('available_from', { ascending: false, nullsFirst: false });

    if (error) {
      return createErrorResponse('Failed to fetch specials', 'DATABASE_ERROR', 500);
    }

    const formattedSpecials = (specials || [])
      .filter(special => {
        if (special.available_from && new Date(special.available_from) > now) {
          return false;
        }
        if (special.available_until && new Date(special.available_until) < now) {
          return false;
        }
        return true;
      })
      .map(special => ({
      '@type': 'MenuItem',
      id: special.dish_id,
      name: special.name,
      description: special.description,
      section: special.category_name,
      offers: {
        '@type': 'Offer',
        price: Number(special.selling_price ?? 0).toFixed(2),
        priceCurrency: 'GBP',
        availability: SCHEMA_AVAILABILITY.IN_STOCK,
        availableAtOrFrom: special.available_from,
        availableThrough: special.available_until,
      },
      nutrition: special.calories ? {
        '@type': 'NutritionInformation',
        calories: `${special.calories} calories`,
      } : undefined,
      dietary_info: special.dietary_flags || [],
      allergens: special.allergen_flags || [],
      image: special.image_url,
    }));

    return createApiResponse({
      specials: formattedSpecials,
      meta: {
        total: formattedSpecials.length,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:menu'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
