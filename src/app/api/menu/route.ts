import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { menuToSchema } from '@/lib/api/schema';
import { getTodayIsoDate } from '@/lib/dateUtils';

// Public menu codes this endpoint is allowed to serve.
// Strict allowlist: anything not listed here is rejected with a 400 so that an
// arbitrary menu code can never be probed through the public API.
// Kept module-private because Next.js route files may only export route handlers
// and a fixed set of route config values.
const PUBLIC_MENU_CODES = ['website_food', 'sunday_lunch', 'christmas', 'drinks'] as const;
type PublicMenuCode = (typeof PUBLIC_MENU_CODES)[number];

const DEFAULT_PUBLIC_MENU_CODE: PublicMenuCode = 'website_food';

function resolveMenuCode(request: Request): { code: PublicMenuCode } | { error: string } {
  let requested: string | null = null;

  try {
    requested = new URL(request.url).searchParams.get('menu');
  } catch {
    requested = null;
  }

  if (requested === null || requested.trim() === '') {
    return { code: DEFAULT_PUBLIC_MENU_CODE };
  }

  const normalised = requested.trim().toLowerCase();

  if ((PUBLIC_MENU_CODES as readonly string[]).includes(normalised)) {
    return { code: normalised as PublicMenuCode };
  }

  return { error: `Unknown menu code. Allowed values: ${PUBLIC_MENU_CODES.join(', ')}` };
}

// Normalises a DATE column value (or a timestamp string) to YYYY-MM-DD.
// Returns null when the value is absent or unparseable, which means "no bound".
function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  return null;
}

export async function GET(_request: NextRequest) {
  return withApiAuth(async (req, _apiKey) => {
    const resolved = resolveMenuCode(req);

    if ('error' in resolved) {
      return createErrorResponse(resolved.error, 'VALIDATION_ERROR', 400);
    }

    const menuCode = resolved.code;

    const supabase = createAdminClient();
    const { data: menu, error: menuError } = await supabase
      .from('menu_menus')
      .select('id, name')
      .eq('code', menuCode)
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
          .eq('menu_code', menuCode)
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

    // available_from and available_until are DATE columns, so both bounds are
    // whole-day inclusive. Compare as YYYY-MM-DD strings against today in
    // Europe/London. Comparing them as timestamps against "now" would drop a
    // dish at midnight on its own final day.
    const today = getTodayIsoDate();

    (dishes || []).forEach(dish => {
      const meta = categoryMeta.get(dish.category_code);
      if (!meta) return;

      const availableFrom = toIsoDate(dish.available_from);
      const availableUntil = toIsoDate(dish.available_until);

      if (availableFrom && availableFrom > today) return;
      if (availableUntil && availableUntil < today) return;

      if (!sectionsMap.has(dish.category_code)) {
        sectionsMap.set(dish.category_code, {
          id: meta.id,
          name: meta.name,
          description: meta.description,
          sort_order: meta.sort_order,
          items: [],
        });
      }

      // selling_price is nullable in practice (dishes awaiting costing), so keep
      // null rather than coercing to 0 and advertising a free dish.
      const rawPrice = dish.selling_price;
      const price = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);

      sectionsMap.get(dish.category_code)?.items.push({
        id: dish.dish_id,
        name: dish.name,
        description: dish.description,
        price: price !== null && Number.isFinite(price) ? price : null,
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

    const schemaMenu = menuToSchema(processedSections, menu.name);

    return createApiResponse({
      menu: schemaMenu,
      menu_code: menuCode,
      menu_name: menu.name,
      sections: processedSections,
    });
  }, ['read:menu'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
