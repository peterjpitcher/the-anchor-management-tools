import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { SCHEMA_AVAILABILITY } from '@/lib/api/schema';

const VALID_DIETARY_TYPES = ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher'];

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  return withApiAuth(async (_req, _apiKey) => {
    const params = await context.params;
    const dietaryType = params.type.toLowerCase();
    
    if (!VALID_DIETARY_TYPES.includes(dietaryType)) {
      return createErrorResponse(
        `Invalid dietary type. Valid types: ${VALID_DIETARY_TYPES.join(', ')}`,
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
      .contains('dietary_flags', [dietaryType])
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

    const now = new Date();
    const sections: any[] = [];

    const grouped = new Map<string, { name: string; sort_order: number; items: any[] }>();

    (dishes || []).forEach(dish => {
      if (dish.available_from && new Date(dish.available_from) > now) return;
      if (dish.available_until && new Date(dish.available_until) < now) return;

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
