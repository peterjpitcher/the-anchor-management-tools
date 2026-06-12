/**
 * Adds the kids mains to a separate Kids Menu.
 *
 * Safe to re-run: looks up dishes by slug, replaces their ingredient links,
 * ensures the menu assignment exists, then refreshes GP/allergen calculations.
 *
 * Run with:
 *   npx tsx scripts/database/add-kids-menu.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const KIDS_MENU_CODE = 'kids';
const MAIN_MENU_CODE = 'website_food';
const KIDS_CATEGORY_CODE = 'kids';

type IngredientLine = {
  name: string;
  quantity: number;
  unit: 'each' | 'portion' | 'slice';
  inclusion_type?: 'included' | 'removable' | 'choice' | 'upgrade';
};

type KidsDish = {
  name: string;
  slug: string;
  previousSlugs?: string[];
  description: string;
  selling_price: number;
  dietary_flags: string[];
  sort_order: number;
  ingredients: IngredientLine[];
};

const kidsDishes: KidsDish[] = [
  {
    name: 'Kids Chicken Goujons & Chips',
    slug: 'kids-chicken-goujons-and-chips',
    description: 'Three chicken goujons served with chips and garden peas.',
    selling_price: 7,
    dietary_flags: [],
    sort_order: 10,
    ingredients: [
      { name: 'Chicken Breast Goujons', quantity: 3, unit: 'each' },
      { name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg", quantity: 0.5, unit: 'portion' },
      { name: "Chef's Larder Garden Peas 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
  {
    name: 'Kids Fish Fingers & Chips',
    slug: 'kids-fish-fingers-and-chips',
    description: 'Three fish fingers served with chips and garden peas.',
    selling_price: 7,
    dietary_flags: [],
    sort_order: 20,
    ingredients: [
      { name: "Chef's Essentials 60 White Fillet Fish Fingers 1.5kg", quantity: 3, unit: 'each' },
      { name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg", quantity: 0.5, unit: 'portion' },
      { name: "Chef's Larder Garden Peas 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
  {
    name: 'Kids Sausage, Mash & Gravy',
    slug: 'kids-sausage-mash-and-gravy',
    description: 'Pork sausage with buttery mash, gravy and garden peas.',
    selling_price: 7,
    dietary_flags: [],
    sort_order: 30,
    ingredients: [
      { name: 'Blakemans Cooked Pork Jumbo Sausage 2kg', quantity: 1, unit: 'each' },
      { name: "Chef's Larder Buttery Mash Potato 2kg", quantity: 0.5, unit: 'portion' },
      { name: 'Bisto Gluten Free Fine Gravy Granules 1.8kg', quantity: 0.5, unit: 'portion' },
      { name: "Chef's Larder Garden Peas 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
  {
    name: 'Kids Cheeseburger & Chips',
    slug: 'kids-cheeseburger-and-chips',
    description: 'Regular beef burger patty in a floured bap with cheddar and chips.',
    selling_price: 8,
    dietary_flags: [],
    sort_order: 40,
    ingredients: [
      { name: "Chef's Essentials Quarter Pounder Burgers 4.52kg", quantity: 1, unit: 'each' },
      { name: "Chef's Larder 48 Floured Baps", quantity: 1, unit: 'each' },
      { name: 'Creamfields Mild Cheddar Slices 200g', quantity: 1, unit: 'slice' },
      { name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
  {
    name: 'Kids Mac & Cheese',
    slug: 'kids-mac-and-cheese',
    description: 'Macaroni cheese.',
    selling_price: 8,
    dietary_flags: ['vegetarian'],
    sort_order: 50,
    ingredients: [
      { name: 'Brakes Essentials Macaroni Cheese', quantity: 1, unit: 'each' },
    ],
  },
  {
    name: 'Kids Chicken Burger & Chips',
    slug: 'kids-chicken-burger-and-chips',
    description: 'Chicken fillet in a floured bap, served with a half portion of chips.',
    selling_price: 8,
    dietary_flags: ['halal'],
    sort_order: 60,
    ingredients: [
      { name: "Chef's Larder 24 American Style Chicken Fillets", quantity: 1, unit: 'each' },
      { name: "Chef's Larder 48 Floured Baps", quantity: 1, unit: 'each' },
      { name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
  {
    name: 'Kids Veg Burger & Chips',
    slug: 'kids-veg-burger-and-chips',
    previousSlugs: ['kids-veg-cheeseburger-and-chips'],
    description: 'Bangkok vegetable burger in a floured bap, served with a half portion of chips.',
    selling_price: 8,
    dietary_flags: ['vegetarian'],
    sort_order: 70,
    ingredients: [
      { name: 'The Fat Chef Bangkok Bad Boy Burger', quantity: 1, unit: 'each' },
      { name: "Chef's Larder 48 Floured Baps", quantity: 1, unit: 'each' },
      { name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
  {
    name: 'Kids Fish Finger Wrap & Chips',
    slug: 'kids-fish-finger-wrap-and-chips',
    description: 'Three fish fingers in a tortilla wrap, served with a half portion of chips.',
    selling_price: 7,
    dietary_flags: [],
    sort_order: 80,
    ingredients: [
      { name: "Chef's Essentials 60 White Fillet Fish Fingers 1.5kg", quantity: 3, unit: 'each' },
      { name: 'H.W. Nevills Plain White Tortilla Wraps 8 Pack', quantity: 1, unit: 'each' },
      { name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
  {
    name: 'Kids Chicken Goujon Wrap & Chips',
    slug: 'kids-chicken-goujon-wrap-and-chips',
    description: 'Three chicken goujons in a tortilla wrap, served with a half portion of chips.',
    selling_price: 7,
    dietary_flags: [],
    sort_order: 90,
    ingredients: [
      { name: 'Chicken Breast Goujons', quantity: 3, unit: 'each' },
      { name: 'H.W. Nevills Plain White Tortilla Wraps 8 Pack', quantity: 1, unit: 'each' },
      { name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg", quantity: 0.5, unit: 'portion' },
    ],
  },
];

const retiredDishSlugs = ['kids-veg-cannelloni'];

async function requireSingle<T>(label: string, query: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error || !data) {
    throw new Error(`${label} not found${error ? `: ${error.message}` : ''}`);
  }
  return data;
}

async function ensureKidsMenu() {
  const { data, error } = await supabase
    .from('menu_menus')
    .upsert(
      {
        code: KIDS_MENU_CODE,
        name: 'Kids Menu',
        description: 'Separate children food menu',
        is_active: true,
      },
      { onConflict: 'code' }
    )
    .select('id, code, name')
    .single();

  if (error || !data) {
    throw new Error(`Kids menu setup failed${error ? `: ${error.message}` : ''}`);
  }

  return data;
}

async function main() {
  const menu = await ensureKidsMenu();
  const mainMenu = await requireSingle(
    'Main menu cleanup target',
    supabase.from('menu_menus').select('id, code, name').eq('code', MAIN_MENU_CODE).single()
  );
  const category = await requireSingle(
    'Kids category',
    supabase.from('menu_categories').select('id, code, name, sort_order').eq('code', KIDS_CATEGORY_CODE).single()
  );

  const ingredientNames = Array.from(new Set(kidsDishes.flatMap(dish => dish.ingredients.map(line => line.name))));
  const { data: ingredients, error: ingredientsError } = await supabase
    .from('menu_ingredients')
    .select('id, name')
    .in('name', ingredientNames);

  if (ingredientsError) {
    throw new Error(`Ingredient lookup failed: ${ingredientsError.message}`);
  }

  const ingredientByName = new Map((ingredients ?? []).map(ingredient => [ingredient.name, ingredient.id]));
  const missingIngredients = ingredientNames.filter(name => !ingredientByName.has(name));
  if (missingIngredients.length > 0) {
    throw new Error(`Missing ingredient(s): ${missingIngredients.join(', ')}`);
  }

  const { error: categoryMenuError } = await supabase
    .from('menu_category_menus')
    .upsert(
      {
        menu_id: menu.id,
        category_id: category.id,
        sort_order: category.sort_order ?? 110,
      },
      { onConflict: 'menu_id,category_id' }
    );

  if (categoryMenuError) {
    throw new Error(`Menu/category link failed: ${categoryMenuError.message}`);
  }

  for (const dish of kidsDishes) {
    const { data: existing, error: existingError } = await supabase
      .from('menu_dishes')
      .select('id')
      .in('slug', [dish.slug, ...(dish.previousSlugs ?? [])])
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Lookup failed for ${dish.name}: ${existingError.message}`);
    }

    let dishId = existing?.id;
    if (dishId) {
      const { error: updateError } = await supabase
        .from('menu_dishes')
        .update({
          name: dish.name,
          slug: dish.slug,
          description: dish.description,
          selling_price: dish.selling_price,
          target_gp_pct: 0.7,
          dietary_flags: dish.dietary_flags,
          is_active: true,
          is_sunday_lunch: false,
          allergen_verified: false,
          notes: 'Kids menu main. No kids desserts are included.',
        })
        .eq('id', dishId);

      if (updateError) {
        throw new Error(`Update failed for ${dish.name}: ${updateError.message}`);
      }
      console.warn(`Updated ${dish.name}`);
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('menu_dishes')
        .insert({
          name: dish.name,
          slug: dish.slug,
          description: dish.description,
          selling_price: dish.selling_price,
          target_gp_pct: 0.7,
          dietary_flags: dish.dietary_flags,
          allergen_flags: [],
          is_active: true,
          is_sunday_lunch: false,
          removable_allergens: [],
          is_modifiable_for: {},
          allergen_verified: false,
          notes: 'Kids menu main. No kids desserts are included.',
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        throw new Error(`Insert failed for ${dish.name}: ${insertError?.message ?? 'no row returned'}`);
      }
      dishId = inserted.id;
      console.warn(`Inserted ${dish.name}`);
    }

    const { error: deleteIngredientsError } = await supabase
      .from('menu_dish_ingredients')
      .delete()
      .eq('dish_id', dishId);

    if (deleteIngredientsError) {
      throw new Error(`Ingredient reset failed for ${dish.name}: ${deleteIngredientsError.message}`);
    }

    const ingredientRows = dish.ingredients.map(line => ({
      dish_id: dishId,
      ingredient_id: ingredientByName.get(line.name)!,
      quantity: line.quantity,
      unit: line.unit,
      inclusion_type: line.inclusion_type ?? 'included',
      yield_pct: 100,
      wastage_pct: 0,
    }));

    const { error: insertIngredientsError } = await supabase
      .from('menu_dish_ingredients')
      .insert(ingredientRows);

    if (insertIngredientsError) {
      throw new Error(`Ingredient insert failed for ${dish.name}: ${insertIngredientsError.message}`);
    }

    const { error: assignmentError } = await supabase
      .from('menu_dish_menu_assignments')
      .upsert(
        {
          dish_id: dishId,
          menu_id: menu.id,
          category_id: category.id,
          sort_order: dish.sort_order,
          is_special: false,
          is_default_side: false,
        },
        { onConflict: 'dish_id,menu_id,category_id' }
      );

    if (assignmentError) {
      throw new Error(`Assignment failed for ${dish.name}: ${assignmentError.message}`);
    }

    const { error: refreshError } = await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: dishId });
    if (refreshError) {
      throw new Error(`Refresh failed for ${dish.name}: ${refreshError.message}`);
    }

    const { error: dietaryFlagsError } = await supabase
      .from('menu_dishes')
      .update({ dietary_flags: dish.dietary_flags })
      .eq('id', dishId);

    if (dietaryFlagsError) {
      throw new Error(`Dietary flag update failed for ${dish.name}: ${dietaryFlagsError.message}`);
    }
  }

  const { data: dishRows, error: dishRowsError } = await supabase
    .from('menu_dishes')
    .select('id')
    .in(
      'slug',
      kidsDishes.map(dish => dish.slug)
    );

  if (dishRowsError) {
    throw new Error(`Main menu cleanup lookup failed: ${dishRowsError.message}`);
  }

  const kidsDishIds = (dishRows ?? []).map(dish => dish.id);
  if (kidsDishIds.length > 0) {
    const { error: removeMainAssignmentsError } = await supabase
      .from('menu_dish_menu_assignments')
      .delete()
      .eq('menu_id', mainMenu.id)
      .eq('category_id', category.id)
      .in('dish_id', kidsDishIds);

    if (removeMainAssignmentsError) {
      throw new Error(`Main menu cleanup failed: ${removeMainAssignmentsError.message}`);
    }
  }

  const { count: remainingMainKidsCount, error: remainingMainKidsError } = await supabase
    .from('menu_dish_menu_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('menu_id', mainMenu.id)
    .eq('category_id', category.id);

  if (remainingMainKidsError) {
    throw new Error(`Main menu cleanup check failed: ${remainingMainKidsError.message}`);
  }

  if ((remainingMainKidsCount ?? 0) === 0) {
    const { error: removeMainCategoryError } = await supabase
      .from('menu_category_menus')
      .delete()
      .eq('menu_id', mainMenu.id)
      .eq('category_id', category.id);

    if (removeMainCategoryError) {
      throw new Error(`Main menu category cleanup failed: ${removeMainCategoryError.message}`);
    }
  } else {
    console.warn(`Main Menu > Kids still has ${remainingMainKidsCount} item(s), so the category link was left in place.`);
  }

  const { data: retiredDishes, error: retiredDishesError } = await supabase
    .from('menu_dishes')
    .select('id, name')
    .in('slug', retiredDishSlugs);

  if (retiredDishesError) {
    throw new Error(`Retired dish lookup failed: ${retiredDishesError.message}`);
  }

  const retiredDishIds = (retiredDishes ?? []).map(dish => dish.id);
  if (retiredDishIds.length > 0) {
    const { error: removeRetiredAssignmentsError } = await supabase
      .from('menu_dish_menu_assignments')
      .delete()
      .in('dish_id', retiredDishIds);

    if (removeRetiredAssignmentsError) {
      throw new Error(`Retired dish assignment cleanup failed: ${removeRetiredAssignmentsError.message}`);
    }

    const { error: retireDishesError } = await supabase
      .from('menu_dishes')
      .update({
        is_active: false,
        notes: 'Retired from kids menu: item cannot be portioned for children.',
      })
      .in('id', retiredDishIds);

    if (retireDishesError) {
      throw new Error(`Retired dish update failed: ${retireDishesError.message}`);
    }

    console.warn(`Retired ${retiredDishes?.map(dish => dish.name).join(', ')}`);
  }

  const { data: verification, error: verificationError } = await supabase
    .from('menu_dish_menu_assignments')
    .select('sort_order, dish:menu_dishes(name, selling_price, portion_cost, gp_pct, is_active)')
    .eq('menu_id', menu.id)
    .eq('category_id', category.id)
    .order('sort_order');

  if (verificationError) {
    throw new Error(`Verification failed: ${verificationError.message}`);
  }

  console.warn('\nKids menu mains:');
  for (const row of verification ?? []) {
    const dish = Array.isArray(row.dish) ? row.dish[0] : row.dish;
    if (!dish) continue;
    console.warn(
      `${row.sort_order}. ${dish.name} - £${Number(dish.selling_price).toFixed(0)} ` +
        `(cost £${Number(dish.portion_cost ?? 0).toFixed(2)}, GP ${Math.round(Number(dish.gp_pct ?? 0) * 100)}%)`
    );
  }
}

main().catch(error => {
  console.error('FAILED:', error.message);
  process.exit(1);
});
