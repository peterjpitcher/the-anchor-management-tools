/**
 * Fix NULL portions_per_pack on ingredients causing inflated dish costs,
 * and fix the Scampi quantity bug.
 *
 * Run with: npx tsx scripts/database/fix-ingredient-portions-per-pack.ts
 * Add --commit to apply changes.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DRY_RUN = !process.argv.includes('--commit');

// ── Ingredient fixes: set missing portions_per_pack ──────────────────────
// These all have NULL portions_per_pack, causing the cost function to
// fall back to pack_cost/pack_size (weight), giving wildly wrong unit costs.
const INGREDIENT_FIXES: {
  namePattern: string;
  portions_per_pack: number;
  rationale: string;
}[] = [
  {
    namePattern: 'Crispy Steak Cut Chips 2.5kg',
    portions_per_pack: 15,
    rationale: '2.5kg bag @ ~165g per portion of chunky chips = ~15 portions',
  },
  {
    namePattern: 'Katsu Curry',
    portions_per_pack: 10,
    rationale: '2.27L bottle @ ~225ml per curry/burger sauce portion = ~10 portions',
  },
  {
    namePattern: 'Crispy Fried Onions',
    portions_per_pack: 50,
    rationale: '1kg bag @ ~20g sprinkle per dish = ~50 portions',
  },
  {
    namePattern: 'Cannelloni 2kg',
    portions_per_pack: 6,
    rationale: '2kg tray, serves 6 individual portions',
  },
];

// ── Dish-ingredient fix: Scampi quantity ─────────────────────────────────
// qty=12 pieces treats each piece as a full portion (1/16th of a 1.8kg bag).
// One serving of 12 scampi pieces IS one portion, so qty should be 1.
const SCAMPI_FIX = {
  dishName: 'Scampi & Chips',
  ingredientPattern: 'Scampi',
  newQuantity: 1,
  newUnit: 'portion' as const,
  rationale: 'qty=12 was multiplying per-portion cost by 12. One serving = 1 portion.',
};

// ── Onion Rings quantity fix ─────────────────────────────────────────────
// portions_per_pack=10 on a 750g bag means each "portion" is a serving of
// ~6 rings (75g). The dish has qty=6 treating it as 6 servings (360 rings!).
// Should be qty=1 (one serving of 6 rings).
const ONION_RINGS_FIX = {
  dishName: '6 Onion Rings',
  ingredientPattern: 'Onion Rings',
  newQuantity: 1,
  newUnit: 'portion' as const,
  rationale: 'portions_per_pack=10 = 10 servings of ~6 rings. qty should be 1 serving, not 6.',
};

async function run() {
  console.log(DRY_RUN
    ? '🔍 DRY RUN — no changes will be written\n'
    : '🚀 COMMIT MODE — changes will be applied\n'
  );

  // ── Fix 1: Set portions_per_pack on ingredients ────────────────────────
  console.log('═══ INGREDIENT portions_per_pack FIXES ═══\n');

  for (const fix of INGREDIENT_FIXES) {
    const { data: ingredients, error } = await supabase
      .from('menu_ingredients')
      .select('id, name, pack_cost, pack_size, pack_size_unit, portions_per_pack')
      .ilike('name', `%${fix.namePattern}%`);

    if (error || !ingredients || ingredients.length === 0) {
      console.log(`  ⚠️  No ingredient found matching "${fix.namePattern}"`);
      continue;
    }

    for (const ing of ingredients) {
      const currentPPP = ing.portions_per_pack;
      const currentUnitCost = currentPPP
        ? (Number(ing.pack_cost) / Number(currentPPP)).toFixed(4)
        : `${(Number(ing.pack_cost) / (Number(ing.pack_size) || 1)).toFixed(4)} (FALLBACK)`;
      const newUnitCost = (Number(ing.pack_cost) / fix.portions_per_pack).toFixed(4);

      console.log(`  ${ing.name}`);
      console.log(`    pack_cost: £${ing.pack_cost} | pack_size: ${ing.pack_size} ${ing.pack_size_unit}`);
      console.log(`    portions_per_pack: ${currentPPP ?? 'NULL'} → ${fix.portions_per_pack}`);
      console.log(`    unit_cost: £${currentUnitCost} → £${newUnitCost}`);
      console.log(`    rationale: ${fix.rationale}`);

      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('menu_ingredients')
          .update({ portions_per_pack: fix.portions_per_pack })
          .eq('id', ing.id);

        console.log(updateErr ? `    ❌ FAILED: ${updateErr.message}` : `    ✅ Updated`);
      }
    }
    console.log();
  }

  // ── Fix 2: Scampi quantity ─────────────────────────────────────────────
  console.log('═══ DISH-INGREDIENT QUANTITY FIXES ═══\n');

  for (const fix of [SCAMPI_FIX, ONION_RINGS_FIX]) {
    // Find the dish
    const { data: dishes } = await supabase
      .from('menu_dishes')
      .select('id, name')
      .eq('name', fix.dishName);

    if (!dishes || dishes.length === 0) {
      console.log(`  ⚠️  Dish "${fix.dishName}" not found`);
      continue;
    }

    const dish = dishes[0];

    // Find the ingredient link
    const { data: links } = await supabase
      .from('menu_dish_ingredients')
      .select('id, quantity, unit, ingredient:menu_ingredients(id, name)')
      .eq('dish_id', dish.id);

    const link = links?.find((l: any) =>
      (l.ingredient as any)?.name?.toLowerCase().includes(fix.ingredientPattern.toLowerCase())
    );

    if (!link) {
      console.log(`  ⚠️  No ingredient matching "${fix.ingredientPattern}" on dish "${fix.dishName}"`);
      continue;
    }

    const ingName = (link.ingredient as any)?.name;
    console.log(`  ${fix.dishName} → ${ingName}`);
    console.log(`    quantity: ${link.quantity} ${link.unit} → ${fix.newQuantity} ${fix.newUnit}`);
    console.log(`    rationale: ${fix.rationale}`);

    if (!DRY_RUN) {
      const { error: updateErr } = await supabase
        .from('menu_dish_ingredients')
        .update({ quantity: fix.newQuantity, unit: fix.newUnit })
        .eq('id', link.id);

      console.log(updateErr ? `    ❌ FAILED: ${updateErr.message}` : `    ✅ Updated`);
    }
    console.log();
  }

  // ── Post-fix: show expected impact ─────────────────────────────────────
  console.log('═══ EXPECTED IMPACT ═══\n');
  console.log('  After these fixes, DB triggers will auto-recalculate portion_cost and gp_pct.');
  console.log('  Expected improvements:');
  console.log('    Scampi & Chips:              -48% → ~85% GP');
  console.log('    Bangers & Mash:               14% → ~69% GP');
  console.log('    Spinach & Ricotta Cannelloni:  22% → ~70% GP');
  console.log('    Chicken Katsu Curry:           24% → ~60% GP');
  console.log('    Katsu Chicken Burger:          37% → ~75% GP');
  console.log('    Chunky Chips:                  64% → ~94% GP');
  console.log('    6 Onion Rings:                 57% → ~94% GP');
  console.log();
  console.log('  Items needing kitchen verification:');
  console.log('    Chicken Goujons (2kg bag): is portions_per_pack really 12? If 24, cost halves.');
  console.log('    Apple Crumble (66% GP): correctly costed, just below target.');
  console.log('    Lamb Shank (63% GP): correctly costed, premium protein.');

  if (DRY_RUN) {
    console.log('\n  Run with --commit to apply these changes.');
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1 });
