'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from '@/app/actions/audit';
import { getMenuTargetGp } from '@/app/actions/menu-settings';
import { z } from 'zod';

const UNITS = [
  'each',
  'portion',
  'gram',
  'kilogram',
  'millilitre',
  'litre',
  'ounce',
  'pound',
  'teaspoon',
  'tablespoon',
  'cup',
  'slice',
  'piece',
] as const;

const STORAGE_TYPES = ['ambient', 'chilled', 'frozen', 'dry', 'other'] as const;

const IngredientSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  default_unit: z.enum(UNITS).default('each'),
  storage_type: z.enum(STORAGE_TYPES).default('ambient'),
  supplier_name: z.string().optional(),
  supplier_sku: z.string().optional(),
  brand: z.string().optional(),
  pack_size: z.number().nonnegative().nullable().optional(),
  pack_size_unit: z.enum(UNITS).optional().nullable(),
  pack_cost: z.number().nonnegative().default(0),
  portions_per_pack: z.number().nonnegative().nullable().optional(),
  wastage_pct: z.number().min(0).max(100).default(0),
  shelf_life_days: z.number().int().nullable().optional(),
  allergens: z.array(z.string()).default([]),
  dietary_flags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  is_active: z.boolean().default(true),
});

const IngredientPriceSchema = z.object({
  ingredient_id: z.string().uuid(),
  pack_cost: z.number().positive(),
  effective_from: z.coerce.date().optional(),
  supplier_name: z.string().optional(),
  supplier_sku: z.string().optional(),
  notes: z.string().optional(),
});

const DishIngredientSchema = z.object({
  ingredient_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.enum(UNITS),
  yield_pct: z.number().min(0).max(100).default(100),
  wastage_pct: z.number().min(0).max(100).default(0),
  cost_override: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const DishAssignmentSchema = z.object({
  menu_code: z.string().min(1),
  category_code: z.string().min(1),
  sort_order: z.number().int().default(0),
  is_special: z.boolean().default(false),
  is_default_side: z.boolean().default(false),
  available_from: z.coerce.date().nullable().optional(),
  available_until: z.coerce.date().nullable().optional(),
});

const DishSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  selling_price: z.number().nonnegative(),
  calories: z.number().int().optional().nullable(),
  is_active: z.boolean().default(true),
  is_sunday_lunch: z.boolean().default(false),
  image_url: z.string().optional(),
  notes: z.string().nullable().optional(),
  ingredients: z.array(DishIngredientSchema).default([]),
  assignments: z.array(DishAssignmentSchema).min(1),
});

type IngredientInput = z.infer<typeof IngredientSchema>;
type IngredientPriceInput = z.infer<typeof IngredientPriceSchema>;
type DishInput = z.infer<typeof DishSchema>;

export async function listMenuIngredients() {
  try {
    const supabase = await createClient();
    const targetGpPct = await getMenuTargetGp({ client: supabase });

    const { data, error } = await supabase
      .from('menu_ingredients_with_prices')
      .select('id, name, description, default_unit, storage_type, supplier_name, supplier_sku, brand, pack_size, pack_size_unit, pack_cost, portions_per_pack, wastage_pct, shelf_life_days, allergens, dietary_flags, notes, is_active, latest_pack_cost, latest_unit_cost')
      .order('name', { ascending: true });

    if (error) {
      console.error('listMenuIngredients error:', error);
      return { error: 'Failed to fetch ingredients' };
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
      dishes: (usageByIngredient.get(ingredient.id) || []).sort((a, b) =>
        a.dish_name.localeCompare(b.dish_name)
      ),
    }));

    return { data: result };
  } catch (error) {
    console.error('listMenuIngredients unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function getMenuIngredientPrices(ingredientId: string) {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('menu_ingredient_prices')
      .select('id, pack_cost, effective_from, supplier_name, supplier_sku, notes, created_at')
      .eq('ingredient_id', ingredientId)
      .order('effective_from', { ascending: false });

    if (error) {
      console.error('getMenuIngredientPrices error:', error);
      return { error: 'Failed to fetch price history' };
    }

    return { data: data || [] };
  } catch (error) {
    console.error('getMenuIngredientPrices unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function createMenuIngredient(input: IngredientInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const payload = IngredientSchema.parse(input);
    const supabase = await createClient();

    const { data: ingredient, error } = await supabase
      .from('menu_ingredients')
      .insert({
        name: payload.name,
        description: payload.description || null,
        default_unit: payload.default_unit,
        storage_type: payload.storage_type,
        supplier_name: payload.supplier_name || null,
        supplier_sku: payload.supplier_sku || null,
        brand: payload.brand || null,
        pack_size: payload.pack_size ?? null,
        pack_size_unit: payload.pack_size_unit ?? null,
        pack_cost: payload.pack_cost,
        portions_per_pack: payload.portions_per_pack ?? null,
        wastage_pct: payload.wastage_pct,
        shelf_life_days: payload.shelf_life_days ?? null,
        allergens: payload.allergens,
        dietary_flags: payload.dietary_flags,
        notes: payload.notes || null,
        is_active: payload.is_active,
      })
      .select()
      .single();

    if (error) {
      console.error('createMenuIngredient error:', error);
      return { error: 'Failed to create ingredient' };
    }

    if (payload.pack_cost > 0) {
      await supabase.from('menu_ingredient_prices').insert({
        ingredient_id: ingredient.id,
        pack_cost: payload.pack_cost,
        supplier_name: payload.supplier_name || null,
        supplier_sku: payload.supplier_sku || null,
      });
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'menu_ingredient',
      resource_id: ingredient.id,
      operation_status: 'success',
      additional_info: {
        name: ingredient.name,
        pack_cost: payload.pack_cost,
      },
    });

    return { success: true, data: ingredient };
  } catch (error) {
    console.error('createMenuIngredient unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function updateMenuIngredient(id: string, input: IngredientInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const payload = IngredientSchema.parse(input);
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('menu_ingredients')
      .select('id, pack_cost')
      .eq('id', id)
      .single();

    if (!existing) {
      return { error: 'Ingredient not found' };
    }

    const { data: ingredient, error } = await supabase
      .from('menu_ingredients')
      .update({
        name: payload.name,
        description: payload.description || null,
        default_unit: payload.default_unit,
        storage_type: payload.storage_type,
        supplier_name: payload.supplier_name || null,
        supplier_sku: payload.supplier_sku || null,
        brand: payload.brand || null,
        pack_size: payload.pack_size ?? null,
        pack_size_unit: payload.pack_size_unit ?? null,
        pack_cost: payload.pack_cost,
        portions_per_pack: payload.portions_per_pack ?? null,
        wastage_pct: payload.wastage_pct,
        shelf_life_days: payload.shelf_life_days ?? null,
        allergens: payload.allergens,
        dietary_flags: payload.dietary_flags,
        notes: payload.notes || null,
        is_active: payload.is_active,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('updateMenuIngredient error:', error);
      return { error: 'Failed to update ingredient' };
    }

    if (payload.pack_cost !== existing.pack_cost) {
      await supabase.from('menu_ingredient_prices').insert({
        ingredient_id: id,
        pack_cost: payload.pack_cost,
        supplier_name: payload.supplier_name || null,
        supplier_sku: payload.supplier_sku || null,
      });
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_ingredient',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        name: ingredient.name,
        updates: payload,
      },
    });

    return { success: true, data: ingredient };
  } catch (error) {
    console.error('updateMenuIngredient unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function recordMenuIngredientPrice(input: IngredientPriceInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const payload = IngredientPriceSchema.parse(input);
    const supabase = await createClient();

    const { error } = await supabase.from('menu_ingredient_prices').insert({
      ingredient_id: payload.ingredient_id,
      pack_cost: payload.pack_cost,
      effective_from: payload.effective_from ?? new Date().toISOString(),
      supplier_name: payload.supplier_name || null,
      supplier_sku: payload.supplier_sku || null,
      notes: payload.notes || null,
    });

    if (error) {
      console.error('recordMenuIngredientPrice error:', error);
      return { error: 'Failed to record price change' };
    }

    return { success: true };
  } catch (error) {
    console.error('recordMenuIngredientPrice unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function deleteMenuIngredient(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const supabase = await createClient();

    const { error } = await supabase.from('menu_ingredients').delete().eq('id', id);
    if (error) {
      console.error('deleteMenuIngredient error:', error);
      return { error: 'Failed to delete ingredient' };
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'menu_ingredient',
      resource_id: id,
      operation_status: 'success',
    });

    return { success: true };
  } catch (error) {
    console.error('deleteMenuIngredient unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

async function getMenuAndCategoryIds(
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

export async function listMenuDishes(menuCode?: string) {
  try {
    const supabase = await createClient();
    const targetGpPct = await getMenuTargetGp({ client: supabase });
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
      return { error: 'Failed to fetch dishes' };
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
          assignments: [],
          assignmentKeys: new Set<string>(),
        });
      }

      const dishEntry = dishMap.get(row.dish_id);
      const assignmentKey = `${row.menu_code || 'unknown'}-${row.category_code || 'unknown'}-${row.sort_order ?? 0}`;
      if (row.menu_code && !dishEntry.assignmentKeys.has(assignmentKey)) {
        dishEntry.assignments.push({
          menu_code: row.menu_code,
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
          ingredient:menu_ingredients(
            id,
            name,
            default_unit,
            storage_type,
            allergens,
            dietary_flags
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
        latest_unit_cost: pricing?.latest_unit_cost ?? null,
        latest_pack_cost: pricing?.latest_pack_cost ?? pricing?.pack_cost ?? null,
        default_unit: pricing?.default_unit ?? row.ingredient.default_unit ?? null,
        dietary_flags: row.ingredient.dietary_flags || [],
        allergens: row.ingredient.allergens || [],
      };

      const existing = ingredientsByDish.get(row.dish_id) || [];
      existing.push(detail);
      ingredientsByDish.set(row.dish_id, existing);
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

      return {
        ...base,
        assignments: sortedAssignments,
        ingredients: dishIngredients,
        target_gp_pct: targetGpPct,
      };
    });

    return { data: result, target_gp_pct: targetGpPct };
  } catch (error) {
    console.error('listMenuDishes unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function getMenuDishDetail(dishId: string) {
  try {
    const supabase = await createClient();
    const targetGpPct = await getMenuTargetGp({ client: supabase });

    const [{ data: dish, error: dishError }, { data: ingredients, error: ingredientsError }, { data: assignments, error: assignmentsError }] =
      await Promise.all([
        supabase.from('menu_dishes').select('*').eq('id', dishId).single(),
        supabase
          .from('menu_dish_ingredients')
          .select('id, ingredient_id, quantity, unit, yield_pct, wastage_pct, cost_override, notes, ingredient:menu_ingredients(name, default_unit)')
          .eq('dish_id', dishId),
        supabase
          .from('menu_dish_menu_assignments')
          .select('menu_id, category_id, sort_order, is_special, is_default_side, available_from, available_until, menu:menu_menus(code, name), category:menu_categories(code, name)')
          .eq('dish_id', dishId),
      ]);

    if (dishError || ingredientsError || assignmentsError) {
      return { error: 'Failed to fetch dish detail' };
    }

    return {
      data: {
        dish: dish ? { ...dish, target_gp_pct: targetGpPct } : dish,
        ingredients: ingredients || [],
        assignments: assignments || [],
      },
    };
  } catch (error) {
    console.error('getMenuDishDetail unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function createMenuDish(input: DishInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu dishes' };
    }

    const supabase = await createClient();
    const payload = DishSchema.parse(input);
    const targetGpPct = await getMenuTargetGp({ client: supabase });

    const { menuMap, categoryMap } = await getMenuAndCategoryIds(payload.assignments);

    const { data: dish, error: dishError } = await supabase
      .from('menu_dishes')
      .insert({
        name: payload.name,
        description: payload.description || null,
        selling_price: payload.selling_price,
        target_gp_pct: targetGpPct,
        calories: payload.calories ?? null,
        is_active: payload.is_active,
        is_sunday_lunch: payload.is_sunday_lunch,
        image_url: payload.image_url || null,
        notes: payload.notes || null,
      })
      .select()
      .single();

    if (dishError || !dish) {
      console.error('createMenuDish dish insert error:', dishError);
      return { error: 'Failed to create dish' };
    }

    if (payload.ingredients.length > 0) {
      const { error: ingredientsError } = await supabase.from('menu_dish_ingredients').insert(
        payload.ingredients.map(ing => ({
          dish_id: dish.id,
          ingredient_id: ing.ingredient_id,
          quantity: ing.quantity,
          unit: ing.unit,
          yield_pct: ing.yield_pct,
          wastage_pct: ing.wastage_pct,
          cost_override: ing.cost_override ?? null,
          notes: ing.notes || null,
        }))
      );

      if (ingredientsError) {
        console.error('createMenuDish ingredients error:', ingredientsError);
        await supabase.from('menu_dishes').delete().eq('id', dish.id);
        return { error: 'Failed to add dish ingredients' };
      }
    }

    const assignmentsPayload = payload.assignments.map(assign => ({
      dish_id: dish.id,
      menu_id: menuMap.get(assign.menu_code)!,
      category_id: categoryMap.get(assign.category_code)!,
      sort_order: assign.sort_order,
      is_special: assign.is_special,
      is_default_side: assign.is_default_side,
      available_from: assign.available_from ? assign.available_from.toISOString().slice(0, 10) : null,
      available_until: assign.available_until ? assign.available_until.toISOString().slice(0, 10) : null,
    }));

    const { error: assignmentsError } = await supabase
      .from('menu_dish_menu_assignments')
      .insert(assignmentsPayload);

    if (assignmentsError) {
      console.error('createMenuDish assignments error:', assignmentsError);
      await supabase.from('menu_dishes').delete().eq('id', dish.id);
      return { error: 'Failed to assign dish to menus' };
    }

    await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: dish.id });

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'menu_dish',
      resource_id: dish.id,
      operation_status: 'success',
      additional_info: {
        name: dish.name,
        selling_price: dish.selling_price,
      },
    });

    return { success: true, data: dish };
  } catch (error) {
    console.error('createMenuDish unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function updateMenuDish(id: string, input: DishInput) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu dishes' };
    }

    const supabase = await createClient();
    const payload = DishSchema.parse(input);
    const targetGpPct = await getMenuTargetGp({ client: supabase });
    const { menuMap, categoryMap } = await getMenuAndCategoryIds(payload.assignments);

    const { data: dish, error: dishError } = await supabase
      .from('menu_dishes')
      .update({
        name: payload.name,
        description: payload.description || null,
        selling_price: payload.selling_price,
        target_gp_pct: targetGpPct,
        calories: payload.calories ?? null,
        is_active: payload.is_active,
        is_sunday_lunch: payload.is_sunday_lunch,
        image_url: payload.image_url || null,
        notes: payload.notes || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (dishError || !dish) {
      console.error('updateMenuDish dish error:', dishError);
      return { error: 'Failed to update dish' };
    }

    const { error: deleteIngredientsError } = await supabase
      .from('menu_dish_ingredients')
      .delete()
      .eq('dish_id', id);

    if (deleteIngredientsError) {
      console.error('updateMenuDish delete ingredients error:', deleteIngredientsError);
      return { error: 'Failed to update dish ingredients' };
    }

    if (payload.ingredients.length > 0) {
      const { error: insertIngredientsError } = await supabase.from('menu_dish_ingredients').insert(
        payload.ingredients.map(ing => ({
          dish_id: id,
          ingredient_id: ing.ingredient_id,
          quantity: ing.quantity,
          unit: ing.unit,
          yield_pct: ing.yield_pct,
          wastage_pct: ing.wastage_pct,
          cost_override: ing.cost_override ?? null,
          notes: ing.notes || null,
        }))
      );

      if (insertIngredientsError) {
        console.error('updateMenuDish insert ingredients error:', insertIngredientsError);
        return { error: 'Failed to update dish ingredients' };
      }
    }

    const { error: deleteAssignmentsError } = await supabase
      .from('menu_dish_menu_assignments')
      .delete()
      .eq('dish_id', id);

    if (deleteAssignmentsError) {
      console.error('updateMenuDish delete assignments error:', deleteAssignmentsError);
      return { error: 'Failed to update dish assignments' };
    }

    const assignmentsPayload = payload.assignments.map(assign => ({
      dish_id: id,
      menu_id: menuMap.get(assign.menu_code)!,
      category_id: categoryMap.get(assign.category_code)!,
      sort_order: assign.sort_order,
      is_special: assign.is_special,
      is_default_side: assign.is_default_side,
      available_from: assign.available_from ? assign.available_from.toISOString().slice(0, 10) : null,
      available_until: assign.available_until ? assign.available_until.toISOString().slice(0, 10) : null,
    }));

    const { error: assignmentsError } = await supabase
      .from('menu_dish_menu_assignments')
      .insert(assignmentsPayload);

    if (assignmentsError) {
      console.error('updateMenuDish assignments error:', assignmentsError);
      return { error: 'Failed to update dish assignments' };
    }

    await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: id });

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_dish',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        name: dish.name,
        selling_price: dish.selling_price,
      },
    });

    return { success: true, data: dish };
  } catch (error) {
    console.error('updateMenuDish unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function deleteMenuDish(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu dishes' };
    }

    const supabase = await createClient();

    const { error } = await supabase.from('menu_dishes').delete().eq('id', id);
    if (error) {
      console.error('deleteMenuDish error:', error);
      return { error: 'Failed to delete dish' };
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'menu_dish',
      resource_id: id,
      operation_status: 'success',
    });

    return { success: true };
  } catch (error) {
    console.error('deleteMenuDish unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function listMenusWithCategories() {
  try {
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
      return { error: 'Failed to fetch menus' };
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
  } catch (error) {
    console.error('listMenusWithCategories unexpected error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
