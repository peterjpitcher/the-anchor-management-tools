import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { menuToSchema } from '@/lib/api/schema';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { isNewToday, toIsoDate } from '@/lib/menu/new-product-window';

// Public menu codes this endpoint is allowed to serve.
// Strict allowlist: anything not listed here is rejected with a 400 so that an
// arbitrary menu code can never be probed through the public API.
// Kept module-private because Next.js route files may only export route handlers
// and a fixed set of route config values.
const PUBLIC_MENU_CODES = ['website_food', 'kids', 'sunday_lunch', 'christmas', 'drinks'] as const;
type PublicMenuCode = (typeof PUBLIC_MENU_CODES)[number];

const DEFAULT_PUBLIC_MENU_CODE: PublicMenuCode = 'website_food';

// Where a category with no menu_category_menus row for this menu is placed.
// There is no menu-level position to honour, so it sorts last. Same sentinel
// the dietary route uses for the same situation.
const UNMAPPED_CATEGORY_SORT_ORDER = 999;

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
      // Fall back to the dish's own category when that category has no
      // menu_category_menus row for this menu. Dropping the dish instead hid six
      // active burger add-ons from the public menu for as long as the mapping row
      // was missing: a gap in the join table is a data problem, not a reason to
      // stop selling the food. The view already carries the category's id and
      // name, so nothing is invented here.
      const meta = categoryMeta.get(dish.category_code) ?? {
        id: dish.category_id ?? dish.category_code,
        name: dish.category_name || 'Other',
        description: null,
        sort_order: UNMAPPED_CATEGORY_SORT_ORDER,
      };

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
        // Whole-day inclusive, same comparison as the availability window above,
        // so the badge appears and expires on its own dates with no manual step.
        is_new: isNewToday(dish.new_from, dish.new_until, today),
        new_until: toIsoDate(dish.new_until),
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
