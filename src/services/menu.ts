import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MENU_PURCHASE_DEPARTMENTS, isMenuPurchaseDepartment } from '@/lib/menu/purchase-departments';
import { MenuSettingsService } from '@/services/menu-settings';
import { z } from 'zod'; // Import z for schemas

const UNITS = [
  'each', 'portion', 'gram', 'kilogram', 'millilitre', 'litre', 'ounce', 'pound',
  'teaspoon', 'tablespoon', 'cup', 'slice', 'piece',
] as const;

const STORAGE_TYPES = ['ambient', 'chilled', 'frozen', 'dry', 'other'] as const;
const INGREDIENT_DIETARY_FLAG_ORDER = ['vegetarian', 'vegan', 'gluten_free', 'halal', 'dairy_free', 'kosher'] as const;
const INGREDIENT_SELECT_WITH_DEPARTMENT = 'id, name, description, default_unit, storage_type, purchase_department, supplier_name, supplier_sku, brand, pack_size, pack_size_unit, pack_cost, portions_per_pack, wastage_pct, shelf_life_days, allergens, dietary_flags, notes, is_active, latest_pack_cost, latest_unit_cost, abv';
const INGREDIENT_SELECT_WITHOUT_DEPARTMENT = 'id, name, description, default_unit, storage_type, supplier_name, supplier_sku, brand, pack_size, pack_size_unit, pack_cost, portions_per_pack, wastage_pct, shelf_life_days, allergens, dietary_flags, notes, is_active, latest_pack_cost, latest_unit_cost, abv';

function isMissingPurchaseDepartmentColumn(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42703' && /purchase_department/i.test(error.message ?? '');
}

function orderUniqueValues(values: string[], preferredOrder: readonly string[]): string[] {
  const unique = Array.from(new Set(values));
  const ordered = preferredOrder.filter((value) => unique.includes(value));
  const remainder = unique.filter((value) => !preferredOrder.includes(value));
  return [...ordered, ...remainder];
}

export const IngredientSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  default_unit: z.enum(UNITS).default('each'),
  storage_type: z.enum(STORAGE_TYPES).default('ambient'),
  purchase_department: z.enum(MENU_PURCHASE_DEPARTMENTS).default('kitchen'),
  supplier_name: z.string().nullable().optional(),
  supplier_sku: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  pack_size: z.number().nonnegative().nullable().optional(),
  pack_size_unit: z.enum(UNITS).optional().nullable(),
  pack_cost: z.number().nonnegative().default(0),
  portions_per_pack: z.number().nonnegative().nullable().optional(),
  wastage_pct: z.number().min(0).max(100).default(0),
  shelf_life_days: z.number().int().nullable().optional(),
  allergens: z.array(z.string()).default([]),
  dietary_flags: z.array(z.string()).default([]),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  abv: z.number().nonnegative().nullable().optional(),
});

const IngredientPriceSchema = z.object({
  ingredient_id: z.string().uuid(),
  pack_cost: z.number().positive(),
  effective_from: z.coerce.date().optional(),
  supplier_name: z.string().optional(),
  supplier_sku: z.string().optional(),
  notes: z.string().optional(),
});

const BaseIngredientLinkSchema = z.object({
  ingredient_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.enum(UNITS),
  yield_pct: z.number().min(0).max(100).default(100),
  wastage_pct: z.number().min(0).max(100).default(0),
  cost_override: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  option_group: z.string().nullable().optional(),
  measure_ml: z.number().nonnegative().nullable().optional(),
});

function requireOptionGroupForChoices(
  value: { inclusion_type?: string; option_group?: string | null },
  context: z.RefinementCtx
) {
  const inclusionType = value.inclusion_type || 'included';
  if ((inclusionType === 'choice' || inclusionType === 'upgrade') && !value.option_group?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Option group is required for choice and upgrade rows',
      path: ['option_group'],
    });
  }
}

const DishIngredientSchema = BaseIngredientLinkSchema.extend({
  inclusion_type: z.enum(['included', 'removable', 'choice', 'upgrade']).default('included'),
  upgrade_price: z.number().nonnegative().nullable().optional(),
}).superRefine(requireOptionGroupForChoices);

const RecipeIngredientSchema = BaseIngredientLinkSchema.extend({});

const DishRecipeSchema = z.object({
  recipe_id: z.string().uuid(),
  quantity: z.number().positive(),
  yield_pct: z.number().min(0).max(100).default(100),
  wastage_pct: z.number().min(0).max(100).default(0),
  cost_override: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  option_group: z.string().nullable().optional(),
  inclusion_type: z.enum(['included', 'removable', 'choice', 'upgrade']).default('included'),
  upgrade_price: z.number().nonnegative().nullable().optional(),
}).superRefine(requireOptionGroupForChoices);

export const RecipeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  instructions: z.string().optional(),
  yield_quantity: z.number().positive().default(1),
  yield_unit: z.enum(UNITS).default('portion'),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  ingredients: z.array(RecipeIngredientSchema).default([]),
});

const DishAssignmentSchema = z.object({
  menu_code: z.string().min(1),
  category_code: z.string().min(1),
  sort_order: z.number().int().default(0),
  is_special: z.boolean().default(false),
  is_default_side: z.boolean().default(false),
  available_from: z.coerce.date().nullable().optional().transform(d => d?.toISOString() ?? null),
  available_until: z.coerce.date().nullable().optional().transform(d => d?.toISOString() ?? null),
});

export const DishSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  selling_price: z.number().nonnegative(),
  calories: z.number().int().optional().nullable(),
  is_active: z.boolean().default(true),
  is_sunday_lunch: z.boolean().default(false),
  image_url: z.string().optional(),
  notes: z.string().nullable().optional(),
  ingredients: z.array(DishIngredientSchema).default([]),
  recipes: z.array(DishRecipeSchema).default([]),
  assignments: z.array(DishAssignmentSchema).min(1),
});

export type CreateIngredientInput = z.infer<typeof IngredientSchema>;
export type UpdateIngredientInput = Partial<CreateIngredientInput>;
export type RecordIngredientPriceInput = z.infer<typeof IngredientPriceSchema>;
export type CreateRecipeInput = z.infer<typeof RecipeSchema>;
export type UpdateRecipeInput = Partial<CreateRecipeInput>;
export type CreateDishInput = z.infer<typeof DishSchema>;
export type UpdateDishInput = Partial<CreateDishInput>;

export class MenuService {


  // Helper to resolve menu and category IDs from codes
  static async getMenuAndCategoryIds(
    assignments: Array<{ menu_code: string; category_code: string }>,
    admin = createAdminClient()
  ) {
    const supabase = admin;

    const menuCodes = Array.from(new Set(assignments.map(a => a.menu_code)));
    const categoryCodes = Array.from(new Set(assignments.map(a => a.category_code)));

    const [{ data: menus }, { data: categories }] = await Promise.all([
      supabase
        .from('menu_menus')
        .select('id, code')
        .in('code', menuCodes),
      supabase
        .from('menu_categories')
        .select('id, code')
        .in('code', categoryCodes),
    ]);

    if (!menus || menus.length !== menuCodes.length) {
      throw new Error('One or more menu codes are invalid');
    }
    if (!categories || categories.length !== categoryCodes.length) {
      throw new Error('One or more category codes are invalid');
    }

    const menuMap = new Map(menus.map(m => [m.code, m.id]));
    const categoryMap = new Map(categories.map(c => [c.code, c.id]));

    return { menuMap, categoryMap };
  }

  // Ingredients ---------------------------------------------------------------------------------------------------
  static async listIngredients() {
    const supabase = await createClient();
    const targetGpPct = await MenuSettingsService.getMenuTargetGp({ client: supabase });

    const ingredientsResult = await supabase
      .from('menu_ingredients_with_prices')
      .select(INGREDIENT_SELECT_WITH_DEPARTMENT)
      .order('name', { ascending: true });
    let data = ingredientsResult.data as any[] | null;
    let error = ingredientsResult.error;

    if (isMissingPurchaseDepartmentColumn(error)) {
      console.warn(
        'menu_ingredients_with_prices.purchase_department is missing; defaulting ingredients to kitchen until the migration is applied.'
      );
      const fallback = await supabase
        .from('menu_ingredients_with_prices')
        .select(INGREDIENT_SELECT_WITHOUT_DEPARTMENT)
        .order('name', { ascending: true });
      data = fallback.data as any[] | null;
      error = fallback.error;
    }

    if (error) {
      console.error('listMenuIngredients error:', error);
      throw new Error('Failed to fetch ingredients');
    }

    const ingredients = data || [];
    const ingredientIds = ingredients.map(ingredient => ingredient.id);

    let usageRows: any[] = [];
    let assignmentRows: any[] = [];

    if (ingredientIds.length > 0) {
      const { data: usageData, error: usageError } = await supabase
        .from('menu_dish_ingredients')
        .select(`
          ingredient_id,
          quantity,
          unit,
          yield_pct,
          wastage_pct,
          cost_override,
          notes,
          dish:menu_dishes(
            id,
            name,
            selling_price,
            portion_cost,
            gp_pct,
            is_gp_alert,
            is_active
          )
        `)
        .in('ingredient_id', ingredientIds);

      if (usageError) {
        console.error('listMenuIngredients usage error:', usageError);
      } else {
        usageRows = usageData || [];
      }

      const dishIds = Array.from(
        new Set(
          usageRows
            .map(row => row.dish?.id)
            .filter((id): id is string => Boolean(id))
        )
      );

      if (dishIds.length > 0) {
        const { data: assignmentsData, error: assignmentsError } = await supabase
          .from('menu_dish_menu_assignments')
          .select('dish_id, sort_order, is_special, is_default_side, menu:menu_menus(code, name), category:menu_categories(code, name)')
          .in('dish_id', dishIds);

        if (assignmentsError) {
          console.error('listMenuIngredients assignments error:', assignmentsError);
        } else {
          assignmentRows = assignmentsData || [];
        }
      }
    }

    const assignmentsByDish = new Map<string, any[]>();
    assignmentRows.forEach(row => {
      const entry = {
        menu_code: row.menu?.code ?? '',
        menu_name: row.menu?.name ?? '',
        category_code: row.category?.code ?? '',
        category_name: row.category?.name ?? '',
        sort_order: row.sort_order ?? 0,
        is_special: row.is_special ?? false,
        is_default_side: row.is_default_side ?? false,
      };

      const current = assignmentsByDish.get(row.dish_id) || [];
      current.push(entry);
      assignmentsByDish.set(row.dish_id, current);
    });

    const usageByIngredient = new Map<string, any[]>();
    usageRows.forEach(row => {
      if (!row?.dish?.id) return;
      const usageEntry = {
        dish_id: row.dish.id,
        dish_name: row.dish.name,
        dish_selling_price: Number(row.dish.selling_price ?? 0),
        dish_portion_cost: Number(row.dish.portion_cost ?? 0),
        dish_gp_pct: row.dish.gp_pct ?? null,
        dish_is_gp_alert: row.dish.is_gp_alert ?? false,
        dish_is_active: row.dish.is_active ?? false,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit,
        yield_pct: row.yield_pct,
        wastage_pct: row.wastage_pct,
        cost_override: row.cost_override,
        notes: row.notes,
        assignments: (assignmentsByDish.get(row.dish.id) || []).sort((a, b) => {
          if (a.menu_code === b.menu_code) {
            return a.sort_order - b.sort_order;
          }
          return a.menu_code.localeCompare(b.menu_code);
        }),
      };

      const existing = usageByIngredient.get(row.ingredient_id) || [];
      existing.push(usageEntry);
      usageByIngredient.set(row.ingredient_id, existing);
    });

    const result = ingredients.map(ingredient => ({
      id: ingredient.id,
      name: ingredient.name,
      description: ingredient.description,
      default_unit: ingredient.default_unit,
      storage_type: ingredient.storage_type,
      purchase_department: isMenuPurchaseDepartment(ingredient.purchase_department)
        ? ingredient.purchase_department
        : 'kitchen',
      supplier_name: ingredient.supplier_name,
      supplier_sku: ingredient.supplier_sku,
      brand: ingredient.brand,
      pack_size: ingredient.pack_size,
      pack_size_unit: ingredient.pack_size_unit,
      pack_cost: Number(ingredient.pack_cost ?? 0),
      latest_pack_cost: ingredient.latest_pack_cost != null ? Number(ingredient.latest_pack_cost) : null,
      latest_unit_cost: ingredient.latest_unit_cost != null ? Number(ingredient.latest_unit_cost) : null,
      portions_per_pack: ingredient.portions_per_pack,
      wastage_pct: ingredient.wastage_pct,
      shelf_life_days: ingredient.shelf_life_days,
      allergens: ingredient.allergens || [],
      dietary_flags: ingredient.dietary_flags || [],
      notes: ingredient.notes,
      is_active: ingredient.is_active ?? true,
      abv: ingredient.abv ?? null,
      dishes: (usageByIngredient.get(ingredient.id) || []).sort((a, b) =>
        a.dish_name.localeCompare(b.dish_name)
      ),
    }));

    return { data: result };
  }

  static async getIngredientPrices(ingredientId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('menu_ingredient_prices')
      .select('id, pack_cost, effective_from, supplier_name, supplier_sku, notes, created_at')
      .eq('ingredient_id', ingredientId)
      .order('effective_from', { ascending: false });

    if (error) {
      console.error('getMenuIngredientPrices error:', error);
      throw new Error('Failed to fetch price history');
    }

    return { data: data || [] };
  }

  static async createIngredient(input: CreateIngredientInput) {
    const supabase = await createClient();

    const { data: ingredient, error } = await supabase.rpc('menu_create_ingredient_with_price', {
      p_name: input.name,
      p_description: input.description || null,
      p_default_unit: input.default_unit,
      p_storage_type: input.storage_type,
      p_purchase_department: input.purchase_department,
      p_supplier_name: input.supplier_name || null,
      p_supplier_sku: input.supplier_sku || null,
      p_brand: input.brand || null,
      p_pack_size: input.pack_size ?? null,
      p_pack_size_unit: input.pack_size_unit ?? null,
      p_pack_cost: input.pack_cost,
      p_portions_per_pack: input.portions_per_pack ?? null,
      p_wastage_pct: input.wastage_pct,
      p_shelf_life_days: input.shelf_life_days ?? null,
      p_allergens: input.allergens,
      p_dietary_flags: input.dietary_flags,
      p_notes: input.notes || null,
      p_is_active: input.is_active,
      p_abv: input.abv ?? null,
    });

    if (error) {
      console.error('createMenuIngredient error:', error);
      throw new Error('Failed to create ingredient');
    }

    return ingredient;
  }

  static async updateIngredient(id: string, input: UpdateIngredientInput) {
    const supabase = await createClient();

    const { data: ingredient, error } = await supabase.rpc('menu_update_ingredient_with_price', {
      p_ingredient_id: id,
      p_name: input.name,
      p_description: input.description || null,
      p_default_unit: input.default_unit,
      p_storage_type: input.storage_type,
      p_purchase_department: input.purchase_department,
      p_supplier_name: input.supplier_name || null,
      p_supplier_sku: input.supplier_sku || null,
      p_brand: input.brand || null,
      p_pack_size: input.pack_size ?? null,
      p_pack_size_unit: input.pack_size_unit ?? null,
      p_pack_cost: input.pack_cost,
      p_portions_per_pack: input.portions_per_pack ?? null,
      p_wastage_pct: input.wastage_pct,
      p_shelf_life_days: input.shelf_life_days ?? null,
      p_allergens: input.allergens,
      p_dietary_flags: input.dietary_flags,
      p_notes: input.notes || null,
      p_is_active: input.is_active,
      p_abv: input.abv ?? null,
    });

    if (error) {
      console.error('updateMenuIngredient error:', error);
      throw new Error(error.message === 'Ingredient not found' ? 'Ingredient not found' : 'Failed to update ingredient');
    }

    return ingredient;
  }

  static async recordIngredientPrice(input: RecordIngredientPriceInput) {
    const supabase = await createClient();

    const { error } = await supabase.from('menu_ingredient_prices').insert({
      ingredient_id: input.ingredient_id,
      pack_cost: input.pack_cost,
      effective_from: input.effective_from ?? new Date(),
      supplier_name: input.supplier_name || null,
      supplier_sku: input.supplier_sku || null,
      notes: input.notes || null,
    });

    if (error) {
      console.error('recordMenuIngredientPrice error:', error);
      throw new Error('Failed to record price change');
    }

    return { success: true };
  }

  static async deleteIngredient(id: string) {
    const supabase = await createClient();

    const { data: deletedIngredient, error } = await supabase
      .from('menu_ingredients')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('deleteMenuIngredient error:', error);
      if (error.code === '23503') {
        throw new Error('Cannot delete: this ingredient is still used by other records. Remove those references first.');
      }
      throw new Error('Failed to delete ingredient');
    }
    if (!deletedIngredient) {
      throw new Error('Ingredient not found');
    }

    return { success: true };
  }

  // Recipes -------------------------------------------------------------------------------------------------------
  static async listRecipes(options?: { includeIngredients?: boolean; includeAssignments?: boolean; }) {
    const includeIngredients = options?.includeIngredients !== false;
    const includeAssignments = options?.includeAssignments !== false;
    const supabase = await createClient();

    const { data: recipes, error } = await supabase
      .from('menu_recipes')
      .select('id, name, description, instructions, yield_quantity, yield_unit, portion_cost, allergen_flags, dietary_flags, notes, is_active, created_at, updated_at')
      .order('name', { ascending: true });

    if (error) {
      console.error('listMenuRecipes error:', error);
      throw new Error('Failed to fetch recipes');
    }

    const recipeIds = (recipes || []).map(recipe => recipe.id);
    let ingredientRows: any[] = [];
    let priceMap = new Map<string, any>();
    let dishLinkRows: any[] = [];
    let assignmentRows: any[] = [];

    if (includeIngredients && recipeIds.length > 0) {
      const { data: ingredientData, error: ingredientError } = await supabase
        .from('menu_recipe_ingredients')
        .select(`
          recipe_id,
          quantity,
          unit,
          yield_pct,
          wastage_pct,
          cost_override,
          notes,
          ingredient:menu_ingredients(
            id,
            name,
            default_unit,
            allergens,
            dietary_flags
          )
        `)
        .in('recipe_id', recipeIds);

      if (ingredientError) {
        console.error('listMenuRecipes ingredient error:', ingredientError);
      } else {
        ingredientRows = ingredientData || [];
      }

      const ingredientIds = Array.from(
        new Set(
          ingredientRows
            .map(row => row.ingredient?.id)
            .filter((id): id is string => Boolean(id))
        )
      );

      if (ingredientIds.length > 0) {
        const { data: pricingData, error: pricingError } = await supabase
          .from('menu_ingredients_with_prices')
          .select('id, latest_unit_cost, latest_pack_cost, pack_cost, default_unit')
          .in('id', ingredientIds);

        if (pricingError) {
          console.error('listMenuRecipes ingredient pricing error:', pricingError);
        } else {
          priceMap = new Map(
            (pricingData || []).map(entry => [entry.id, entry])
          );
        }
      }
    }

    if (includeAssignments && recipeIds.length > 0) {
      const { data: dishRecipeData, error: dishRecipeError } = await supabase
        .from('menu_dish_recipes')
        .select(`
          recipe_id,
          quantity,
          dish:menu_dishes(
            id,
            name,
            selling_price,
            gp_pct,
            is_active
          )
        `)
        .in('recipe_id', recipeIds);

      if (dishRecipeError) {
        console.error('listMenuRecipes dish link error:', dishRecipeError);
      } else {
        dishLinkRows = dishRecipeData || [];
      }

      const dishIds = Array.from(
        new Set(
          dishLinkRows
            .map(row => row.dish?.id)
            .filter((id): id is string => Boolean(id))
        )
      );

      if (dishIds.length > 0) {
        const { data: assignmentsData, error: assignmentsError } = await supabase
          .from('menu_dish_menu_assignments')
          .select('dish_id, sort_order, is_special, is_default_side, menu:menu_menus(code, name), category:menu_categories(code, name)')
          .in('dish_id', dishIds);

        if (assignmentsError) {
          console.error('listMenuRecipes assignments error:', assignmentsError);
        } else {
          assignmentRows = assignmentsData || [];
        }
      }
    }

    const ingredientsByRecipe = new Map<string, any[]>();
    ingredientRows.forEach(row => {
      if (!row?.ingredient?.id) return;
      const pricing = priceMap.get(row.ingredient.id);
      const detail = {
        ingredient_id: row.ingredient.id,
        ingredient_name: row.ingredient.name,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit,
        yield_pct: row.yield_pct,
        wastage_pct: row.wastage_pct,
        cost_override: row.cost_override,
        notes: row.notes,
        latest_unit_cost: pricing?.latest_unit_cost != null ? Number(pricing.latest_unit_cost) : null,
        latest_pack_cost:
          pricing?.latest_pack_cost != null
            ? Number(pricing.latest_pack_cost)
            : pricing?.pack_cost != null
              ? Number(pricing.pack_cost)
              : null,
        default_unit: pricing?.default_unit ?? row.ingredient.default_unit ?? null,
        dietary_flags: row.ingredient.dietary_flags || [],
        allergens: row.ingredient.allergens || [],
      };

      const existing = ingredientsByRecipe.get(row.recipe_id) || [];
      existing.push(detail);
      ingredientsByRecipe.set(row.recipe_id, existing);
    });

    const assignmentsByDish = new Map<string, any[]>();
    assignmentRows.forEach(row => {
      const entry = {
        menu_code: row.menu?.code ?? '',
        menu_name: row.menu?.name ?? '',
        category_code: row.category?.code ?? '',
        category_name: row.category?.name ?? '',
        sort_order: row.sort_order ?? 0,
        is_special: row.is_special ?? false,
        is_default_side: row.is_default_side ?? false,
      };

      const existing = assignmentsByDish.get(row.dish_id) || [];
      existing.push(entry);
      assignmentsByDish.set(row.dish_id, existing);
    });

    const usageByRecipe = new Map<string, any[]>();
    dishLinkRows.forEach(row => {
      if (!row?.dish?.id) return;
      const entry = {
        dish_id: row.dish.id,
        dish_name: row.dish.name,
        quantity: Number(row.quantity ?? 0),
        dish_gp_pct: row.dish.gp_pct ?? null,
        dish_selling_price: Number(row.dish.selling_price ?? 0),
        dish_is_active: row.dish.is_active ?? false,
        assignments: (assignmentsByDish.get(row.dish.id) || []).sort((a, b) => {
          if (a.menu_code === b.menu_code) {
            return a.sort_order - b.sort_order;
          }
          return a.menu_code.localeCompare(b.menu_code);
        }),
      };

      const existing = usageByRecipe.get(row.recipe_id) || [];
      existing.push(entry);
      usageByRecipe.set(row.recipe_id, existing);
    });

    const result = (recipes || []).map(recipe => ({
      ...recipe,
      ingredients: includeIngredients
        ? (ingredientsByRecipe.get(recipe.id) || []).sort((a, b) =>
            a.ingredient_name.localeCompare(b.ingredient_name)
          )
        : [],
      usage: includeAssignments ? usageByRecipe.get(recipe.id) || [] : [],
    }));

    return { data: result };
  }

  static async getRecipeDetail(id: string) {
    const supabase = await createClient();

    const [
      { data: recipe, error: recipeError },
      { data: ingredients, error: ingredientsError },
      { data: usage, error: usageError },
    ] = await Promise.all([
      supabase.from('menu_recipes').select('*').eq('id', id).single(),
      supabase
        .from('menu_recipe_ingredients')
        .select('id, recipe_id, ingredient_id, quantity, unit, yield_pct, wastage_pct, cost_override, notes, ingredient:menu_ingredients(name, default_unit)')
        .eq('recipe_id', id),
      supabase
        .from('menu_dish_recipes')
        .select('dish:menu_dishes(id, name, selling_price, gp_pct, is_active), quantity')
        .eq('recipe_id', id),
    ]);

    if (recipeError || ingredientsError || usageError) {
      throw new Error('Failed to fetch recipe detail');
    }

    return {
      recipe,
      ingredients: ingredients || [],
      usage: usage || [],
    };
  }

  static async updateRecipe(id: string, input: UpdateRecipeInput) {
    const supabase = await createClient();

    // DEFECT-002 fix: replaced 4 sequential writes (update + delete + insert + rpc) with a single
    // atomic RPC call. On any mid-step failure the implicit savepoint rolls back all changes,
    // leaving the recipe with its original ingredients intact.
    const recipeData = {
      name: input.name,
      description: input.description || null,
      instructions: input.instructions || null,
      yield_quantity: input.yield_quantity,
      yield_unit: input.yield_unit,
      notes: input.notes || null,
      is_active: input.is_active,
    };

    const ingredientsPayload = (input.ingredients || []).map(ing => ({
      ingredient_id: ing.ingredient_id,
      quantity: ing.quantity,
      unit: ing.unit,
      yield_pct: ing.yield_pct ?? null,
      wastage_pct: ing.wastage_pct ?? null,
      cost_override: ing.cost_override ?? null,
      notes: ing.notes || null,
    }));

    const { data: recipe, error } = await supabase.rpc('update_recipe_transaction', {
      p_recipe_id: id,
      p_recipe_data: recipeData,
      p_ingredients: ingredientsPayload,
    });

    if (error) {
      console.error('updateMenuRecipe transaction error:', error);
      throw new Error('Failed to update recipe');
    }

    return recipe;
  }

  static async deleteRecipe(id: string) {
    const supabase = await createClient();

    const { data: deletedRecipe, error } = await supabase
      .from('menu_recipes')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('deleteMenuRecipe error:', error);
      if (error.code === '23503') {
        throw new Error('Cannot delete: this recipe is still used by other records. Remove those references first.');
      }
      throw new Error('Failed to delete recipe');
    }
    if (!deletedRecipe) {
      throw new Error('Recipe not found');
    }
    return { success: true };
  }

  // Dishes --------------------------------------------------------------------------------------------------------
  static async listDishes(menuCode?: string) {
    const supabase = await createClient();
    const targetGpPct = await MenuSettingsService.getMenuTargetGp({ client: supabase });
    let query = supabase
      .from('menu_dishes_with_costs')
      .select('*')
      .order('menu_code', { ascending: true })
      .order('category_code', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (menuCode) {
      query = query.eq('menu_code', menuCode);
    }

    const { data, error } = await query;
    if (error) {
      console.error('listMenuDishes error:', error);
      throw new Error('Failed to fetch dishes');
    }

    const dishMap = new Map<string, any>();

    (data || []).forEach(row => {
      if (!dishMap.has(row.dish_id)) {
        dishMap.set(row.dish_id, {
          id: row.dish_id,
          name: row.name,
          description: row.description,
          selling_price: Number(row.selling_price ?? 0),
          portion_cost: Number(row.portion_cost ?? 0),
          gp_pct: row.gp_pct ?? null,
          target_gp_pct: targetGpPct,
          is_gp_alert: row.is_gp_alert ?? false,
          is_active: row.is_active ?? false,
          dietary_flags: row.dietary_flags || [],
          allergen_flags: row.allergen_flags || [],
          removable_allergens: row.removable_allergens || [],
          is_modifiable_for: row.is_modifiable_for || {},
          allergen_verified: row.allergen_verified ?? false,
          allergen_verified_at: row.allergen_verified_at ?? null,
          assignments: [],
          assignmentKeys: new Set<string>(),
        });
      }

      const dishEntry = dishMap.get(row.dish_id);
      const assignmentKey = `${row.menu_code || 'unknown'}-${row.category_code || 'unknown'}-${row.sort_order ?? 0}`;
      if (row.menu_code && !dishEntry.assignmentKeys.has(assignmentKey)) {
        dishEntry.assignments.push({
          menu_code: row.menu_code,
          menu_name: row.menu_name,
          category_code: row.category_code,
          category_name: row.category_name,
          sort_order: row.sort_order ?? 0,
          is_special: row.is_special ?? false,
          is_default_side: row.is_default_side ?? false,
          available_from: row.available_from,
          available_until: row.available_until,
        });
        dishEntry.assignmentKeys.add(assignmentKey);
      }
    });

    const dishes = Array.from(dishMap.values());
    const dishIds = dishes.map(dish => dish.id);

    let ingredientRows: any[] = [];
    if (dishIds.length > 0) {
      const { data: ingredientData, error: ingredientError } = await supabase
        .from('menu_dish_ingredients')
        .select(`
          dish_id,
          quantity,
          unit,
          yield_pct,
          wastage_pct,
          cost_override,
          notes,
          option_group,
          inclusion_type,
          upgrade_price,
          measure_ml,
          ingredient:menu_ingredients(
            id,
            name,
            default_unit,
            storage_type,
            allergens,
            dietary_flags,
            abv
          )
        `)
        .in('dish_id', dishIds);

      if (ingredientError) {
        console.error('listMenuDishes ingredients error:', ingredientError);
      } else {
        ingredientRows = ingredientData || [];
      }
    }

    const ingredientIds = Array.from(
      new Set(
        ingredientRows
          .map(row => row.ingredient?.id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const priceMap = new Map<string, any>();
    if (ingredientIds.length > 0) {
      const { data: pricingData, error: pricingError } = await supabase
        .from('menu_ingredients_with_prices')
        .select('id, latest_unit_cost, latest_pack_cost, pack_cost, default_unit')
        .in('id', ingredientIds);

      if (pricingError) {
        console.error('listMenuDishes ingredient pricing error:', pricingError);
      } else {
        (pricingData || []).forEach(entry => {
          priceMap.set(entry.id, entry);
        });
      }
    }

    let recipeRows: any[] = [];
    const recipeMetaMap = new Map<string, any>();
    if (dishIds.length > 0) {
      const { data: recipeData, error: recipeError } = await supabase
        .from('menu_dish_recipes')
        .select('dish_id, recipe_id, quantity, yield_pct, wastage_pct, cost_override, notes, option_group, inclusion_type, upgrade_price')
        .in('dish_id', dishIds);

      if (recipeError) {
        console.error('listMenuDishes recipes error:', recipeError);
      } else {
        recipeRows = recipeData || [];
      }

      const recipeIds = Array.from(
        new Set(recipeRows.map(row => row.recipe_id).filter((id): id is string => Boolean(id)))
      );

      if (recipeIds.length > 0) {
        const { data: recipeDetails, error: recipeDetailsError } = await supabase
          .from('menu_recipes')
          .select('id, name, portion_cost, yield_quantity, yield_unit, allergen_flags, dietary_flags, is_active')
          .in('id', recipeIds);

        if (recipeDetailsError) {
          console.error('listMenuDishes recipe metadata error:', recipeDetailsError);
        } else {
          (recipeDetails || []).forEach(recipe => {
            recipeMetaMap.set(recipe.id, recipe);
          });
        }
      }
    }

    const ingredientsByDish = new Map<string, any[]>();
    ingredientRows.forEach(row => {
      if (!row?.ingredient?.id) return;
      const pricing = priceMap.get(row.ingredient.id);
      const detail = {
        ingredient_id: row.ingredient.id,
        ingredient_name: row.ingredient.name,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit,
        yield_pct: row.yield_pct,
        wastage_pct: row.wastage_pct,
        cost_override: row.cost_override,
        notes: row.notes,
        latest_unit_cost: pricing?.latest_unit_cost != null ? Number(pricing.latest_unit_cost) : null,
        latest_pack_cost:
          pricing?.latest_pack_cost != null
            ? Number(pricing.latest_pack_cost)
            : pricing?.pack_cost != null
              ? Number(pricing.pack_cost)
              : null,
        default_unit: pricing?.default_unit ?? row.ingredient.default_unit ?? null,
        dietary_flags: row.ingredient.dietary_flags || [],
        allergens: row.ingredient.allergens || [],
        option_group: row.option_group ?? null,
        inclusion_type: row.inclusion_type ?? 'included',
        upgrade_price: row.upgrade_price ?? null,
        abv: row.ingredient.abv ?? null,
        measure_ml: row.measure_ml ?? null,
      };

      const existing = ingredientsByDish.get(row.dish_id) || [];
      existing.push(detail);
      ingredientsByDish.set(row.dish_id, existing);
    });

    const recipesByDish = new Map<string, any[]>();
    recipeRows.forEach(row => {
      if (!row?.recipe_id) return;
      const recipeMeta = recipeMetaMap.get(row.recipe_id);
      if (!recipeMeta) return;
      const detail = {
        recipe_id: row.recipe_id,
        recipe_name: recipeMeta.name,
        quantity: Number(row.quantity ?? 0),
        yield_pct: row.yield_pct,
        wastage_pct: row.wastage_pct,
        cost_override: row.cost_override,
        notes: row.notes,
        portion_cost: recipeMeta.portion_cost != null ? Number(recipeMeta.portion_cost) : null,
        yield_quantity: recipeMeta.yield_quantity != null ? Number(recipeMeta.yield_quantity) : null,
        yield_unit: recipeMeta.yield_unit ?? 'portion',
        dietary_flags: recipeMeta.dietary_flags || [],
        allergen_flags: recipeMeta.allergen_flags || [],
        recipe_is_active: recipeMeta.is_active ?? true,
        option_group: row.option_group ?? null,
        inclusion_type: row.inclusion_type ?? 'included',
        upgrade_price: row.upgrade_price ?? null,
      };

      const existing = recipesByDish.get(row.dish_id) || [];
      existing.push(detail);
      recipesByDish.set(row.dish_id, existing);
    });

    const result = dishes.map(dish => {
      const { assignmentKeys, assignments, ...base } = dish;
      const sortedAssignments = [...assignments].sort((a, b) => {
        if (a.menu_code === b.menu_code) {
          return a.sort_order - b.sort_order;
        }
        return a.menu_code.localeCompare(b.menu_code);
      });

      const dishIngredients = (ingredientsByDish.get(dish.id) || []).sort((a, b) =>
        a.ingredient_name.localeCompare(b.ingredient_name)
      );

      const dishRecipes = (recipesByDish.get(dish.id) || []).sort((a, b) =>
        a.recipe_name.localeCompare(b.recipe_name)
      );

      // cost_data_complete is false if any ingredient or recipe has no pricing data;
      // null costs are silently treated as 0 by arithmetic, which inflates GP% silently.
      const costDataComplete =
        dishIngredients.every(ing => ing.latest_unit_cost !== null) &&
        dishRecipes.every(rec => rec.portion_cost !== null);

      return {
        ...base,
        assignments: sortedAssignments,
        ingredients: dishIngredients,
        recipes: dishRecipes,
        target_gp_pct: targetGpPct,
        cost_data_complete: costDataComplete,
      };
    });

    return { data: result, target_gp_pct: targetGpPct };
  }

  static async getDishDetail(dishId: string) {
    const supabase = await createClient();
    const targetGpPct = await MenuSettingsService.getMenuTargetGp({ client: supabase });

    const [
      { data: dish, error: dishError },
      { data: ingredients, error: ingredientsError },
      { data: assignments, error: assignmentsError },
      { data: recipeLinks, error: recipesError },
    ] = await Promise.all([
      supabase.from('menu_dishes').select('*').eq('id', dishId).single(),
      supabase
        .from('menu_dish_ingredients')
        .select('id, ingredient_id, quantity, unit, yield_pct, wastage_pct, cost_override, notes, option_group, inclusion_type, upgrade_price, measure_ml, ingredient:menu_ingredients(name, default_unit)')
        .eq('dish_id', dishId),
      supabase
        .from('menu_dish_menu_assignments')
        .select('menu_id, category_id, sort_order, is_special, is_default_side, available_from, available_until, menu:menu_menus(code, name), category:menu_categories(code, name)')
        .eq('dish_id', dishId),
      supabase
        .from('menu_dish_recipes')
        .select('id, recipe_id, quantity, yield_pct, wastage_pct, cost_override, notes, option_group, inclusion_type, upgrade_price')
        .eq('dish_id', dishId),
    ]);

    if (dishError || ingredientsError || assignmentsError || recipesError) {
      throw new Error('Failed to fetch dish detail');
    }

    let recipes: any[] = [];
    if (Array.isArray(recipeLinks) && recipeLinks.length > 0) {
      const recipeIds = Array.from(
        new Set(
          recipeLinks
            .map(row => row.recipe_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      let recipeMetaMap = new Map<string, any>();
      if (recipeIds.length > 0) {
        const { data: meta, error: recipeMetaError } = await supabase
          .from('menu_recipes')
          .select('id, name, portion_cost, yield_quantity, yield_unit')
          .in('id', recipeIds);

        if (recipeMetaError) {
          console.error('getMenuDishDetail recipe meta error:', recipeMetaError);
        } else {
          recipeMetaMap = new Map((meta || []).map(entry => [entry.id, entry]));
        }
      }

      recipes = recipeLinks.map(link => ({
        ...link,
        recipe: recipeMetaMap.get(link.recipe_id) || null,
      }));
    }

    return {
      dish: dish ? { ...dish, target_gp_pct: targetGpPct } : dish,
      ingredients: ingredients || [],
      recipes: recipes || [],
      assignments: assignments || [],
    };
  }

  static async updateDish(id: string, input: UpdateDishInput) {
    const adminClient = createAdminClient();
    // DEFECT-015 fix: DishSchema.parse removed here — action layer pre-validates.
    // DEFECT-001 fix: replaced 9 sequential writes with a single atomic RPC call.
    // On any mid-step failure the implicit savepoint rolls back all changes,
    // leaving the dish in its original pre-edit state.
    const targetGpPct = await MenuSettingsService.getMenuTargetGp({ client: adminClient });
    const { menuMap, categoryMap } = await this.getMenuAndCategoryIds(input.assignments ?? [], adminClient);

    const dishData = {
      name: input.name,
      description: input.description || null,
      selling_price: input.selling_price,
      target_gp_pct: targetGpPct,
      calories: input.calories ?? null,
      is_active: input.is_active,
      is_sunday_lunch: input.is_sunday_lunch,
      image_url: input.image_url || null,
      notes: input.notes || null,
    };

    const ingredientsPayload = (input.ingredients || []).map(ing => ({
      ingredient_id: ing.ingredient_id,
      quantity: ing.quantity,
      unit: ing.unit,
      yield_pct: ing.yield_pct ?? null,
      wastage_pct: ing.wastage_pct ?? null,
      cost_override: ing.cost_override ?? null,
      notes: ing.notes || null,
      option_group: ing.option_group ?? null,
      inclusion_type: ing.inclusion_type ?? 'included',
      upgrade_price: ing.upgrade_price ?? null,
      measure_ml: ing.measure_ml ?? null,
    }));

    const recipesPayload = (input.recipes || []).map(recipe => ({
      recipe_id: recipe.recipe_id,
      quantity: recipe.quantity,
      yield_pct: recipe.yield_pct ?? null,
      wastage_pct: recipe.wastage_pct ?? null,
      cost_override: recipe.cost_override ?? null,
      notes: recipe.notes || null,
      option_group: recipe.option_group ?? null,
      inclusion_type: recipe.inclusion_type ?? 'included',
      upgrade_price: recipe.upgrade_price ?? null,
    }));

    const assignmentsPayload = (input.assignments ?? []).map(assign => ({
      menu_id: menuMap.get(assign.menu_code)!,
      category_id: categoryMap.get(assign.category_code)!,
      sort_order: assign.sort_order,
      is_special: assign.is_special,
      is_default_side: assign.is_default_side,
      available_from: assign.available_from ? new Date(assign.available_from).toISOString().slice(0, 10) : null,
      available_until: assign.available_until ? new Date(assign.available_until).toISOString().slice(0, 10) : null,
    }));

    const { data: dish, error } = await adminClient.rpc('update_dish_transaction', {
      p_dish_id: id,
      p_dish_data: dishData,
      p_ingredients: ingredientsPayload,
      p_recipes: recipesPayload,
      p_assignments: assignmentsPayload,
    });

    if (error) {
      console.error('updateMenuDish transaction error:', error);
      throw new Error(error.message || 'Failed to update dish');
    }

    return dish;
  }

  static async deleteDish(id: string) {
    const supabase = await createClient();

    const { data: deletedDish, error } = await supabase
      .from('menu_dishes')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('deleteMenuDish error:', error);
      if (error.code === '23503') {
        throw new Error('Cannot delete: this dish is still used by other records. Remove those references first.');
      }
      throw new Error('Failed to delete dish');
    }
    if (!deletedDish) {
      throw new Error('Dish not found');
    }

    return { success: true };
  }

  static async listMenusWithCategories() {
    const supabase = await createClient();

    const { data: menus, error } = await supabase
      .from('menu_menus')
      .select(
        `
          id,
          code,
          name,
          is_active,
          categories:menu_category_menus(
            sort_order,
            category:menu_categories(
              id,
              code,
              name,
              description,
              is_active
            )
          )
        `
      )
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('listMenusWithCategories error:', error);
      throw new Error('Failed to fetch menus');
    }

    const mapped = (menus || []).map((menu: any) => ({
      id: menu.id,
      code: menu.code,
      name: menu.name,
      categories: ((menu.categories ?? []) as Array<any>)
        .filter((entry: any) => entry?.category?.is_active !== false)
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((entry: any) => ({
          id: entry.category.id,
          code: entry.category.code,
          name: entry.category.name,
          description: entry.category.description,
        })),
    }));

        return { data: mapped };

      }

    

      static async createRecipe(input: CreateRecipeInput) {

        const supabase = await createClient();

    

        const recipeData = {

          name: input.name,

          description: input.description,

          instructions: input.instructions,

          yield_quantity: input.yield_quantity,

          yield_unit: input.yield_unit,

          notes: input.notes,

          is_active: input.is_active

        };

    

        const { data: recipe, error } = await supabase.rpc('create_recipe_transaction', {

          p_recipe_data: recipeData,

          p_ingredients: input.ingredients

        });

    

        if (error) {

          console.error('Create recipe transaction error:', error);

          throw new Error('Failed to create recipe');

        }

    

        return recipe;

      }

    

      static async createDish(input: CreateDishInput) {

        const supabase = await createClient();

        const adminClient = createAdminClient();

    

        // Get target GP%

        const targetGpPct = await MenuSettingsService.getMenuTargetGp({ client: supabase });

    

        // Resolve Menu and Category Codes to IDs

        const { menuMap, categoryMap } = await this.getMenuAndCategoryIds(input.assignments, adminClient);

    

        const assignmentsPayload = input.assignments.map(assign => ({

          menu_id: menuMap.get(assign.menu_code),

          category_id: categoryMap.get(assign.category_code),

          sort_order: assign.sort_order,

          is_special: assign.is_special,

          is_default_side: assign.is_default_side,

          available_from: assign.available_from,

          available_until: assign.available_until

        }));

    

        const dishData = {

          name: input.name,

          description: input.description,

          selling_price: input.selling_price,

          target_gp_pct: targetGpPct,

          calories: input.calories,

          is_active: input.is_active,

          is_sunday_lunch: input.is_sunday_lunch,

          image_url: input.image_url,

          notes: input.notes

        };

    

        const { data: dish, error } = await supabase.rpc('create_dish_transaction', {

          p_dish_data: dishData,

          p_ingredients: input.ingredients,

          p_recipes: input.recipes,

          p_assignments: assignmentsPayload

        });

    

        if (error) {

          console.error('Create dish transaction error:', error);

          throw new Error('Failed to create dish');

        }

    

        return dish;

      }

  // Field-level updates --------------------------------------------------------------------------------------------

  /**
   * Update only the pack_cost of an ingredient and record price history.
   * Bypasses the replace-all transaction RPC — safe for inline editing.
   */
  static async updateIngredientPackCost(id: string, packCost: number): Promise<{ previousValue: number }> {
    const supabase = createAdminClient();

    const { data: previousValue, error } = await supabase.rpc('menu_update_ingredient_pack_cost', {
      p_ingredient_id: id,
      p_pack_cost: packCost,
    });

    if (error) {
      console.error('updateIngredientPackCost error:', error);
      throw new Error(error.message === 'Ingredient not found' ? 'Ingredient not found' : 'Failed to update ingredient pack cost');
    }

    return { previousValue: Number(previousValue) };
  }

  /**
   * Toggle the is_active flag on an ingredient.
   * Bypasses the replace-all transaction RPC — safe for inline editing.
   */
  static async toggleIngredientActive(id: string): Promise<{ previousValue: boolean; newValue: boolean }> {
    const supabase = createAdminClient();

    const { data: existing, error: fetchError } = await supabase
      .from('menu_ingredients')
      .select('is_active')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      throw new Error('Ingredient not found');
    }

    const previousValue = existing.is_active;
    const newValue = !previousValue;

    const { error: updateError } = await supabase
      .from('menu_ingredients')
      .update({ is_active: newValue })
      .eq('id', id);

    if (updateError) {
      console.error('toggleIngredientActive error:', updateError);
      throw new Error('Failed to toggle ingredient active status');
    }

    return { previousValue, newValue };
  }

  /**
   * Toggle one dietary flag on an ingredient.
   * Bypasses the full ingredient update so inline table edits cannot overwrite other fields.
   */
  static async toggleIngredientDietaryFlag(
    id: string,
    flag: string
  ): Promise<{ previousValue: boolean; newValue: boolean; dietaryFlags: string[] }> {
    const supabase = createAdminClient();

    const { data: existing, error: fetchError } = await supabase
      .from('menu_ingredients')
      .select('dietary_flags')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      throw new Error('Ingredient not found');
    }

    const currentFlags = Array.isArray(existing.dietary_flags)
      ? existing.dietary_flags
          .map((value) => (value ?? '').toString().trim().toLowerCase())
          .filter(Boolean)
      : [];
    const previousValue = currentFlags.includes(flag);
    const nextFlags = previousValue
      ? currentFlags.filter((value) => value !== flag)
      : [...currentFlags, flag];
    const dietaryFlags = orderUniqueValues(nextFlags, INGREDIENT_DIETARY_FLAG_ORDER);

    const { error: updateError } = await supabase
      .from('menu_ingredients')
      .update({ dietary_flags: dietaryFlags })
      .eq('id', id);

    if (updateError) {
      console.error('toggleIngredientDietaryFlag error:', updateError);
      throw new Error('Failed to update ingredient dietary flag');
    }

    return { previousValue, newValue: !previousValue, dietaryFlags };
  }

  /**
   * Update only the selling_price of a dish and recalculate GP%.
   * Bypasses the replace-all transaction RPC — safe for inline editing.
   */
  static async updateDishPrice(id: string, sellingPrice: number): Promise<{ previousValue: number }> {
    const supabase = createAdminClient();

    const { data: existing, error: fetchError } = await supabase
      .from('menu_dishes')
      .select('selling_price')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      throw new Error('Dish not found');
    }

    const previousValue = Number(existing.selling_price);

    const { error: updateError } = await supabase
      .from('menu_dishes')
      .update({ selling_price: sellingPrice })
      .eq('id', id);

    if (updateError) {
      console.error('updateDishPrice error:', updateError);
      throw new Error('Failed to update dish selling price');
    }

    // Recalculate GP% via the database function
    const { error: rpcError } = await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: id });

    if (rpcError) {
      console.error('updateDishPrice recalculation error:', rpcError);
      // Price is updated but GP% may be stale — not fatal
    }

    return { previousValue };
  }

  /**
   * Toggle the is_active flag on a dish.
   * Bypasses the replace-all transaction RPC — safe for inline editing.
   */
  static async toggleDishActive(id: string): Promise<{ previousValue: boolean; newValue: boolean }> {
    const supabase = createAdminClient();

    const { data: existing, error: fetchError } = await supabase
      .from('menu_dishes')
      .select('is_active')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      throw new Error('Dish not found');
    }

    const previousValue = existing.is_active;
    const newValue = !previousValue;

    const { error: updateError } = await supabase
      .from('menu_dishes')
      .update({ is_active: newValue })
      .eq('id', id);

    if (updateError) {
      console.error('toggleDishActive error:', updateError);
      throw new Error('Failed to toggle dish active status');
    }

    return { previousValue, newValue };
  }

    }
