import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { SCHEMA_AVAILABILITY } from '@/lib/api/schema';

export async function GET(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    const supabase = await createClient();
    const now = new Date().toISOString();
    
    const { data: specials, error } = await supabase
      .from('menu_items')
      .select(`
        id,
        name,
        description,
        price,
        price_currency,
        calories,
        dietary_info,
        allergens,
        available_from,
        available_until,
        image_url,
        section:menu_sections!inner(
          id,
          name
        )
      `)
      .eq('is_special', true)
      .eq('is_available', true)
      .or(`available_from.is.null,available_from.lte.${now}`)
      .or(`available_until.is.null,available_until.gte.${now}`)
      .order('available_from', { ascending: false });

    if (error) {
      return createErrorResponse('Failed to fetch specials', 'DATABASE_ERROR', 500);
    }

    const formattedSpecials = specials?.map(special => ({
      '@type': 'MenuItem',
      id: special.id,
      name: special.name,
      description: special.description,
      section: special.section && typeof special.section === 'object' && 'name' in special.section 
        ? special.section.name 
        : undefined,
      offers: {
        '@type': 'Offer',
        price: special.price.toString(),
        priceCurrency: special.price_currency || 'GBP',
        availability: SCHEMA_AVAILABILITY.IN_STOCK,
        availableAtOrFrom: special.available_from,
        availableThrough: special.available_until,
      },
      nutrition: special.calories ? {
        '@type': 'NutritionInformation',
        calories: `${special.calories} calories`,
      } : undefined,
      dietary_info: special.dietary_info || [],
      allergens: special.allergens || [],
      image: special.image_url,
    })) || [];

    return createApiResponse({
      specials: formattedSpecials,
      meta: {
        total: formattedSpecials.length,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:menu']);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}