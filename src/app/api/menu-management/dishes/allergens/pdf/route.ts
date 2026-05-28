import { NextRequest, NextResponse } from 'next/server'

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { generateDishAllergenReportHTML, type DishAllergenReportRow } from '@/lib/menu/allergen-report'
import { DRINK_MENU_CODES, isDishAllergenCategory, type DishAllergenCategory } from '@/lib/menu/dish-allergen-categories'
import { buildDishAllergenMap } from '@/lib/menu/dish-allergen-rollup'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

function getLondonDateSlug(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).formatToParts(date)

  const partMap = new Map(parts.map((part) => [part.type, part.value]))
  return `${partMap.get('year')}-${partMap.get('month')}-${partMap.get('day')}`
}

async function logReportExport(
  userId: string,
  userEmail: string | undefined,
  rowCount: number,
  category: DishAllergenCategory | 'all'
): Promise<void> {
  try {
    await logAuditEvent({
      user_id: userId,
      ...(userEmail && { user_email: userEmail }),
      operation_type: 'export',
      resource_type: 'menu_dish_allergens',
      operation_status: 'success',
      additional_info: { format: 'pdf', row_count: rowCount, category },
    })
  } catch (error) {
    console.warn('Failed to write dish allergen PDF audit log:', error)
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasPermission = await checkUserPermission('menu_management', 'view', user.id)
  if (!hasPermission) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const categoryParam = request.nextUrl.searchParams.get('category')
  if (categoryParam && categoryParam !== 'all' && !isDishAllergenCategory(categoryParam)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  const category: DishAllergenCategory | 'all' = categoryParam && isDishAllergenCategory(categoryParam)
    ? categoryParam
    : 'all'

  const [dishesResult, dishIngredientsResult, dishRecipesResult, recipeIngredientsResult, ingredientsResult, dishAssignmentsResult, menusResult, categoriesResult, categoryMenusResult] = await Promise.all([
    supabase.from('menu_dishes').select('id, name, is_active, dietary_flags').order('name', { ascending: true }),
    supabase.from('menu_dish_ingredients').select('dish_id, ingredient_id'),
    supabase.from('menu_dish_recipes').select('dish_id, recipe_id'),
    supabase.from('menu_recipe_ingredients').select('recipe_id, ingredient_id'),
    supabase.from('menu_ingredients').select('id, allergens').eq('is_active', true),
    supabase.from('menu_dish_menu_assignments').select('dish_id, menu_id, category_id, sort_order'),
    supabase.from('menu_menus').select('id, code, name'),
    supabase.from('menu_categories').select('id, name'),
    supabase.from('menu_category_menus').select('menu_id, category_id, sort_order'),
  ])

  const firstError = [dishesResult, dishIngredientsResult, dishRecipesResult, recipeIngredientsResult, ingredientsResult, dishAssignmentsResult, menusResult, categoriesResult, categoryMenusResult]
    .find((result) => result.error)?.error

  if (firstError) {
    console.error('Failed to fetch dish allergen data:', firstError)
    return NextResponse.json({ error: 'Failed to fetch dish allergens' }, { status: 500 })
  }

  const allDishes = (dishesResult.data ?? []) as Array<{
    id: string
    name: string
    is_active: boolean | null
    dietary_flags: string[] | null
  }>

  const menus = (menusResult.data ?? []) as Array<{ id: string; code: string; name: string }>
  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  const drinkMenuIds = new Set(menus.filter((menu) => DRINK_MENU_CODES.has(menu.code)).map((menu) => menu.id))
  const categoriesById = new Map(
    ((categoriesResult.data ?? []) as Array<{ id: string; name: string }>).map((cat) => [cat.id, cat])
  )
  const categorySortByMenuCategory = new Map<string, number>()
  for (const link of (categoryMenusResult.data ?? []) as Array<{ menu_id: string; category_id: string; sort_order: number | null }>) {
    categorySortByMenuCategory.set(`${link.menu_id}:${link.category_id}`, link.sort_order ?? Number.MAX_SAFE_INTEGER - 1)
  }
  const dishAssignments = (dishAssignmentsResult.data ?? []) as Array<{
    dish_id: string
    menu_id: string
    category_id: string
    sort_order: number | null
  }>

  const allowedMenuIds: Set<string> | null = (() => {
    if (category === 'all') return null
    if (category === 'drinks') return drinkMenuIds
    return new Set(menus.filter((menu) => !DRINK_MENU_CODES.has(menu.code)).map((menu) => menu.id))
  })()

  const filteredAssignmentsByDish = new Map<string, typeof dishAssignments>()
  for (const assignment of dishAssignments) {
    if (allowedMenuIds && !allowedMenuIds.has(assignment.menu_id)) continue
    const arr = filteredAssignmentsByDish.get(assignment.dish_id) ?? []
    arr.push(assignment)
    filteredAssignmentsByDish.set(assignment.dish_id, arr)
  }

  const dishes = category === 'all'
    ? allDishes
    : allDishes.filter((dish) => filteredAssignmentsByDish.has(dish.id))

  const allergenMap = buildDishAllergenMap({
    dishIngredients: (dishIngredientsResult.data ?? []) as Array<{ dish_id: string; ingredient_id: string }>,
    dishRecipes: (dishRecipesResult.data ?? []) as Array<{ dish_id: string; recipe_id: string }>,
    recipeIngredients: (recipeIngredientsResult.data ?? []) as Array<{ recipe_id: string; ingredient_id: string }>,
    ingredients: (ingredientsResult.data ?? []) as Array<{ id: string; allergens: string[] | null }>,
  })

  const UNASSIGNED_SORT_KEY = Number.MAX_SAFE_INTEGER
  const sortableRows: Array<{
    row: DishAllergenReportRow
    menuName: string
    categorySort: number
    categoryName: string
    dishSort: number
    dishName: string
  }> = []

  for (const dish of dishes) {
    const assignments = filteredAssignmentsByDish.get(dish.id) ?? []
    const dietaryFlags = dish.dietary_flags ?? []
    const dishAllergens = allergenMap.get(dish.id) ?? []

    if (assignments.length === 0) {
      sortableRows.push({
        row: {
          id: dish.id,
          name: dish.name,
          group_label: 'Unassigned',
          is_active: dish.is_active,
          dietary_flags: dietaryFlags,
          allergens: dishAllergens,
        },
        menuName: '￿',
        categorySort: UNASSIGNED_SORT_KEY,
        categoryName: '',
        dishSort: UNASSIGNED_SORT_KEY,
        dishName: dish.name,
      })
      continue
    }

    for (const assignment of assignments) {
      const menu = menusById.get(assignment.menu_id)
      const cat = categoriesById.get(assignment.category_id)
      const groupLabel = `${menu?.name ?? 'Menu'} — ${cat?.name ?? 'Uncategorised'}`
      sortableRows.push({
        row: {
          id: `${dish.id}:${assignment.menu_id}:${assignment.category_id}`,
          name: dish.name,
          group_label: groupLabel,
          is_active: dish.is_active,
          dietary_flags: dietaryFlags,
          allergens: dishAllergens,
        },
        menuName: menu?.name ?? '￾',
        categorySort: categorySortByMenuCategory.get(`${assignment.menu_id}:${assignment.category_id}`) ?? UNASSIGNED_SORT_KEY - 2,
        categoryName: cat?.name ?? '',
        dishSort: assignment.sort_order ?? UNASSIGNED_SORT_KEY - 2,
        dishName: dish.name,
      })
    }
  }

  sortableRows.sort((a, b) => {
    if (a.menuName !== b.menuName) return a.menuName.localeCompare(b.menuName)
    if (a.categorySort !== b.categorySort) return a.categorySort - b.categorySort
    if (a.categoryName !== b.categoryName) return a.categoryName.localeCompare(b.categoryName)
    if (a.dishSort !== b.dishSort) return a.dishSort - b.dishSort
    return a.dishName.localeCompare(b.dishName)
  })

  const reportRows: DishAllergenReportRow[] = sortableRows.map((entry) => entry.row)

  try {
    const now = new Date()
    const html = generateDishAllergenReportHTML({ dishes: reportRows, generatedAt: now, category })
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    })

    await logReportExport(user.id, user.email, reportRows.length, category)

    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    const filename = `dish-allergens-${category}-${getLondonDateSlug(now)}.pdf`

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Failed to generate dish allergen PDF:', error)
    return NextResponse.json({ error: 'Failed to generate dish allergen PDF' }, { status: 500 })
  }
}
