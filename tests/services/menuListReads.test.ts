import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { MenuService } from '@/services/menu'
import { MenuSettingsService } from '@/services/menu-settings'

const mockedCreateClient = createClient as unknown as Mock

/**
 * A Supabase client whose reads are answered by table name, never by call order, so the same
 * fixture holds whether the service reads one table after another or several at once.
 */
type Reply = { data: unknown; error: unknown }

function buildReadClient(replies: Record<string, Reply | Reply[]>) {
  const reads: Array<{ table: string; select?: string; inArgs?: [string, unknown[]]; eqArgs?: [string, unknown] }> = []
  const counts = new Map<string, number>()

  const client = {
    from: vi.fn((table: string) => {
      const entry = replies[table]
      if (!entry) throw new Error(`Unexpected table: ${table}`)
      const index = counts.get(table) ?? 0
      counts.set(table, index + 1)
      const reply = Array.isArray(entry) ? entry[Math.min(index, entry.length - 1)] : entry
      const read: (typeof reads)[number] = { table }
      reads.push(read)

      const builder = {
        select: (columns: string) => { read.select = columns; return builder },
        order: () => builder,
        eq: (column: string, value: unknown) => { read.eqArgs = [column, value]; return builder },
        in: (column: string, values: unknown[]) => { read.inArgs = [column, values]; return builder },
        then: (resolve: (value: Reply) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(reply).then(resolve, reject),
      }
      return builder
    }),
  }

  return { client, reads }
}

const dishViewRows = [
  {
    dish_id: 'dish-1', name: 'Fish and Chips', description: 'Beer battered cod', selling_price: '16.00',
    portion_cost: '4.00', gp_pct: 0.75, is_gp_alert: false, is_active: true, dietary_flags: null,
    allergen_flags: ['fish'], removable_allergens: null, is_modifiable_for: null, allergen_verified: true,
    allergen_verified_at: '2026-10-01T09:00:00Z', menu_code: 'website_food', menu_name: 'Website',
    category_code: 'mains', category_name: 'Mains', sort_order: 2, is_special: false,
    is_default_side: false, available_from: null, available_until: null,
  },
  {
    dish_id: 'dish-1', name: 'Fish and Chips', description: 'Beer battered cod', selling_price: '16.00',
    portion_cost: '4.00', gp_pct: 0.75, is_gp_alert: false, is_active: true, dietary_flags: null,
    allergen_flags: ['fish'], removable_allergens: null, is_modifiable_for: null, allergen_verified: true,
    allergen_verified_at: '2026-10-01T09:00:00Z', menu_code: 'a_bar', menu_name: 'Bar',
    category_code: 'mains', category_name: 'Mains', sort_order: 1, is_special: true,
    is_default_side: false, available_from: '2026-01-01', available_until: null,
  },
  {
    dish_id: 'dish-2', name: 'Chips', description: null, selling_price: 4, portion_cost: null,
    gp_pct: null, is_gp_alert: null, is_active: false, dietary_flags: ['vegan'], allergen_flags: [],
    removable_allergens: [], is_modifiable_for: {}, allergen_verified: null, allergen_verified_at: null,
    menu_code: null, menu_name: null, category_code: null, category_name: null, sort_order: null,
    is_special: null, is_default_side: null, available_from: null, available_until: null,
  },
]

const dishIngredientRows = [
  {
    dish_id: 'dish-1', quantity: '1', unit: 'portion', yield_pct: 100, wastage_pct: 0, cost_override: null,
    notes: null, option_group: null, inclusion_type: null, upgrade_price: null, measure_ml: null,
    ingredient: { id: 'ing-2', name: 'Peas', default_unit: 'g', storage_type: 'frozen', allergens: null, dietary_flags: ['vegan'], abv: null },
  },
  {
    dish_id: 'dish-1', quantity: 2, unit: 'portion', yield_pct: null, wastage_pct: null, cost_override: 1.5,
    notes: 'fresh', option_group: 'fish', inclusion_type: 'choice', upgrade_price: 2, measure_ml: null,
    ingredient: { id: 'ing-1', name: 'Cod fillet', default_unit: 'portion', storage_type: 'frozen', allergens: ['fish'], dietary_flags: null, abv: null },
  },
  { dish_id: 'dish-2', quantity: 1, ingredient: null },
]

const ingredientPricingRows = [
  { id: 'ing-1', latest_unit_cost: '2.00', latest_pack_cost: '20.00', pack_cost: 18, default_unit: 'portion' },
  { id: 'ing-2', latest_unit_cost: null, latest_pack_cost: null, pack_cost: 5, default_unit: null },
]

const dishRecipeRows = [
  { dish_id: 'dish-1', recipe_id: 'rec-1', quantity: '1', yield_pct: null, wastage_pct: null, cost_override: null, notes: null, option_group: null, inclusion_type: null, upgrade_price: null },
  { dish_id: 'dish-1', recipe_id: 'rec-missing', quantity: 1 },
]

const recipeMetaRows = [
  { id: 'rec-1', name: 'Tartare sauce', portion_cost: '0.20', yield_quantity: 10, yield_unit: null, allergen_flags: ['eggs'], dietary_flags: [], is_active: true },
]

const expectedDishes = [
  {
    id: 'dish-1',
    name: 'Fish and Chips',
    description: 'Beer battered cod',
    selling_price: 16,
    portion_cost: 4,
    gp_pct: 0.75,
    target_gp_pct: 0.7,
    is_gp_alert: false,
    is_active: true,
    dietary_flags: [],
    allergen_flags: ['fish'],
    removable_allergens: [],
    is_modifiable_for: {},
    allergen_verified: true,
    allergen_verified_at: '2026-10-01T09:00:00Z',
    assignments: [
      { menu_code: 'a_bar', menu_name: 'Bar', category_code: 'mains', category_name: 'Mains', sort_order: 1, is_special: true, is_default_side: false, available_from: '2026-01-01', available_until: null },
      { menu_code: 'website_food', menu_name: 'Website', category_code: 'mains', category_name: 'Mains', sort_order: 2, is_special: false, is_default_side: false, available_from: null, available_until: null },
    ],
    ingredients: [
      {
        ingredient_id: 'ing-1', ingredient_name: 'Cod fillet', quantity: 2, unit: 'portion', yield_pct: null,
        wastage_pct: null, cost_override: 1.5, notes: 'fresh', latest_unit_cost: 2, latest_pack_cost: 20,
        default_unit: 'portion', dietary_flags: [], allergens: ['fish'], option_group: 'fish',
        inclusion_type: 'choice', upgrade_price: 2, abv: null, measure_ml: null,
      },
      {
        ingredient_id: 'ing-2', ingredient_name: 'Peas', quantity: 1, unit: 'portion', yield_pct: 100,
        wastage_pct: 0, cost_override: null, notes: null, latest_unit_cost: null, latest_pack_cost: 5,
        default_unit: 'g', dietary_flags: ['vegan'], allergens: [], option_group: null,
        inclusion_type: 'included', upgrade_price: null, abv: null, measure_ml: null,
      },
    ],
    recipes: [
      {
        recipe_id: 'rec-1', recipe_name: 'Tartare sauce', quantity: 1, yield_pct: null, wastage_pct: null,
        cost_override: null, notes: null, portion_cost: 0.2, yield_quantity: 10, yield_unit: 'portion',
        dietary_flags: [], allergen_flags: ['eggs'], recipe_is_active: true, option_group: null,
        inclusion_type: 'included', upgrade_price: null,
      },
    ],
    cost_data_complete: false,
  },
  {
    id: 'dish-2',
    name: 'Chips',
    description: null,
    selling_price: 4,
    portion_cost: 0,
    gp_pct: null,
    target_gp_pct: 0.7,
    is_gp_alert: false,
    is_active: false,
    dietary_flags: ['vegan'],
    allergen_flags: [],
    removable_allergens: [],
    is_modifiable_for: {},
    allergen_verified: false,
    allergen_verified_at: null,
    assignments: [],
    ingredients: [],
    recipes: [],
    cost_data_complete: true,
  },
]

function dishReplies(): Record<string, Reply> {
  return {
    menu_dishes_with_costs: { data: dishViewRows, error: null },
    menu_dish_ingredients: { data: dishIngredientRows, error: null },
    menu_ingredients_with_prices: { data: ingredientPricingRows, error: null },
    menu_dish_recipes: { data: dishRecipeRows, error: null },
    menu_recipes: { data: recipeMetaRows, error: null },
  }
}

describe('MenuService.listDishes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(MenuSettingsService, 'getMenuTargetGp').mockResolvedValue(0.7)
  })

  it('returns the same dishes, costs and assignments for a fixed fixture', async () => {
    const { client, reads } = buildReadClient(dishReplies())
    mockedCreateClient.mockResolvedValue(client)

    const result = await MenuService.listDishes()

    expect(result).toEqual({ data: expectedDishes, target_gp_pct: 0.7 })
    expect(reads.map((r) => r.table).sort()).toEqual([
      'menu_dish_ingredients',
      'menu_dish_recipes',
      'menu_dishes_with_costs',
      'menu_ingredients_with_prices',
      'menu_recipes',
    ])
    expect(reads.find((r) => r.table === 'menu_ingredients_with_prices')?.inArgs).toEqual(['id', ['ing-2', 'ing-1']])
    expect(reads.find((r) => r.table === 'menu_recipes')?.inArgs).toEqual(['id', ['rec-1', 'rec-missing']])
  })

  it('filters the view by menu code when one is given', async () => {
    const { client, reads } = buildReadClient(dishReplies())
    mockedCreateClient.mockResolvedValue(client)

    await MenuService.listDishes('website_food')

    expect(reads.find((r) => r.table === 'menu_dishes_with_costs')?.eqArgs).toEqual(['menu_code', 'website_food'])
  })

  it('keeps the dishes when a composition read fails', async () => {
    const replies = dishReplies()
    replies.menu_dish_ingredients = { data: null, error: { message: 'boom' } }
    replies.menu_dish_recipes = { data: null, error: { message: 'boom' } }
    const { client, reads } = buildReadClient(replies)
    mockedCreateClient.mockResolvedValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await MenuService.listDishes()

    expect(result.data.map((d) => d.id)).toEqual(['dish-1', 'dish-2'])
    expect(result.data[0].ingredients).toEqual([])
    expect(result.data[0].recipes).toEqual([])
    // Nothing to price or describe, so neither follow-up read runs.
    expect(reads.map((r) => r.table)).not.toContain('menu_ingredients_with_prices')
    expect(reads.map((r) => r.table)).not.toContain('menu_recipes')
  })

  it('throws when the dish view read fails', async () => {
    const replies = dishReplies()
    replies.menu_dishes_with_costs = { data: null, error: { message: 'boom' } }
    const { client } = buildReadClient(replies)
    mockedCreateClient.mockResolvedValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(MenuService.listDishes()).rejects.toThrow('Failed to fetch dishes')
  })
})

const ingredientViewRows = [
  {
    id: 'ing-1', name: 'Cod fillet', description: null, default_unit: 'portion', storage_type: 'frozen',
    purchase_department: 'kitchen', supplier_name: 'Brakes', supplier_sku: 'C1', brand: null, pack_size: 10,
    pack_size_unit: 'portion', pack_cost: '20.00', latest_pack_cost: '20.00', latest_unit_cost: '2.00',
    portions_per_pack: 10, wastage_pct: 0, shelf_life_days: 90, allergens: ['fish'], dietary_flags: null,
    notes: null, is_active: true, abv: null,
  },
  {
    id: 'ing-2', name: 'Lager', description: 'Draught', default_unit: 'ml', storage_type: 'ambient',
    purchase_department: 'something_else', supplier_name: null, supplier_sku: null, brand: 'Brand', pack_size: null,
    pack_size_unit: null, pack_cost: null, latest_pack_cost: null, latest_unit_cost: null,
    portions_per_pack: null, wastage_pct: null, shelf_life_days: null, allergens: null, dietary_flags: ['vegan'],
    notes: 'tap', is_active: null, abv: 4.2,
  },
]

const usageRows = [
  {
    ingredient_id: 'ing-1', quantity: '1', unit: 'portion', yield_pct: 100, wastage_pct: 0, cost_override: null, notes: null,
    dish: { id: 'dish-1', name: 'Fish and Chips', selling_price: '16', portion_cost: '4', gp_pct: 0.75, is_gp_alert: false, is_active: true },
  },
  {
    ingredient_id: 'ing-1', quantity: 1, unit: 'portion', yield_pct: null, wastage_pct: null, cost_override: null, notes: null,
    dish: { id: 'dish-0', name: 'Fish Finger Sandwich', selling_price: null, portion_cost: null, gp_pct: null, is_gp_alert: null, is_active: null },
  },
  { ingredient_id: 'ing-2', quantity: 1, dish: null },
]

const usageAssignmentRows = [
  { dish_id: 'dish-1', sort_order: 2, is_special: false, is_default_side: false, menu: { code: 'website_food', name: 'Website' }, category: { code: 'mains', name: 'Mains' } },
  { dish_id: 'dish-1', sort_order: 1, is_special: null, is_default_side: null, menu: { code: 'a_bar', name: 'Bar' }, category: null },
]

const baseIngredient1 = {
  id: 'ing-1', name: 'Cod fillet', description: null, default_unit: 'portion', storage_type: 'frozen',
  purchase_department: 'kitchen', supplier_name: 'Brakes', supplier_sku: 'C1', brand: null, pack_size: 10,
  pack_size_unit: 'portion', pack_cost: 20, latest_pack_cost: 20, latest_unit_cost: 2, portions_per_pack: 10,
  wastage_pct: 0, shelf_life_days: 90, allergens: ['fish'], dietary_flags: [], notes: null, is_active: true, abv: null,
}

const baseIngredient2 = {
  id: 'ing-2', name: 'Lager', description: 'Draught', default_unit: 'ml', storage_type: 'ambient',
  purchase_department: 'kitchen', supplier_name: null, supplier_sku: null, brand: 'Brand', pack_size: null,
  pack_size_unit: null, pack_cost: 0, latest_pack_cost: null, latest_unit_cost: null, portions_per_pack: null,
  wastage_pct: null, shelf_life_days: null, allergens: [], dietary_flags: ['vegan'], notes: 'tap', is_active: true, abv: 4.2,
}

const expectedIngredientsWithUsage = [
  {
    ...baseIngredient1,
    dishes: [
      {
        dish_id: 'dish-1', dish_name: 'Fish and Chips', dish_selling_price: 16, dish_portion_cost: 4, dish_gp_pct: 0.75,
        dish_is_gp_alert: false, dish_is_active: true, quantity: 1, unit: 'portion', yield_pct: 100, wastage_pct: 0,
        cost_override: null, notes: null,
        assignments: [
          { menu_code: 'a_bar', menu_name: 'Bar', category_code: '', category_name: '', sort_order: 1, is_special: false, is_default_side: false },
          { menu_code: 'website_food', menu_name: 'Website', category_code: 'mains', category_name: 'Mains', sort_order: 2, is_special: false, is_default_side: false },
        ],
      },
      {
        dish_id: 'dish-0', dish_name: 'Fish Finger Sandwich', dish_selling_price: 0, dish_portion_cost: 0, dish_gp_pct: null,
        dish_is_gp_alert: false, dish_is_active: false, quantity: 1, unit: 'portion', yield_pct: null, wastage_pct: null,
        cost_override: null, notes: null, assignments: [],
      },
    ],
  },
  { ...baseIngredient2, dishes: [] },
]

function ingredientReplies(): Record<string, Reply> {
  return {
    menu_ingredients_with_prices: { data: ingredientViewRows, error: null },
    menu_dish_ingredients: { data: usageRows, error: null },
    menu_dish_menu_assignments: { data: usageAssignmentRows, error: null },
  }
}

describe('MenuService.listIngredients', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('by default returns every ingredient with the dishes it is used in', async () => {
    const targetGp = vi.spyOn(MenuSettingsService, 'getMenuTargetGp').mockResolvedValue(0.7)
    const { client, reads } = buildReadClient(ingredientReplies())
    mockedCreateClient.mockResolvedValue(client)

    const result = await MenuService.listIngredients()

    expect(result).toEqual({ data: expectedIngredientsWithUsage })
    expect(reads.map((r) => r.table)).toEqual([
      'menu_ingredients_with_prices',
      'menu_dish_ingredients',
      'menu_dish_menu_assignments',
    ])
    expect(targetGp).toHaveBeenCalledTimes(1)
  })

  it('with includeUsage false reads only the ingredient view and leaves the dish lists empty', async () => {
    const targetGp = vi.spyOn(MenuSettingsService, 'getMenuTargetGp').mockResolvedValue(0.7)
    const { client, reads } = buildReadClient(ingredientReplies())
    mockedCreateClient.mockResolvedValue(client)

    const result = await MenuService.listIngredients({ includeUsage: false })

    expect(result).toEqual({ data: [{ ...baseIngredient1, dishes: [] }, { ...baseIngredient2, dishes: [] }] })
    expect(reads.map((r) => r.table)).toEqual(['menu_ingredients_with_prices'])
    expect(targetGp).not.toHaveBeenCalled()
  })
})
