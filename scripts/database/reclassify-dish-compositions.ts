#!/usr/bin/env tsx
/**
 * reclassify-dish-compositions.ts
 *
 * One-time script to reclassify existing dish-ingredient links based on the
 * March 2026 menu.  Converts generic "included" links to the correct
 * inclusion_type (removable, choice, upgrade) and sets option_group /
 * upgrade_price where appropriate.
 *
 * Usage:
 *   npx tsx scripts/database/reclassify-dish-compositions.ts --dry-run
 *   npx tsx scripts/database/reclassify-dish-compositions.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Types ────────────────────────────────────────────────────────────────────

interface DishRow {
  id: string;
  name: string;
  selling_price: number | null;
  portion_cost: number | null;
  gp_pct: number | null;
}

interface IngredientRef {
  id: string;
  name: string;
}

interface DishIngredientRow {
  id: string;
  dish_id: string;
  ingredient_id: string;
  inclusion_type: string;
  option_group: string | null;
  upgrade_price: number | null;
  ingredient: IngredientRef | IngredientRef[] | null;
}

type InclusionType = 'included' | 'removable' | 'choice' | 'upgrade';

interface ReclassifyRule {
  ingredientPattern: RegExp;
  newInclusionType: InclusionType;
  newOptionGroup?: string | null;
  newUpgradePrice?: number | null;
}

interface PlannedChange {
  dishName: string;
  dishId: string;
  rowId: string;
  ingredientName: string;
  oldInclusionType: string;
  oldOptionGroup: string | null;
  oldUpgradePrice: number | null;
  newInclusionType: InclusionType;
  newOptionGroup: string | null;
  newUpgradePrice: number | null;
}

interface PlannedDelete {
  dishName: string;
  dishId: string;
  rowId: string;
  ingredientName: string;
  reason: string;
}

// ─── Ingredient name patterns ─────────────────────────────────────────────────

const P = {
  mushyPeas: /mushy.*pea/i,
  gardenPeas: /garden.*pea/i,
  tartareSauce: /tartar/i,
  lemonWedge: /lemon/i,
  bambooStick: /bamboo/i,
  steakCutChips: /steak.*cut.*chip|crispy.*steak/i,
  sweetPotatoFries: /sweet.*potato/i,
  hashBrown: /hash.*brown/i,
  cheese: /cheddar|cheese/i,
  onionRing: /onion.*ring/i,
  bacon: /bacon/i,
  tomato: /tomato/i,
  lettuce: /lettuce/i,
  cucumber: /cucumber/i,
  custard: /custard/i,
  iceCream: /ice.*cream/i,
  garlicBread: /garlic.*bread/i,
  chillies: /chilli/i,
  mashedPotato: /mash/i,
  gravy: /gravy/i,
  coleslaw: /coleslaw|cole.*slaw/i,
  salad: /salad/i,
  chips: /chip/i,
  rice: /rice/i,
};

// ─── Dish aliases (spec name -> possible DB names) ────────────────────────────

const DISH_ALIASES: Record<string, string[]> = {
  // British Pub Classics
  'fish & chips': ['fish & chips', 'fish and chips'],
  'half fish & chips': ['half fish & chips', 'half fish and chips', 'half fish'],
  'scampi & chips': ['scampi & chips', 'scampi and chips', 'scampi'],
  'jumbo sausage & chips': ['jumbo sausage & chips', 'jumbo sausage and chips', 'jumbo sausage'],
  // Bangers & Mash
  'bangers & mash': ['bangers & mash', 'bangers and mash', 'sausage & mash', 'sausage and mash'],
  // Pies
  'beef & ale pie': ['beef & ale pie', 'beef and ale pie'],
  'chicken & wild mushroom pie': ['chicken & wild mushroom pie', 'chicken and wild mushroom pie'],
  'chicken ham hock & leek pie': ['chicken ham hock & leek pie', 'chicken ham hock and leek pie', 'chicken, ham hock & leek pie'],
  'butternut squash pie': ['butternut squash pie', 'butternut squash & spinach pie', 'butternut squash and spinach pie'],
  // Burgers
  'classic beef burger': ['classic beef burger', 'beef burger'],
  'chicken burger': ['chicken burger'],
  'spicy chicken burger': ['spicy chicken burger'],
  'garden veg burger': ['garden veg burger', 'veggie burger', 'veg burger', 'garden burger'],
  // Stacks
  'beef stack': ['beef stack'],
  'chicken stack': ['chicken stack'],
  'spicy chicken stack': ['spicy chicken stack'],
  'garden stack': ['garden stack', 'veg stack', 'veggie stack'],
  // Katsu
  'katsu chicken burger': ['katsu chicken burger', 'chicken katsu burger'],
  // Comfort Favourites
  'lasagne': ['lasagne', 'lasagna'],
  'mac & cheese': ['mac & cheese', 'mac and cheese', 'macaroni cheese'],
  'cannelloni': ['cannelloni'],
  // Chicken Katsu Curry
  'chicken katsu curry': ['chicken katsu curry', 'katsu curry'],
  // Puddings
  'apple crumble': ['apple crumble'],
  'chocolate fudge brownie': ['chocolate fudge brownie', 'choc fudge brownie'],
  'chocolate fudge cake': ['chocolate fudge cake', 'choc fudge cake'],
  'sticky toffee pudding': ['sticky toffee pudding', 'sticky toffee'],
  // Wraps
  'chicken goujon wrap': ['chicken goujon wrap'],
  'fish finger wrap': ['fish finger wrap'],
  // Smaller plates
  'fish fingers & chips': ['fish fingers & chips', 'fish fingers and chips', 'fish finger & chips'],
  'chicken goujons & chips': ['chicken goujons & chips', 'chicken goujons and chips', 'chicken goujon & chips'],
};

// ─── Reclassification rules per dish category ─────────────────────────────────

// British Pub Classics: Fish & Chips, Half Fish, Scampi, Jumbo Sausage
// All served with steak-cut chips (upgrade to sweet potato +$2), mushy peas
// (removable), lemon wedge (removable), bamboo stick (removable), tartare (removable)
const BRITISH_CLASSICS_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.mushyPeas, newInclusionType: 'removable' },
  { ingredientPattern: P.gardenPeas, newInclusionType: 'removable' },
  { ingredientPattern: P.tartareSauce, newInclusionType: 'removable' },
  { ingredientPattern: P.lemonWedge, newInclusionType: 'removable' },
  { ingredientPattern: P.bambooStick, newInclusionType: 'removable' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Bangers & Mash: mash (included), gravy (removable), garden peas (removable)
const BANGERS_MASH_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.mashedPotato, newInclusionType: 'included' },
  { ingredientPattern: P.gravy, newInclusionType: 'removable' },
  { ingredientPattern: P.gardenPeas, newInclusionType: 'removable' },
  { ingredientPattern: P.mushyPeas, newInclusionType: 'removable' },
];

// Pies: all served with mash + gravy (included), garden peas (removable),
// chips upgrade available
const PIE_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.mashedPotato, newInclusionType: 'included' },
  { ingredientPattern: P.gravy, newInclusionType: 'removable' },
  { ingredientPattern: P.gardenPeas, newInclusionType: 'removable' },
  { ingredientPattern: P.mushyPeas, newInclusionType: 'removable' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Standard Burgers (Classic Beef, Chicken, Spicy Chicken):
// Served with steak-cut chips (upgrade available), lettuce (removable),
// tomato (removable), onion ring UPGRADE
const STANDARD_BURGER_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.lettuce, newInclusionType: 'removable' },
  { ingredientPattern: P.tomato, newInclusionType: 'removable' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
  { ingredientPattern: P.onionRing, newInclusionType: 'upgrade', newOptionGroup: 'Burger extras', newUpgradePrice: 1.00 },
  { ingredientPattern: P.bacon, newInclusionType: 'upgrade', newOptionGroup: 'Burger extras', newUpgradePrice: 1.50 },
  { ingredientPattern: P.cheese, newInclusionType: 'upgrade', newOptionGroup: 'Burger extras', newUpgradePrice: 0.75 },
];

// Garden Veg Burger: onion ring INCLUDED (not an upgrade)
const GARDEN_VEG_BURGER_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.lettuce, newInclusionType: 'removable' },
  { ingredientPattern: P.tomato, newInclusionType: 'removable' },
  { ingredientPattern: P.onionRing, newInclusionType: 'included' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
  { ingredientPattern: P.cheese, newInclusionType: 'upgrade', newOptionGroup: 'Burger extras', newUpgradePrice: 0.75 },
];

// Beef Stack: onion ring INCLUDED
const BEEF_STACK_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.lettuce, newInclusionType: 'removable' },
  { ingredientPattern: P.tomato, newInclusionType: 'removable' },
  { ingredientPattern: P.onionRing, newInclusionType: 'included' },
  { ingredientPattern: P.bacon, newInclusionType: 'included' },
  { ingredientPattern: P.cheese, newInclusionType: 'included' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Chicken Stack, Spicy Chicken Stack: hash brown INCLUDED
const CHICKEN_STACK_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.lettuce, newInclusionType: 'removable' },
  { ingredientPattern: P.tomato, newInclusionType: 'removable' },
  { ingredientPattern: P.hashBrown, newInclusionType: 'included' },
  { ingredientPattern: P.bacon, newInclusionType: 'included' },
  { ingredientPattern: P.cheese, newInclusionType: 'included' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Garden Stack: onion ring INCLUDED
const GARDEN_STACK_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.lettuce, newInclusionType: 'removable' },
  { ingredientPattern: P.tomato, newInclusionType: 'removable' },
  { ingredientPattern: P.onionRing, newInclusionType: 'included' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Katsu Chicken Burger: cucumber yes, tomato NO (delete tomato row),
// lettuce removable
const KATSU_BURGER_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.lettuce, newInclusionType: 'removable' },
  { ingredientPattern: P.cucumber, newInclusionType: 'removable' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Comfort Favourites (Lasagne, Mac & Cheese, Cannelloni):
// Garlic bread (removable), salad (removable), chips upgrade available
const COMFORT_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.garlicBread, newInclusionType: 'removable' },
  { ingredientPattern: P.salad, newInclusionType: 'removable' },
  { ingredientPattern: P.coleslaw, newInclusionType: 'removable' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Chicken Katsu Curry: rice (included), salad (removable)
const KATSU_CURRY_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.rice, newInclusionType: 'included' },
  { ingredientPattern: P.salad, newInclusionType: 'removable' },
];

// Puddings (Apple Crumble, Choc Fudge Brownie, Choc Fudge Cake):
// Choice of custard or ice cream
const PUDDING_CHOICE_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.custard, newInclusionType: 'choice', newOptionGroup: 'Accompaniment' },
  { ingredientPattern: P.iceCream, newInclusionType: 'choice', newOptionGroup: 'Accompaniment' },
];

// Sticky Toffee Pudding: custard only (ice cream row should be DELETED)
const STICKY_TOFFEE_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.custard, newInclusionType: 'included' },
];

// Wraps (Chicken Goujon, Fish Finger): lettuce (removable), chips upgrade
const WRAP_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.lettuce, newInclusionType: 'removable' },
  { ingredientPattern: P.salad, newInclusionType: 'removable' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// Smaller plates (Fish Fingers & Chips, Chicken Goujons & Chips)
const SMALLER_PLATES_RULES: ReclassifyRule[] = [
  { ingredientPattern: P.gardenPeas, newInclusionType: 'removable' },
  { ingredientPattern: P.mushyPeas, newInclusionType: 'removable' },
  { ingredientPattern: P.steakCutChips, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 0 },
  { ingredientPattern: P.sweetPotatoFries, newInclusionType: 'upgrade', newOptionGroup: 'Chips upgrade', newUpgradePrice: 2.00 },
];

// ─── Dish-to-rules mapping ────────────────────────────────────────────────────

interface DishConfig {
  rules: ReclassifyRule[];
  deletePatterns?: { pattern: RegExp; reason: string }[];
}

const DISH_RULES: Record<string, DishConfig> = {
  // British Pub Classics
  'fish & chips': { rules: BRITISH_CLASSICS_RULES },
  'half fish & chips': { rules: BRITISH_CLASSICS_RULES },
  'scampi & chips': { rules: BRITISH_CLASSICS_RULES },
  'jumbo sausage & chips': { rules: BRITISH_CLASSICS_RULES },
  // Bangers & Mash
  'bangers & mash': { rules: BANGERS_MASH_RULES },
  // Pies
  'beef & ale pie': { rules: PIE_RULES },
  'chicken & wild mushroom pie': { rules: PIE_RULES },
  'chicken ham hock & leek pie': { rules: PIE_RULES },
  'butternut squash pie': { rules: PIE_RULES },
  // Standard Burgers
  'classic beef burger': { rules: STANDARD_BURGER_RULES },
  'chicken burger': { rules: STANDARD_BURGER_RULES },
  'spicy chicken burger': { rules: STANDARD_BURGER_RULES },
  // Garden Veg Burger
  'garden veg burger': { rules: GARDEN_VEG_BURGER_RULES },
  // Stacks
  'beef stack': { rules: BEEF_STACK_RULES },
  'chicken stack': { rules: CHICKEN_STACK_RULES },
  'spicy chicken stack': { rules: CHICKEN_STACK_RULES },
  'garden stack': { rules: GARDEN_STACK_RULES },
  // Katsu Chicken Burger — also deletes tomato
  'katsu chicken burger': {
    rules: KATSU_BURGER_RULES,
    deletePatterns: [
      { pattern: P.tomato, reason: 'Menu says cucumber, not tomato' },
    ],
  },
  // Comfort Favourites
  'lasagne': { rules: COMFORT_RULES },
  'mac & cheese': { rules: COMFORT_RULES },
  'cannelloni': { rules: COMFORT_RULES },
  // Chicken Katsu Curry
  'chicken katsu curry': { rules: KATSU_CURRY_RULES },
  // Puddings with choice
  'apple crumble': { rules: PUDDING_CHOICE_RULES },
  'chocolate fudge brownie': { rules: PUDDING_CHOICE_RULES },
  'chocolate fudge cake': { rules: PUDDING_CHOICE_RULES },
  // Sticky Toffee Pudding — custard only, delete ice cream
  'sticky toffee pudding': {
    rules: STICKY_TOFFEE_RULES,
    deletePatterns: [
      { pattern: P.iceCream, reason: 'Menu says custard only, not ice cream' },
    ],
  },
  // Wraps
  'chicken goujon wrap': { rules: WRAP_RULES },
  'fish finger wrap': { rules: WRAP_RULES },
  // Smaller plates
  'fish fingers & chips': { rules: SMALLER_PLATES_RULES },
  'chicken goujons & chips': { rules: SMALLER_PLATES_RULES },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n=== Dish Composition Reclassification Script ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no database changes)' : 'LIVE'}\n`);

  // Step 1: Load all dishes and dish-ingredient links
  const { data: dishes, error: dishErr } = await supabase
    .from('menu_dishes')
    .select('id, name, selling_price, portion_cost, gp_pct');

  if (dishErr || !dishes) {
    console.error('Failed to load dishes:', dishErr?.message);
    process.exit(1);
  }

  const { data: dishIngredients, error: diErr } = await supabase
    .from('menu_dish_ingredients')
    .select('id, dish_id, ingredient_id, inclusion_type, option_group, upgrade_price, ingredient:menu_ingredients(id, name)');

  if (diErr || !dishIngredients) {
    console.error('Failed to load dish ingredients:', diErr?.message);
    process.exit(1);
  }

  // Build lookup maps
  const dishByName = new Map<string, DishRow>();
  for (const d of dishes) {
    dishByName.set(d.name.toLowerCase().trim(), d);
  }

  const ingredientsByDish = new Map<string, DishIngredientRow[]>();
  for (const di of dishIngredients as DishIngredientRow[]) {
    const arr = ingredientsByDish.get(di.dish_id) || [];
    arr.push(di);
    ingredientsByDish.set(di.dish_id, arr);
  }

  console.log(`Loaded ${dishes.length} dishes and ${dishIngredients.length} dish-ingredient links.\n`);

  // Step 2: Find dishes and apply rules
  const changes: PlannedChange[] = [];
  const deletes: PlannedDelete[] = [];
  const affectedDishIds = new Set<string>();
  const notFoundDishes: string[] = [];

  for (const [specName, config] of Object.entries(DISH_RULES)) {
    const aliases = DISH_ALIASES[specName] || [specName];
    let foundDish: DishRow | undefined;

    for (const alias of aliases) {
      foundDish = dishByName.get(alias.toLowerCase().trim());
      if (foundDish) break;
    }

    if (!foundDish) {
      notFoundDishes.push(specName);
      continue;
    }

    const rows = ingredientsByDish.get(foundDish.id) || [];

    // Apply reclassification rules
    for (const rule of config.rules) {
      const match = rows.find((r) => rule.ingredientPattern.test(getIngredientName(r)));
      if (!match) continue;

      const newOptionGroup = rule.newOptionGroup ?? null;
      const newUpgradePrice = rule.newUpgradePrice ?? null;

      // Skip if already correct (idempotent)
      if (
        match.inclusion_type === rule.newInclusionType &&
        match.option_group === newOptionGroup &&
        match.upgrade_price === newUpgradePrice
      ) {
        continue;
      }

      changes.push({
        dishName: foundDish.name,
        dishId: foundDish.id,
        rowId: match.id,
        ingredientName: getIngredientName(match),
        oldInclusionType: match.inclusion_type,
        oldOptionGroup: match.option_group,
        oldUpgradePrice: match.upgrade_price,
        newInclusionType: rule.newInclusionType,
        newOptionGroup: newOptionGroup,
        newUpgradePrice: newUpgradePrice,
      });

      affectedDishIds.add(foundDish.id);
    }

    // Apply delete patterns
    if (config.deletePatterns) {
      for (const del of config.deletePatterns) {
        const match = rows.find((r) => del.pattern.test(getIngredientName(r)));
        if (!match) continue;

        deletes.push({
          dishName: foundDish.name,
          dishId: foundDish.id,
          rowId: match.id,
          ingredientName: getIngredientName(match),
          reason: del.reason,
        });

        affectedDishIds.add(foundDish.id);
      }
    }
  }

  // Step 3: Report planned changes
  if (notFoundDishes.length > 0) {
    console.log(`WARNING: ${notFoundDishes.length} dish(es) not found in database:`);
    for (const name of notFoundDishes) {
      console.log(`  - ${name}`);
    }
    console.log('');
  }

  if (changes.length === 0 && deletes.length === 0) {
    console.log('No changes needed. All dish compositions already match the target state.');
    process.exit(0);
  }

  console.log(`--- Planned Reclassifications (${changes.length}) ---\n`);
  for (const c of changes) {
    const oldState = formatState(c.oldInclusionType, c.oldOptionGroup, c.oldUpgradePrice);
    const newState = formatState(c.newInclusionType, c.newOptionGroup, c.newUpgradePrice);
    console.log(`  ${c.dishName} | ${c.ingredientName}`);
    console.log(`    ${oldState} --> ${newState}`);
  }

  if (deletes.length > 0) {
    console.log(`\n--- Planned Deletions (${deletes.length}) ---\n`);
    for (const d of deletes) {
      console.log(`  ${d.dishName} | ${d.ingredientName} | DELETE (${d.reason})`);
    }
  }

  console.log('');

  if (DRY_RUN) {
    console.log(`=== DRY-RUN Summary ===`);
    console.log(`Dishes affected: ${affectedDishIds.size}`);
    console.log(`Rows to reclassify: ${changes.length}`);
    console.log(`Rows to delete: ${deletes.length}`);
    console.log(`\nNo database changes were made. Remove --dry-run to apply.`);
    process.exit(0);
  }

  // Step 4: Capture before-state GP% for affected dishes
  const beforeGp = new Map<string, { name: string; gp: number | null }>();
  for (const dishId of affectedDishIds) {
    const dish = dishes.find((d) => d.id === dishId);
    if (dish) {
      beforeGp.set(dishId, { name: dish.name, gp: dish.gp_pct });
    }
  }

  // Step 5: Apply updates (batch per dish where possible)
  let updateCount = 0;
  let deleteCount = 0;

  // Group updates by row ID for individual updates (each row has unique values)
  for (const change of changes) {
    const updateData: Record<string, unknown> = {
      inclusion_type: change.newInclusionType,
      option_group: change.newOptionGroup,
      upgrade_price: change.newUpgradePrice,
    };

    const { error } = await supabase
      .from('menu_dish_ingredients')
      .update(updateData)
      .eq('id', change.rowId);

    if (error) {
      console.error(`ERROR updating row ${change.rowId} (${change.dishName} / ${change.ingredientName}): ${error.message}`);
      process.exit(1);
    }
    updateCount++;
  }

  // Apply deletes
  if (deletes.length > 0) {
    const deleteIds = deletes.map((d) => d.rowId);
    const { error } = await supabase
      .from('menu_dish_ingredients')
      .delete()
      .in('id', deleteIds);

    if (error) {
      console.error(`ERROR deleting rows: ${error.message}`);
      process.exit(1);
    }
    deleteCount = deletes.length;
  }

  // Step 6: Refresh GP% for all affected dishes
  console.log(`Refreshing GP calculations for ${affectedDishIds.size} dish(es)...`);
  for (const dishId of affectedDishIds) {
    const { error } = await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: dishId });
    if (error) {
      console.error(`ERROR refreshing dish ${dishId}: ${error.message}`);
      // Continue with other dishes rather than failing entirely
    }
  }

  // Step 7: Load after-state and print report
  const { data: updatedDishes, error: afterErr } = await supabase
    .from('menu_dishes')
    .select('id, name, gp_pct')
    .in('id', Array.from(affectedDishIds));

  if (afterErr) {
    console.error(`WARNING: Failed to load updated dish data: ${afterErr.message}`);
  }

  const afterGp = new Map<string, number | null>();
  if (updatedDishes) {
    for (const d of updatedDishes) {
      afterGp.set(d.id, d.gp_pct);
    }
  }

  console.log(`\n=== Reclassification Report ===\n`);
  console.log(`Dishes updated: ${affectedDishIds.size}`);
  console.log(`Rows reclassified: ${updateCount}`);
  console.log(`Rows deleted: ${deleteCount}`);

  if (updatedDishes && beforeGp.size > 0) {
    console.log('');
    const header = padRight('Dish', 40) + padRight('Old GP%', 12) + padRight('New GP%', 12) + 'Change';
    console.log(header);
    console.log('-'.repeat(header.length));

    // Sort by dish name
    const sortedIds = Array.from(affectedDishIds).sort((a, b) => {
      const nameA = beforeGp.get(a)?.name || '';
      const nameB = beforeGp.get(b)?.name || '';
      return nameA.localeCompare(nameB);
    });

    for (const dishId of sortedIds) {
      const before = beforeGp.get(dishId);
      const after = afterGp.get(dishId);
      if (!before) continue;

      const oldGpStr = before.gp !== null ? `${(before.gp * 100).toFixed(1)}%` : 'N/A';
      const newGpStr = after !== null && after !== undefined ? `${(after * 100).toFixed(1)}%` : 'N/A';

      let changeStr = 'N/A';
      if (before.gp !== null && after !== null && after !== undefined) {
        const diff = (after - before.gp) * 100;
        changeStr = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp`;
      }

      console.log(
        padRight(before.name, 40) +
        padRight(oldGpStr, 12) +
        padRight(newGpStr, 12) +
        changeStr
      );
    }
  }

  console.log(`\nDone.`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIngredientName(row: DishIngredientRow): string {
  const data = row.ingredient;
  if (!data) return 'unknown';
  if (Array.isArray(data)) return data[0]?.name || 'unknown';
  return data.name || 'unknown';
}

function formatState(
  inclusionType: string,
  optionGroup: string | null,
  upgradePrice: number | null
): string {
  let s = inclusionType;
  if (optionGroup) s += ` [${optionGroup}]`;
  if (upgradePrice !== null && upgradePrice !== undefined) s += ` +£${upgradePrice.toFixed(2)}`;
  return s;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Reclassification script failed:', err);
  process.exit(1);
});
