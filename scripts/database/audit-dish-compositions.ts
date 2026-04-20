/**
 * Audit current dish compositions against the March 2026 menu
 * Run with: npx tsx scripts/database/audit-dish-compositions.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function audit() {
  // Get all dishes with their ingredients
  const { data: dishes, error: dishError } = await supabase
    .from('menu_dishes')
    .select('id, name, selling_price, is_active')
    .order('name');

  if (dishError || !dishes) {
    console.error('Failed to fetch dishes:', dishError);
    return;
  }

  for (const dish of dishes) {
    // Get ingredients
    const { data: ingredients } = await supabase
      .from('menu_dish_ingredients')
      .select('id, quantity, unit, option_group, ingredient:menu_ingredients(id, name, allergens, dietary_flags)')
      .eq('dish_id', dish.id);

    // Get recipes
    const { data: recipes } = await supabase
      .from('menu_dish_recipes')
      .select('id, quantity, option_group, recipe:menu_recipes(id, name)')
      .eq('dish_id', dish.id);

    if ((ingredients && ingredients.length > 0) || (recipes && recipes.length > 0)) {
      console.log(`\n=== ${dish.name} (£${dish.selling_price}) ${dish.is_active ? '' : '[INACTIVE]'} ===`);
      console.log(`  ID: ${dish.id}`);

      if (ingredients && ingredients.length > 0) {
        console.log('  Ingredients:');
        for (const ing of ingredients) {
          const ingData = ing.ingredient as any;
          const group = ing.option_group ? `[${ing.option_group}]` : '';
          console.log(`    - ${ingData?.name || 'UNKNOWN'} (qty: ${ing.quantity}, unit: ${ing.unit}) ${group} [row: ${ing.id}]`);
        }
      }

      if (recipes && recipes.length > 0) {
        console.log('  Recipes:');
        for (const rec of recipes) {
          const recData = rec.recipe as any;
          const group = rec.option_group ? `[${rec.option_group}]` : '';
          console.log(`    - ${recData?.name || 'UNKNOWN'} (qty: ${rec.quantity}) ${group} [row: ${rec.id}]`);
        }
      }
    }
  }
}

audit().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
