import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { menuToSchema } from '@/lib/api/schema';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const supabase = createAdminClient();
    const { data: menu, error: menuError } = await supabase
      .from('menu_menus')
      .select('id, name')
      .eq('code', 'website_food')
      .single();

    if (menuError || !menu) {
      return createErrorResponse('Menu configuration missing', 'NOT_FOUND', 404);
    }

    const [{ data: categoryMappings, error: categoriesError }, { data: dishes, error: dishesError }] =
      await Promise.all([
        supabase
          .from('menu_category_menus')
          .select(`
            sort_order,
            category:menu_categories(
              id,
              code,
              name,
              description
            )
          `)
          .eq('menu_id', menu.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('menu_dishes_with_costs')
          .select('*')
          .eq('menu_code', 'website_food')
          .eq('is_active', true)
          .order('category_code', { ascending: true })
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
      ]);

    if (categoriesError || dishesError) {
      return createErrorResponse('Failed to fetch menu', 'DATABASE_ERROR', 500);
    }

    const categoryMeta = new Map<string, { id: string; name: string; description?: string | null; sort_order: number }>();
    (categoryMappings ?? []).forEach((entry: any) => {
      if (entry?.category) {
        categoryMeta.set(entry.category.code, {
          id: entry.category.id,
          name: entry.category.name,
          description: entry.category.description,
          sort_order: entry.sort_order,
        });
      }
    });

    const sectionsMap = new Map<
      string,
      {
        id: string;
        name: string;
        description?: string | null;
        sort_order: number;
        items: any[];
      }
    >();

    const now = new Date();

    (dishes || []).forEach(dish => {
      const meta = categoryMeta.get(dish.category_code);
      if (!meta) return;

      if (dish.available_from && new Date(dish.available_from) > now) return;
      if (dish.available_until && new Date(dish.available_until) < now) return;

      if (!sectionsMap.has(dish.category_code)) {
        sectionsMap.set(dish.category_code, {
          id: meta.id,
          name: meta.name,
          description: meta.description,
          sort_order: meta.sort_order,
          items: [],
        });
      }

      sectionsMap.get(dish.category_code)?.items.push({
        id: dish.dish_id,
        name: dish.name,
        description: dish.description,
        price: Number(dish.selling_price ?? 0),
        calories: dish.calories,
        dietary_info: dish.dietary_flags || [],
        allergens: dish.allergen_flags || [],
        is_available: dish.is_active,
        is_special: dish.is_special,
        available_from: dish.available_from,
        available_until: dish.available_until,
        image_url: dish.image_url,
        sort_order: dish.sort_order ?? 0,
      });
    });

    const processedSections = Array.from(sectionsMap.values())
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(section => ({
        id: section.id,
        name: section.name,
        description: section.description,
        sort_order: section.sort_order,
        items: section.items.sort((a, b) => a.sort_order - b.sort_order),
      }));

    const schemaMenu = menuToSchema(processedSections);

    return createApiResponse({
      menu: schemaMenu,
      sections: processedSections,
    });
  }, ['read:menu'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
