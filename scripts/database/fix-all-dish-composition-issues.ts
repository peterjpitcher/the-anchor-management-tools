#!/usr/bin/env tsx
/**
 * fix-all-dish-composition-issues.ts
 *
 * One-time data correction script that addresses 47 issues found in dish
 * compositions during the April 2026 audit. Covers incorrect inclusion types,
 * wrong upgrade prices, missing choice groups, and logs warnings for items
 * that need manual review or new ingredients.
 *
 * Usage:
 *   npx tsx scripts/database/fix-all-dish-composition-issues.ts --dry-run
 *   npx tsx scripts/database/fix-all-dish-composition-issues.ts
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

interface PlannedChange {
  fixNumber: string;
  dishName: string;
  dishId: string;
  rowId: string;
  ingredientName: string;
  oldInclusionType: string;
  oldOptionGroup: string | null;
  oldUpgradePrice: number | null;
  newInclusionType: string;
  newOptionGroup: string | null;
  newUpgradePrice: number | null;
}

// ─── Ingredient patterns ──────────────────────────────────────────────────────

const P = {
  mushyPeas: /mushy.*pea/i,
  gardenPeas: /garden.*pea/i,
  steakCutChips: /steak.*cut.*chip|crispy.*steak/i,
  straightCutChips: /straight.*cut|skin.*on.*fries|french.*fries/i,
  sweetPotatoFries: /sweet.*potato/i,
  hashBrown: /hash.*brown/i,
  cheese: /cheddar|cheese/i,
  onionRing: /onion.*ring/i,
  bacon: /bacon/i,
  tomato: /tomato/i,
  lettuce: /lettuce/i,
  cucumber: /cucumber/i,
  iceCream: /ice.*cream/i,
  garlicBread: /garlic.*bread/i,
  gravy: /gravy/i,
  stickyToffeePudding: /sticky.*toffee|toffee.*pudding/i,
  chips: /chip/i,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIngName(row: DishIngredientRow): string {
  const data = row.ingredient;
  if (!data) return 'unknown';
  if (Array.isArray(data)) return data[0]?.name || 'unknown';
  return data.name || 'unknown';
}

function formatState(type: string, group: string | null, price: number | null): string {
  let s = type;
  if (group) s += ` [${group}]`;
  if (price !== null && price !== undefined) s += ` +£${price.toFixed(2)}`;
  return s;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Fix All Dish Composition Issues (47 fixes)`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no database changes)' : 'LIVE'}`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Step 1: Load all data ──────────────────────────────────────────────────

  const { data: dishes, error: dishErr } = await supabase
    .from('menu_dishes')
    .select('id, name, selling_price, portion_cost, gp_pct');

  if (dishErr || !dishes) {
    console.error('Failed to load dishes:', dishErr?.message);
    process.exit(1);
  }

  const { data: dishIngs, error: diErr } = await supabase
    .from('menu_dish_ingredients')
    .select('id, dish_id, ingredient_id, inclusion_type, option_group, upgrade_price, ingredient:menu_ingredients(id, name)');

  if (diErr || !dishIngs) {
    console.error('Failed to load dish ingredients:', diErr?.message);
    process.exit(1);
  }

  console.log(`Loaded ${dishes.length} dishes and ${dishIngs.length} dish-ingredient links.\n`);

  // ── Step 2: Build lookup maps ──────────────────────────────────────────────

  const dishByName = new Map<string, DishRow>();
  for (const d of dishes) {
    dishByName.set(d.name.toLowerCase().trim(), d);
  }

  const ingredientsByDish = new Map<string, DishIngredientRow[]>();
  for (const di of dishIngs as DishIngredientRow[]) {
    const arr = ingredientsByDish.get(di.dish_id) || [];
    arr.push(di);
    ingredientsByDish.set(di.dish_id, arr);
  }

  // Find a dish by name (tries several aliases)
  function findDish(...aliases: string[]): DishRow | undefined {
    for (const alias of aliases) {
      const dish = dishByName.get(alias.toLowerCase().trim());
      if (dish) return dish;
    }
    return undefined;
  }

  // Find a dish-ingredient row on a dish matching a pattern
  function findDishIng(dishId: string, pattern: RegExp): DishIngredientRow | undefined {
    const rows = ingredientsByDish.get(dishId) || [];
    return rows.find(r => pattern.test(getIngName(r)));
  }

  // Find all dish-ingredient rows on a dish matching a pattern
  function findAllDishIngs(dishId: string, pattern: RegExp): DishIngredientRow[] {
    const rows = ingredientsByDish.get(dishId) || [];
    return rows.filter(r => pattern.test(getIngName(r)));
  }

  // ── Step 3: Collect changes and warnings ───────────────────────────────────

  const changes: PlannedChange[] = [];
  const warnings: string[] = [];
  const affectedDishIds = new Set<string>();

  /**
   * Queue a change: update inclusion_type, option_group, upgrade_price on a row.
   * Skips if already in the desired state (idempotent).
   */
  function queueChange(
    fixNum: string,
    dish: DishRow,
    row: DishIngredientRow,
    newType: string,
    newGroup: string | null,
    newPrice: number | null
  ): void {
    // Already correct?
    if (
      row.inclusion_type === newType &&
      row.option_group === newGroup &&
      row.upgrade_price === newPrice
    ) {
      return;
    }

    changes.push({
      fixNumber: fixNum,
      dishName: dish.name,
      dishId: dish.id,
      rowId: row.id,
      ingredientName: getIngName(row),
      oldInclusionType: row.inclusion_type,
      oldOptionGroup: row.option_group,
      oldUpgradePrice: row.upgrade_price,
      newInclusionType: newType,
      newOptionGroup: newGroup,
      newUpgradePrice: newPrice,
    });
    affectedDishIds.add(dish.id);
  }

  function warn(msg: string): void {
    warnings.push(msg);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 1: Sticky Toffee Pudding (fix #1)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('sticky toffee pudding', 'sticky toffee');
    if (dish) {
      // Find the main pudding ingredient (the sticky toffee pudding itself)
      const rows = ingredientsByDish.get(dish.id) || [];
      const puddingRow = rows.find(r => {
        const name = getIngName(r);
        return P.stickyToffeePudding.test(name) && r.inclusion_type !== 'included';
      });
      if (puddingRow) {
        queueChange('#1', dish, puddingRow, 'included', null, null);
      }
    } else {
      warn('Fix #1: Sticky Toffee Pudding not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 2: Chocolate Fudge Cake — cream vs ice cream (fix #2)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('chocolate fudge cake', 'choc fudge cake');
    if (dish) {
      const iceRow = findDishIng(dish.id, P.iceCream);
      if (iceRow) {
        warn("Fix #2: Chocolate Fudge Cake has ice cream but menu says 'cream or custard'. Consider adding a cream ingredient and removing ice cream.");
      }
    } else {
      warn('Fix #2: Chocolate Fudge Cake not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 3: Sausage & Mash fixes (fixes #3-5)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('sausage & mash', 'sausage and mash', 'bangers & mash', 'bangers and mash');
    if (dish) {
      // #3: Garden peas → choice/Peas
      const gardenPeas = findDishIng(dish.id, P.gardenPeas);
      if (gardenPeas) {
        queueChange('#3', dish, gardenPeas, 'choice', 'Peas', null);
      }

      // #4: Mushy peas → choice/Peas
      const mushyPeas = findDishIng(dish.id, P.mushyPeas);
      if (mushyPeas) {
        queueChange('#4', dish, mushyPeas, 'choice', 'Peas', null);
      }

      // #5: Sweet potato fries → upgrade/Side upgrade £2.00
      const spf = findDishIng(dish.id, P.sweetPotatoFries);
      if (spf && spf.inclusion_type === 'included') {
        queueChange('#5', dish, spf, 'upgrade', 'Side upgrade', 2.00);
      } else if (spf) {
        // Even if not currently included, ensure correct upgrade config
        queueChange('#5', dish, spf, 'upgrade', 'Side upgrade', 2.00);
      }
    } else {
      warn('Fix #3-5: Sausage & Mash not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 4: Vegetable Burger — full reclassification (fix #6)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('vegetable burger', 'garden veg burger', 'veggie burger', 'veg burger', 'garden burger');
    if (dish) {
      // Steak cut chips → upgrade/Chips upgrade £0
      const steak = findDishIng(dish.id, P.steakCutChips);
      if (steak) queueChange('#6a', dish, steak, 'upgrade', 'Chips upgrade', 0);

      // Sweet potato fries → upgrade/Chips upgrade £2.00
      const spf = findDishIng(dish.id, P.sweetPotatoFries);
      if (spf) queueChange('#6b', dish, spf, 'upgrade', 'Chips upgrade', 2.00);

      // Tomato → removable
      const tomato = findDishIng(dish.id, P.tomato);
      if (tomato) queueChange('#6c', dish, tomato, 'removable', null, null);

      // Hash brown → upgrade £2.00
      const hash = findDishIng(dish.id, P.hashBrown);
      if (hash) queueChange('#6d', dish, hash, 'upgrade', null, 2.00);

      // Cheese → upgrade £1.00
      const cheese = findDishIng(dish.id, P.cheese);
      if (cheese) queueChange('#6e', dish, cheese, 'upgrade', null, 1.00);

      // Onion ring → included (leave as-is if already included)
      const onion = findDishIng(dish.id, P.onionRing);
      if (onion && onion.inclusion_type !== 'included') {
        queueChange('#6f', dish, onion, 'included', null, null);
      }

      // Bacon → upgrade £2.00 (with warning about veggie dish)
      const bacon = findDishIng(dish.id, P.bacon);
      if (bacon) {
        queueChange('#6g', dish, bacon, 'upgrade', null, 2.00);
        warn('Fix #6g: Vegetable Burger has bacon as an upgrade — vegetarian dish with meat product, needs human review');
      }
    } else {
      warn('Fix #6: Vegetable Burger not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 5: Burger upgrade prices (fixes #7-8)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const burgerNames = [
      ['beef burger', 'classic beef burger'],
      ['chicken burger'],
      ['spicy chicken burger'],
    ];
    for (const aliases of burgerNames) {
      const dish = findDish(...aliases);
      if (!dish) {
        warn(`Fix #7-8: ${aliases[0]} not found in DB`);
        continue;
      }

      // #7: Cheese upgrade_price → £1.00 (currently £0.75)
      const cheese = findDishIng(dish.id, P.cheese);
      if (cheese && cheese.inclusion_type === 'upgrade') {
        queueChange('#7', dish, cheese, 'upgrade', cheese.option_group, 1.00);
      }

      // #8: Bacon upgrade_price → £2.00 (currently £1.50)
      const bacon = findDishIng(dish.id, P.bacon);
      if (bacon && bacon.inclusion_type === 'upgrade') {
        queueChange('#8', dish, bacon, 'upgrade', bacon.option_group, 2.00);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 6: Hash brown on basic burgers (fixes #9-11)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const burgerNames = [
      ['beef burger', 'classic beef burger'],
      ['chicken burger'],
      ['spicy chicken burger'],
    ];
    for (const aliases of burgerNames) {
      const dish = findDish(...aliases);
      if (!dish) continue; // already warned in Group 5

      // Hash brown → upgrade £2.00 (currently included)
      const hash = findDishIng(dish.id, P.hashBrown);
      if (hash) {
        queueChange('#9-11', dish, hash, 'upgrade', null, 2.00);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 7: Beef Stack extras (fixes #12-14)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('beef stack');
    if (dish) {
      // #12: Hash brown → upgrade £2.00
      const hash = findDishIng(dish.id, P.hashBrown);
      if (hash) queueChange('#12', dish, hash, 'upgrade', null, 2.00);

      // #13: Cheese → upgrade £1.00
      const cheese = findDishIng(dish.id, P.cheese);
      if (cheese) queueChange('#13', dish, cheese, 'upgrade', null, 1.00);

      // #14: Bacon → upgrade £2.00
      const bacon = findDishIng(dish.id, P.bacon);
      if (bacon) queueChange('#14', dish, bacon, 'upgrade', null, 2.00);
    } else {
      warn('Fix #12-14: Beef Stack not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 8: Chicken Stack extras (fixes #15-17)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('chicken stack');
    if (dish) {
      // #15: Cheese → upgrade £1.00
      const cheese = findDishIng(dish.id, P.cheese);
      if (cheese) queueChange('#15', dish, cheese, 'upgrade', null, 1.00);

      // #16: Onion ring → upgrade £1.00
      const onion = findDishIng(dish.id, P.onionRing);
      if (onion) queueChange('#16', dish, onion, 'upgrade', null, 1.00);

      // #17: Bacon → upgrade £2.00
      const bacon = findDishIng(dish.id, P.bacon);
      if (bacon) queueChange('#17', dish, bacon, 'upgrade', null, 2.00);
    } else {
      warn('Fix #15-17: Chicken Stack not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 9: Spicy Chicken Stack extras (fixes #18-20)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('spicy chicken stack');
    if (dish) {
      // #18: Cheese → upgrade £1.00
      const cheese = findDishIng(dish.id, P.cheese);
      if (cheese) queueChange('#18', dish, cheese, 'upgrade', null, 1.00);

      // #19: Onion ring → upgrade £1.00
      const onion = findDishIng(dish.id, P.onionRing);
      if (onion) queueChange('#19', dish, onion, 'upgrade', null, 1.00);

      // #20: Bacon → upgrade £2.00
      const bacon = findDishIng(dish.id, P.bacon);
      if (bacon) queueChange('#20', dish, bacon, 'upgrade', null, 2.00);
    } else {
      warn('Fix #18-20: Spicy Chicken Stack not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 10: Veggie Stack extras (fixes #21-22)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('veggie stack', 'veg stack', 'garden stack');
    if (dish) {
      // #21: Hash brown → upgrade £2.00
      const hash = findDishIng(dish.id, P.hashBrown);
      if (hash) queueChange('#21', dish, hash, 'upgrade', null, 2.00);

      // #22: Cheese → upgrade £1.00
      const cheese = findDishIng(dish.id, P.cheese);
      if (cheese) queueChange('#22', dish, cheese, 'upgrade', null, 1.00);

      // Bacon warning
      const bacon = findDishIng(dish.id, P.bacon);
      if (bacon) {
        warn('Fix #22 (note): Veggie Stack has bacon as ingredient — vegetarian dish with meat product, needs human review');
      }
    } else {
      warn('Fix #21-22: Veggie Stack not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 11: Katsu Chicken Burger extras (fixes #23-26)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('katsu chicken burger', 'chicken katsu burger');
    if (dish) {
      // #23: Hash brown → upgrade £2.00
      const hash = findDishIng(dish.id, P.hashBrown);
      if (hash) queueChange('#23', dish, hash, 'upgrade', null, 2.00);

      // #24: Cheese → upgrade £1.00
      const cheese = findDishIng(dish.id, P.cheese);
      if (cheese) queueChange('#24', dish, cheese, 'upgrade', null, 1.00);

      // #25: Onion ring → upgrade £1.00
      const onion = findDishIng(dish.id, P.onionRing);
      if (onion) queueChange('#25', dish, onion, 'upgrade', null, 1.00);

      // #26: Bacon → upgrade £2.00
      const bacon = findDishIng(dish.id, P.bacon);
      if (bacon) queueChange('#26', dish, bacon, 'upgrade', null, 2.00);
    } else {
      warn('Fix #23-26: Katsu Chicken Burger not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 12: Fish dish chip fix (fixes #27-30)
  // Menu says "chunky chips" = steak cut chips as the standard/included chip.
  // ──────────────────────────────────────────────────────────────────────────
  {
    const fishDishNames = [
      ['fish & chips', 'fish and chips'],
      ['half fish & chips', 'half fish and chips', 'half fish'],
      ['scampi & chips', 'scampi and chips', 'scampi'],
      ['jumbo sausage & chips', 'jumbo sausage and chips', 'jumbo sausage'],
    ];

    for (const aliases of fishDishNames) {
      const dish = findDish(...aliases);
      if (!dish) {
        warn(`Fix #27-30: ${aliases[0]} not found in DB`);
        continue;
      }

      // Steak cut chips (chunky) → included (remove Chips upgrade group)
      const steak = findDishIng(dish.id, P.steakCutChips);
      if (steak && steak.inclusion_type !== 'included') {
        queueChange('#27-30', dish, steak, 'included', null, null);
      } else if (steak && steak.option_group !== null) {
        // Already included but has an option_group — clear it
        queueChange('#27-30', dish, steak, 'included', null, null);
      }

      // Sweet potato fries → stays as upgrade at £2 (no change needed unless wrong)
      const spf = findDishIng(dish.id, P.sweetPotatoFries);
      if (spf) {
        queueChange('#27-30', dish, spf, 'upgrade', 'Chips upgrade', 2.00);
      }

      // Straight cut chips — should not be on these dishes. Log warning if found.
      const straight = findDishIng(dish.id, P.straightCutChips);
      if (straight) {
        warn(`Fix #27-30: ${dish.name} has straight cut chips — menu doesn't offer this. Consider removing row ${straight.id}.`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 13: Wraps/smaller plates chip fix (fixes #31-34)
  // These come with straight cut chips as base. Steak cut = upgrade £0, SPF = upgrade £2.
  // ──────────────────────────────────────────────────────────────────────────
  {
    const wrapDishNames = [
      ['chicken goujon wrap with chips', 'chicken goujon wrap'],
      ['fish finger wrap with chips', 'fish finger wrap'],
      ['4 chicken goujons with chips', 'chicken goujons & chips', 'chicken goujons and chips', 'chicken goujon & chips'],
      ['3 fish fingers with chips', 'fish fingers & chips', 'fish fingers and chips', 'fish finger & chips'],
    ];

    for (const aliases of wrapDishNames) {
      const dish = findDish(...aliases);
      if (!dish) {
        warn(`Fix #31-34: ${aliases[0]} not found in DB`);
        continue;
      }

      // Straight cut → included (should already be, but ensure)
      const straight = findDishIng(dish.id, P.straightCutChips);
      if (straight) {
        queueChange('#31-34', dish, straight, 'included', null, null);
      }
      // Also check if generic "chips" exists that might be the straight cut
      if (!straight) {
        // The base chip might just be named "chips" generically — skip if not found
      }

      // Steak cut chips → upgrade/Chips upgrade £0
      const steak = findDishIng(dish.id, P.steakCutChips);
      if (steak) {
        queueChange('#31-34', dish, steak, 'upgrade', 'Chips upgrade', 0);
      }

      // Sweet potato fries → upgrade/Chips upgrade £2.00
      const spf = findDishIng(dish.id, P.sweetPotatoFries);
      if (spf) {
        queueChange('#31-34', dish, spf, 'upgrade', 'Chips upgrade', 2.00);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 14: Butternut Squash Pie (fix #35)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish(
      'butternut squash, mixed bean & cheese pie',
      'butternut squash pie',
      'butternut squash & spinach pie',
      'butternut squash and spinach pie'
    );
    if (dish) {
      // Chunky chips (steak cut) → upgrade/Side upgrade £0
      const steak = findDishIng(dish.id, P.steakCutChips);
      if (steak && steak.inclusion_type === 'included') {
        queueChange('#35a', dish, steak, 'upgrade', 'Side upgrade', 0);
      } else if (steak) {
        queueChange('#35a', dish, steak, 'upgrade', 'Side upgrade', 0);
      }

      // Sweet potato fries → upgrade/Side upgrade £2.00
      const spf = findDishIng(dish.id, P.sweetPotatoFries);
      if (spf && spf.inclusion_type === 'included') {
        queueChange('#35b', dish, spf, 'upgrade', 'Side upgrade', 2.00);
      } else if (spf) {
        queueChange('#35b', dish, spf, 'upgrade', 'Side upgrade', 2.00);
      }
    } else {
      warn('Fix #35: Butternut Squash Pie not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 15: Pie gravy fixes (fixes #36-38)
  // Gravy → included (currently removable)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const pieDishNames = [
      ['beef & ale pie', 'beef and ale pie'],
      ['chicken & wild mushroom pie', 'chicken and wild mushroom pie'],
      ['chicken, ham hock & leek pie', 'chicken ham hock & leek pie', 'chicken ham hock and leek pie'],
    ];

    for (const aliases of pieDishNames) {
      const dish = findDish(...aliases);
      if (!dish) {
        warn(`Fix #36-38: ${aliases[0]} not found in DB`);
        continue;
      }

      const gravy = findDishIng(dish.id, P.gravy);
      if (gravy && gravy.inclusion_type === 'removable') {
        queueChange('#36-38', dish, gravy, 'included', null, null);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 16: Pie mash/chips as choice (fix #39) — SKIP
  // Decision: Keep mash as included, chips as upgrade. This is already correct.
  // ──────────────────────────────────────────────────────────────────────────
  // Intentionally skipped per spec.

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 17: Lasagne garlic bread (fix #40)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('lasagne', 'lasagna');
    if (dish) {
      const gb = findDishIng(dish.id, P.garlicBread);
      if (gb && gb.inclusion_type === 'removable') {
        queueChange('#40', dish, gb, 'included', null, null);
      }
    } else {
      warn('Fix #40: Lasagne not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 18: Missing ingredients — LOG ONLY (fixes #41-44)
  // ──────────────────────────────────────────────────────────────────────────
  {
    // #41: Mac 'N Cheese missing crispy onions
    const macCheese = findDish("mac 'n cheese", 'mac & cheese', 'mac and cheese', 'macaroni cheese');
    if (macCheese) {
      warn("Fix #41: Mac 'N Cheese is missing crispy onions ingredient (menu says 'topped with crispy onions'). Create ingredient and add.");
    } else {
      warn("Fix #41: Mac 'N Cheese not found in DB");
    }

    // #42-43: Katsu Chicken Burger missing cucumber and tomato
    const katsuBurger = findDish('katsu chicken burger', 'chicken katsu burger');
    if (katsuBurger) {
      const cucumber = findDishIng(katsuBurger.id, P.cucumber);
      if (!cucumber) {
        warn('Fix #42: Katsu Chicken Burger is missing cucumber ingredient. Create and add.');
      }
      const tomato = findDishIng(katsuBurger.id, P.tomato);
      if (!tomato) {
        warn('Fix #43: Katsu Chicken Burger is missing tomato ingredient (doc says Opt/removable). Create and add.');
      }
    }

    // #44: Jumbo Sausage & Chips missing sauce/dip choice
    const jumboSausage = findDish('jumbo sausage & chips', 'jumbo sausage and chips', 'jumbo sausage');
    if (jumboSausage) {
      warn('Fix #44: Jumbo Sausage & Chips is missing sauce/dip choice. Create sauce ingredients and add as choice group.');
    } else {
      warn('Fix #44: Jumbo Sausage & Chips not found in DB');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 19: Bacon on veggie dishes — LOG WARNING (fix #45)
  // ──────────────────────────────────────────────────────────────────────────
  {
    warn('Fix #45: Vegetable Burger and Veggie Stack have bacon as ingredient — vegetarian dish with meat product, needs human review');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 20: Lamb Shank peas (fix #46)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('lamb shank');
    if (dish) {
      const gardenPeas = findDishIng(dish.id, P.gardenPeas);
      const mushyPeas = findDishIng(dish.id, P.mushyPeas);
      if (gardenPeas && !mushyPeas) {
        warn('Fix #46: Lamb Shank has garden peas but no mushy peas option. May not be on current menu — needs human review.');
      }
    } else {
      warn('Fix #46: Lamb Shank not found in DB (may not be on current menu)');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GROUP 21: Katsu Curry salad consistency (fix #47)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const dish = findDish('chicken katsu curry', 'katsu curry');
    if (dish) {
      // Make tomato, cucumber, and lettuce all removable
      const tomato = findDishIng(dish.id, P.tomato);
      if (tomato) queueChange('#47', dish, tomato, 'removable', null, null);

      const cucumber = findDishIng(dish.id, P.cucumber);
      if (cucumber) queueChange('#47', dish, cucumber, 'removable', null, null);

      const lettuce = findDishIng(dish.id, P.lettuce);
      if (lettuce) queueChange('#47', dish, lettuce, 'removable', null, null);
    } else {
      warn('Fix #47: Chicken Katsu Curry not found in DB');
    }
  }

  // ── Step 4: Report planned changes ─────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  PLANNED CHANGES: ${changes.length}`);
  console.log(`${'─'.repeat(60)}\n`);

  if (changes.length === 0) {
    console.log('  No changes needed — all compositions already match target state.\n');
  } else {
    for (const c of changes) {
      const oldState = formatState(c.oldInclusionType, c.oldOptionGroup, c.oldUpgradePrice);
      const newState = formatState(c.newInclusionType, c.newOptionGroup, c.newUpgradePrice);
      console.log(`  ${c.fixNumber} | ${c.dishName} | ${c.ingredientName}`);
      console.log(`         ${oldState}  -->  ${newState}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  WARNINGS (${warnings.length}) — require manual review`);
    console.log(`${'─'.repeat(60)}\n`);
    for (const w of warnings) {
      console.log(`  ⚠  ${w}`);
    }
  }

  // ── Step 5: Apply changes (or exit for dry-run) ────────────────────────────

  if (changes.length === 0 && warnings.length > 0) {
    console.log('\nNo database changes to apply. Review warnings above.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  DRY-RUN SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Dishes affected:    ${affectedDishIds.size}`);
    console.log(`  Rows to update:     ${changes.length}`);
    console.log(`  Warnings:           ${warnings.length}`);
    console.log(`\n  No database changes were made. Remove --dry-run to apply.`);
    process.exit(0);
  }

  // Capture before-state GP%
  const beforeGp = new Map<string, { name: string; gp: number | null }>();
  for (const dishId of affectedDishIds) {
    const dish = dishes.find(d => d.id === dishId);
    if (dish) {
      beforeGp.set(dishId, { name: dish.name, gp: dish.gp_pct });
    }
  }

  // Apply updates
  let updateCount = 0;
  let errorCount = 0;

  for (const change of changes) {
    const { error } = await supabase
      .from('menu_dish_ingredients')
      .update({
        inclusion_type: change.newInclusionType,
        option_group: change.newOptionGroup,
        upgrade_price: change.newInclusionType === 'upgrade' ? change.newUpgradePrice : null,
      })
      .eq('id', change.rowId);

    if (error) {
      console.error(`  ERROR updating ${change.fixNumber} | ${change.dishName} / ${change.ingredientName}: ${error.message}`);
      errorCount++;
    } else {
      updateCount++;
    }
  }

  if (errorCount > 0) {
    console.error(`\n  ${errorCount} update(s) failed. Review errors above.`);
  }

  // ── Step 6: Refresh GP% for all affected dishes ────────────────────────────

  console.log(`\nRefreshing GP calculations for ${affectedDishIds.size} dish(es)...`);
  for (const dishId of affectedDishIds) {
    const { error } = await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: dishId });
    if (error) {
      console.error(`  ERROR refreshing dish ${dishId}: ${error.message}`);
    }
  }

  // ── Step 7: Load after-state and print final report ────────────────────────

  const { data: updatedDishes, error: afterErr } = await supabase
    .from('menu_dishes')
    .select('id, name, gp_pct')
    .in('id', Array.from(affectedDishIds));

  if (afterErr) {
    console.error(`  WARNING: Failed to load updated dish data: ${afterErr.message}`);
  }

  const afterGp = new Map<string, number | null>();
  if (updatedDishes) {
    for (const d of updatedDishes) {
      afterGp.set(d.id, d.gp_pct);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  FINAL REPORT`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Dishes updated:     ${affectedDishIds.size}`);
  console.log(`  Rows updated:       ${updateCount}`);
  console.log(`  Errors:             ${errorCount}`);
  console.log(`  Warnings:           ${warnings.length}`);

  if (updatedDishes && beforeGp.size > 0) {
    console.log(`\n  GP% Impact:\n`);
    const header = `  ${padRight('Dish', 42)}${padRight('Old GP%', 12)}${padRight('New GP%', 12)}Change`;
    console.log(header);
    console.log(`  ${'-'.repeat(header.length - 2)}`);

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
        `  ${padRight(before.name, 42)}${padRight(oldGpStr, 12)}${padRight(newGpStr, 12)}${changeStr}`
      );
    }
  }

  if (warnings.length > 0) {
    console.log(`\n  Outstanding warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`    - ${w}`);
    }
  }

  console.log(`\nDone.`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
