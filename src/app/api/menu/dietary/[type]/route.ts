import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { SCHEMA_AVAILABILITY } from '@/lib/api/schema';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { toIsoDate } from '@/lib/menu/new-product-window';

// The dietary types this endpoint serves, in the hyphenated spelling the public
// URLs have always used. Kept separate from the lookup below so the 400 message
// lists each type once rather than every accepted spelling of it.
const PUBLIC_DIETARY_TYPES = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'halal', 'kosher'];

// URL segment to the flag as actually stored on the dish. The stored vocabulary
// uses underscores (gluten_free, dairy_free), so /dietary/gluten-free queried a
// value no dish has ever carried and always came back empty. Both spellings are
// accepted so nothing that already links to either form breaks.
//
// 'kosher' is a real flag in the admin vocabulary but no dish carries it today,
// so it stays valid and returns an empty menu rather than being rejected: it
// starts working on its own the day a dish is flagged. Nothing is invented here.
const STORED_DIETARY_FLAG_BY_SEGMENT: Record<string, string> = {
  vegetarian: 'vegetarian',
  vegan: 'vegan',
  'gluten-free': 'gluten_free',
  gluten_free: 'gluten_free',
  'dairy-free': 'dairy_free',
  dairy_free: 'dairy_free',
  halal: 'halal',
  kosher: 'kosher',
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  return withApiAuth(async (_req, _apiKey) => {
    const params = await context.params;
    const dietaryType = params.type.toLowerCase();
    const storedDietaryFlag = STORED_DIETARY_FLAG_BY_SEGMENT[dietaryType];

    if (!storedDietaryFlag) {
      return createErrorResponse(
        `Invalid dietary type. Valid types: ${PUBLIC_DIETARY_TYPES.join(', ')}`,
        'INVALID_PARAMETER',
        400
      );
    }

    const supabase = createAdminClient();

    const { data: menu, error: menuError } = await supabase
      .from('menu_menus')
      .select('id')
      .eq('code', 'website_food')
      .single();

    if (menuError || !menu) {
      return createErrorResponse('Failed to fetch menu configuration', 'DATABASE_ERROR', 500);
    }

    const { data: categoryMappings, error: categoriesError } = await supabase
      .from('menu_category_menus')
      .select(`
        sort_order,
        category:menu_categories(
          id,
          code,
          name
        )
      `)
      .eq('menu_id', menu.id)
      .order('sort_order', { ascending: true });

    if (categoriesError) {
      return createErrorResponse('Failed to fetch menu categories', 'DATABASE_ERROR', 500);
    }

    const { data: dishes, error: dishesError } = await supabase
      .from('menu_dishes_with_costs')
      .select('*')
      .eq('menu_code', 'website_food')
      .eq('is_active', true)
      .contains('dietary_flags', [storedDietaryFlag])
      .order('category_code', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (dishesError) {
      return createErrorResponse('Failed to fetch menu items', 'DATABASE_ERROR', 500);
    }

    const categoryMeta = new Map<string, { name: string; sort_order: number }>();
    (categoryMappings ?? []).forEach((entry: any) => {
      if (entry?.category) {
        categoryMeta.set(entry.category.code, {
          name: entry.category.name,
          sort_order: entry.sort_order,
        });
      }
    });

    // available_from and available_until are DATE columns, so both bounds are
    // whole-day inclusive. Compare as YYYY-MM-DD strings against today in
    // Europe/London, matching /api/menu. Comparing them as timestamps against
    // "now" dropped a dish at midnight on its own final day, and on a UTC server
    // in British Summer Time it shifted the boundary by an hour as well.
    const today = getTodayIsoDate();
    const sections: any[] = [];

    const grouped = new Map<string, { name: string; sort_order: number; items: any[] }>();

    (dishes || []).forEach(dish => {
      const availableFrom = toIsoDate(dish.available_from);
      const availableUntil = toIsoDate(dish.available_until);

      if (availableFrom && availableFrom > today) return;
      if (availableUntil && availableUntil < today) return;

      const meta = categoryMeta.get(dish.category_code) || { name: dish.category_name || 'Other', sort_order: 999 };
      if (!grouped.has(dish.category_code)) {
        grouped.set(dish.category_code, { name: meta.name, sort_order: meta.sort_order, items: [] });
      }

      grouped.get(dish.category_code)?.items.push({
        '@type': 'MenuItem',
        id: dish.dish_id,
        name: dish.name,
        description: dish.description,
        offers: {
          '@type': 'Offer',
          price: Number(dish.selling_price ?? 0).toFixed(2),
          priceCurrency: 'GBP',
          availability: SCHEMA_AVAILABILITY.IN_STOCK,
        },
        nutrition: dish.calories ? {
          '@type': 'NutritionInformation',
          calories: `${dish.calories} calories`,
        } : undefined,
        dietary_info: dish.dietary_flags || [],
        allergens: dish.allergen_flags || [],
        image: dish.image_url,
      });
    });

    grouped.forEach((value, key) => {
      sections.push({
        '@type': 'MenuSection',
        name: value.name,
        items: value.items,
        sort_order: value.sort_order ?? 999,
      });
    });

    sections.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

    const totalItems = sections.reduce((sum, section) => sum + (Array.isArray(section.items) ? section.items.length : 0), 0);

    return createApiResponse({
      dietary_type: dietaryType,
      menu_sections: sections,
      meta: {
        total_items: totalItems,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:menu'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
