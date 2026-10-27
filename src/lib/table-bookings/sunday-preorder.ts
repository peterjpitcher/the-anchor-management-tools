import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The Sunday lunch menu, as the public menu endpoint (api/menu/sunday-lunch) reads it.
 *
 * Sunday pre-orders were retired: old text links land on the static page at
 * g/[token]/sunday-preorder, and pre-order rows already taken stay readable on their bookings. The
 * token, page-data and save functions that served the old form were uncalled outside their own
 * tests and are gone (BK-129, customer bookings review of 24 October 2026).
 */

type BookingItemType = 'main' | 'side' | 'extra'

// Typed shapes for DB rows returned by loadSundayLunchMenuItems: prevents silent
// any[] casts masking missing or malformed fields from the menu tables.
interface MenuMenuRow {
  id: string
}

interface MenuDishMenuAssignmentRow {
  dish_id: string
  category_id: string | null
  sort_order: number | null
}

interface MenuDishRow {
  id: string
  name: string
  description: string | null
  selling_price: number | null
  is_active: boolean
  dietary_flags: string[] | null
  allergen_flags: string[] | null
}

interface MenuCategoryRow {
  id: string
  code: string | null
  name: string | null
}

interface FallbackDishRow {
  id: string
  name: string
  description: string | null
  selling_price: number | null
  dietary_flags: string[] | null
  allergen_flags: string[] | null
}

interface LegacyMenuItemRow {
  name: string
  category: string | null
  display_order: number | null
}

export type SundayMenuItem = {
  menu_dish_id: string
  name: string
  description: string | null
  price: number
  category_code: string | null
  category_name: string | null
  item_type: BookingItemType
  sort_order: number
  dietary_info: string[]
  allergens: string[]
}

function resolveItemType(categoryCode?: string | null): BookingItemType {
  const normalized = (categoryCode || '').toLowerCase()
  if (normalized.includes('extra')) {
    return 'extra'
  }
  if (normalized.includes('side')) {
    return 'side'
  }
  return 'main'
}

function formatCategoryName(categoryCode?: string | null): string | null {
  const normalized = (categoryCode || '').trim()
  if (!normalized) return null
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function sortSundayMenuItems(items: SundayMenuItem[]): SundayMenuItem[] {
  return [...items].sort((a, b) => {
    const categoryCompare = (a.category_name || '').localeCompare(b.category_name || '')
    if (categoryCompare !== 0) return categoryCompare
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.localeCompare(b.name)
  })
}

async function loadSundayLunchMenuItems(
  supabase: SupabaseClient<any, 'public', any>
): Promise<SundayMenuItem[] | null> {
  const { data: sundayMenuRaw, error: sundayMenuError } = await supabase.from('menu_menus')
    .select('id')
    .eq('code', 'sunday_lunch')
    .eq('is_active', true)
    .maybeSingle()

  if (!sundayMenuError && sundayMenuRaw?.id) {
    const sundayMenu = sundayMenuRaw as MenuMenuRow

    const { data: assignmentsRaw, error: assignmentsError } = await supabase.from('menu_dish_menu_assignments')
      .select('dish_id, category_id, sort_order')
      .eq('menu_id', sundayMenu.id)

    const assignmentRows: MenuDishMenuAssignmentRow[] = assignmentsError
      ? []
      : (assignmentsRaw || []) as MenuDishMenuAssignmentRow[]

    if (assignmentRows.length > 0) {
      const dishIds = Array.from(new Set(assignmentRows.map((row) => row.dish_id).filter(Boolean)))
      const categoryIds = Array.from(new Set(assignmentRows.map((row) => row.category_id).filter(Boolean)))

      const [{ data: dishesRaw }, { data: categoriesRaw }] = await Promise.all([
        supabase.from('menu_dishes')
          .select('id, name, description, selling_price, is_active, dietary_flags, allergen_flags')
          .in('id', dishIds)
          .eq('is_active', true),
        categoryIds.length > 0
          ? supabase.from('menu_categories')
              .select('id, code, name')
              .in('id', categoryIds)
          : Promise.resolve({ data: [] as MenuCategoryRow[] })
      ])

      const dishMap = new Map(
        ((dishesRaw || []) as MenuDishRow[]).map((dish) => [dish.id, dish])
      )

      const categoryMap = new Map(
        ((categoriesRaw || []) as MenuCategoryRow[]).map((category) => [category.id, category])
      )

      const menuItems: SundayMenuItem[] = []

      for (const assignment of assignmentRows) {
        const dish = dishMap.get(assignment.dish_id)
        if (!dish) continue

        // Guard: a dish row missing id or name is malformed, so skip and warn rather than silently producing a broken item.
        if (!dish.id || !dish.name) {
          console.warn('[sunday-preorder] loadSundayLunchMenuItems: skipping dish with missing id or name', { dish_id: assignment.dish_id })
          continue
        }

        const category = assignment.category_id ? categoryMap.get(assignment.category_id) : undefined

        menuItems.push({
          menu_dish_id: dish.id,
          name: dish.name,
          description: dish.description || null,
          price: Number(Number(dish.selling_price || 0).toFixed(2)),
          category_code: category?.code || null,
          category_name: category?.name || null,
          item_type: resolveItemType(category?.code || null),
          sort_order: Number(assignment.sort_order || 0),
          dietary_info: Array.isArray(dish.dietary_flags) ? dish.dietary_flags : [],
          allergens: Array.isArray(dish.allergen_flags) ? dish.allergen_flags : []
        })
      }

      if (menuItems.length > 0) {
        return sortSundayMenuItems(menuItems)
      }
    }
  }

  // Fallback for older data: use active Sunday-lunch flagged dishes even if the menu
  // assignment records are missing. This keeps "Capture now" usable.
  const { data: fallbackDishesRaw, error: fallbackDishesError } = await supabase.from('menu_dishes')
    .select('id, name, description, selling_price, dietary_flags, allergen_flags')
    .eq('is_active', true)
    .eq('is_sunday_lunch', true)

  if (fallbackDishesError) {
    return null
  }

  const dishRows = (fallbackDishesRaw || []) as FallbackDishRow[]

  if (dishRows.length === 0) {
    return null
  }

  const { data: legacyItemsRaw } = await supabase.from('sunday_lunch_menu_items')
    .select('name, category, display_order')
    .eq('is_active', true)

  const legacyByName = new Map(
    ((legacyItemsRaw || []) as LegacyMenuItemRow[]).map((row) => [
      row.name.trim().toLowerCase(),
      row
    ])
  )

  const fallbackMenuItems: SundayMenuItem[] = []

  for (let index = 0; index < dishRows.length; index++) {
    const dish = dishRows[index]

    // Guard: a dish row missing id or name is malformed, so skip and warn.
    if (!dish.id || !dish.name) {
      console.warn('[sunday-preorder] loadSundayLunchMenuItems (fallback): skipping dish with missing id or name', { dish })
      continue
    }

    const legacy = legacyByName.get(dish.name.trim().toLowerCase())
    const categoryCode = legacy?.category || null
    const categoryName = formatCategoryName(categoryCode)

    fallbackMenuItems.push({
      menu_dish_id: dish.id,
      name: dish.name,
      description: dish.description || null,
      price: Number(Number(dish.selling_price || 0).toFixed(2)),
      category_code: categoryCode,
      category_name: categoryName,
      item_type: resolveItemType(categoryCode),
      sort_order: Number.isFinite(Number(legacy?.display_order))
        ? Number(legacy?.display_order)
        : index,
      dietary_info: Array.isArray(dish.dietary_flags) ? dish.dietary_flags : [],
      allergens: Array.isArray(dish.allergen_flags) ? dish.allergen_flags : []
    })
  }

  if (fallbackMenuItems.length === 0) {
    return null
  }

  return sortSundayMenuItems(fallbackMenuItems)
}

export async function getSundayLunchMenuItems(
  supabase: SupabaseClient<any, 'public', any>
): Promise<SundayMenuItem[] | null> {
  return loadSundayLunchMenuItems(supabase)
}
