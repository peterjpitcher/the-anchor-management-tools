/**
 * Update all dish selling prices and names to match the March 2026 printed menu.
 * Also fixes broken target_gp_pct values (6500% → 65%).
 *
 * Run with: npx tsx scripts/database/update-menu-prices-march2026.ts
 * Add --dry-run to preview changes without writing.
 * Add --commit to actually apply changes.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DRY_RUN = !process.argv.includes('--commit');

// ── March 2026 Menu: correct prices ─────────────────────────────────────
// Source: "Main Menu - March 2026.pdf"
// Format: { currentDbName: { price, newName? } }
const MENU_CORRECTIONS: Record<string, { price: number; newName?: string }> = {
  // British Pub Classics
  'Fish & Chips':                    { price: 15.00 },
  'Half Fish & Chips':               { price: 12.00 },
  'Scampi & Chips':                  { price: 13.00 },
  'Jumbo Sausage & Chips':           { price: 13.00 },
  'Sausage & Mash':                  { price: 14.00, newName: 'Bangers & Mash' },

  // Traditional British Pies
  'Beef & Ale Pie':                  { price: 16.00 },
  'Chicken & Wild Mushroom Pie':     { price: 15.00 },
  'Chicken, Ham Hock & Leek Pie':    { price: 15.00 },
  'Butternut Squash, Mixed Bean & Cheese Pie': { price: 15.00, newName: 'Butternut Squash, Mixed Bean & Mature Cheddar Pie' },

  // House Burgers
  'Beef Burger':                     { price: 11.00, newName: 'Classic Beef Burger' },
  'Chicken Burger':                  { price: 11.00 },
  'Spicy Chicken Burger':            { price: 11.00 },
  'Vegetable Burger':                { price: 11.00, newName: 'Garden Veg Burger' },
  'Beef Stack':                      { price: 14.00 },
  'Chicken Stack':                   { price: 14.00 },
  'Spicy Chicken Stack':             { price: 14.00 },
  'Veggie Stack':                    { price: 14.00, newName: 'Garden Stack' },
  'Katsu Chicken Burger':            { price: 14.00 },

  // Comfort Favourites
  'Lasagne':                         { price: 15.00 },
  "Mac 'N Cheese":                   { price: 14.00, newName: 'Mac & Cheese' },
  'Spinach & Ricotta Cannelloni':    { price: 14.00 },
  'Chicken Katsu Curry':             { price: 14.00 },

  // Stone-Baked Pizza
  'Rustic Classic':                  { price: 12.00 },
  'Simply Salami':                   { price: 13.00 },
  'Fully Loaded':                    { price: 14.00 },
  'Nice & Spicy':                    { price: 14.00 },
  'The Garden Club':                 { price: 13.00 },
  'Smoked Chilli Chicken':           { price: 14.00 },
  'Chicken & Pesto':                 { price: 14.00 },
  'Barbecue Chicken':                { price: 14.00 },
  'Garlic Bread':                    { price: 10.00 },
  'Garlic Bread with Mozzarella':    { price: 12.00 },

  // Wraps & Smaller Plates
  'Chicken Goujon Wrap with Chips':  { price: 10.00, newName: 'Chicken Goujon Wrap' },
  'Fish Finger Wrap with Chips':     { price: 10.00, newName: 'Fish Finger Wrap' },
  '4 Chicken Goujons with Chips':    { price: 9.00, newName: 'Chicken Goujons & Chips' },
  '5 Salt & Chilli Squid with Chips': { price: 9.00, newName: 'Salt & Chilli Squid & Chips' },
  '3 Fish Fingers with Chips':       { price: 9.00, newName: 'Fish Fingers & Chips' },
  'Chips':                           { price: 4.00 },
  'Chunky Chips':                    { price: 5.00 },
  'Cheesy Chips':                    { price: 6.00 },
  'Sweet Potato Fries':              { price: 5.00 },
  '6 Onion Rings':                   { price: 4.00 },

  // Proper Puddings
  'Sticky Toffee Pudding':           { price: 6.00 },
  'Apple Crumble':                   { price: 6.00 },
  'Chocolate Fudge Brownie':         { price: 6.00 },
  'Chocolate Fudge Cake':            { price: 6.00 },
  'Ice Cream Sundae':                { price: 5.00 },

  // Hot Drinks
  'Americano':                       { price: 3.00 },
  'Latte':                           { price: 3.00 },
  'Cappuccino':                      { price: 3.00 },
  'Hot Chocolate':                   { price: 3.00 },
  'Individual Pot of Tea':           { price: 3.00 },
};

// ── Broken target_gp_pct values ──────────────────────────────────────────
// These have 65.00 stored instead of 0.65 (renders as 6500%)
const TARGET_GP_FIXES: string[] = [
  'Butternut Squash, Mixed Bean & Cheese Pie',  // will be renamed above
  'Chicken, Ham Hock & Leek Pie',
  'Chocolate Fudge Cake',
];

async function run() {
  console.log(DRY_RUN
    ? '🔍 DRY RUN — no changes will be written\n'
    : '🚀 COMMIT MODE — changes will be applied\n'
  );

  // Fetch all dishes
  const { data: dishes, error } = await supabase
    .from('menu_dishes')
    .select('id, name, selling_price, target_gp_pct, is_active')
    .order('name');

  if (error || !dishes) {
    console.error('Failed to fetch dishes:', error);
    process.exit(1);
  }

  let priceUpdates = 0;
  let nameUpdates = 0;
  let targetFixes = 0;
  let notFound: string[] = [];
  const matched = new Set<string>();

  // ── Phase 1: Price & name corrections ──────────────────────────────────
  console.log('═══ PRICE & NAME CORRECTIONS ═══\n');

  for (const [dbName, correction] of Object.entries(MENU_CORRECTIONS)) {
    const dish = dishes.find(d => d.name === dbName);
    if (!dish) {
      notFound.push(dbName);
      continue;
    }
    matched.add(dish.id);

    const currentPrice = Number(dish.selling_price);
    const priceChanged = Math.abs(currentPrice - correction.price) > 0.001;
    const nameChanged = correction.newName && correction.newName !== dish.name;

    if (!priceChanged && !nameChanged) {
      continue; // already correct
    }

    const updates: Record<string, unknown> = {};
    const changes: string[] = [];

    if (priceChanged) {
      updates.selling_price = correction.price;
      changes.push(`price: £${currentPrice.toFixed(2)} → £${correction.price.toFixed(2)}`);
      priceUpdates++;
    }
    if (nameChanged) {
      updates.name = correction.newName;
      changes.push(`name: "${dbName}" → "${correction.newName}"`);
      nameUpdates++;
    }

    console.log(`  ${dish.name}${dish.is_active ? '' : ' [INACTIVE]'}`);
    for (const c of changes) console.log(`    ${c}`);

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from('menu_dishes')
        .update(updates)
        .eq('id', dish.id);

      if (updateError) {
        console.error(`    ❌ FAILED: ${updateError.message}`);
      } else {
        console.log(`    ✅ Updated`);
      }
    }
  }

  // ── Phase 2: Fix broken target_gp_pct ──────────────────────────────────
  console.log('\n═══ TARGET GP% FIXES ═══\n');

  for (const dish of dishes) {
    const tgt = Number(dish.target_gp_pct);
    if (tgt > 1) {
      // Stored as 65 instead of 0.65
      const corrected = tgt / 100;
      console.log(`  ${dish.name}: target_gp_pct ${tgt} → ${corrected}`);
      targetFixes++;

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('menu_dishes')
          .update({ target_gp_pct: corrected })
          .eq('id', dish.id);

        if (updateError) {
          console.error(`    ❌ FAILED: ${updateError.message}`);
        } else {
          console.log(`    ✅ Fixed`);
        }
      }
    }
  }

  // ── Phase 3: Check for dishes on menu but missing from DB ──────────────
  console.log('\n═══ MENU ITEMS NOT FOUND IN DB ═══\n');
  if (notFound.length === 0) {
    console.log('  All menu items matched a DB record.');
  } else {
    for (const name of notFound) {
      console.log(`  ⚠️  "${name}" — not found in database`);
    }
  }

  // ── Phase 4: DB dishes NOT on the printed menu ─────────────────────────
  console.log('\n═══ DB DISHES NOT ON PRINTED MENU ═══\n');
  const unmatchedDishes = dishes.filter(d =>
    !matched.has(d.id) &&
    d.is_active &&
    Number(d.selling_price) > 0 // skip sauces/condiments
  );
  if (unmatchedDishes.length === 0) {
    console.log('  All active priced dishes matched the menu.');
  } else {
    for (const d of unmatchedDishes) {
      console.log(`  ❓ "${d.name}" — £${d.selling_price} (active but not on printed menu)`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══ SUMMARY ═══\n');
  console.log(`  Price updates:      ${priceUpdates}`);
  console.log(`  Name corrections:   ${nameUpdates}`);
  console.log(`  Target GP% fixes:   ${targetFixes}`);
  console.log(`  Not found in DB:    ${notFound.length}`);
  console.log(`  Unmatched DB items: ${unmatchedDishes.length}`);

  if (DRY_RUN && (priceUpdates + nameUpdates + targetFixes) > 0) {
    console.log('\n  Run with --commit to apply these changes.');
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1 });
