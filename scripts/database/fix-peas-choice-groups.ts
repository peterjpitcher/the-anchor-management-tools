/**
 * Fix peas to be a choice group instead of both removable.
 * Garden peas and mushy peas should be choice/Peas — customer picks one.
 *
 * Also fixes gravy on Sausage & Mash — should be included, not removable.
 * Gravy on pies is removable (customer can ask for no gravy).
 *
 * Run with: npx tsx scripts/database/fix-peas-choice-groups.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fix() {
  console.log('=== Fixing Peas Choice Groups ===\n');

  // Get all dish-ingredient rows — we'll filter peas in JS
  const { data: allRows, error } = await supabase
    .from('menu_dish_ingredients')
    .select('id, dish_id, ingredient_id, inclusion_type, option_group, ingredient:menu_ingredients(name), dish:menu_dishes(name)');

  if (error || !allRows) {
    console.error('Failed to query:', error);
    return;
  }

  // Filter to actual pea rows (the or filter on joins can be loose)
  const peaRows = allRows.filter(r => {
    const name = (r.ingredient as any)?.name || '';
    return /garden.*pea/i.test(name) || /mushy.*pea/i.test(name);
  });

  console.log(`Found ${peaRows.length} pea ingredient rows across dishes.\n`);

  let updated = 0;
  const affectedDishIds = new Set<string>();

  for (const row of peaRows) {
    const dishName = (row.dish as any)?.name || 'Unknown';
    const ingName = (row.ingredient as any)?.name || 'Unknown';

    // Skip if already correctly set
    if (row.inclusion_type === 'choice' && row.option_group === 'Peas') {
      console.log(`  ${dishName} | ${ingName} — already choice/Peas, skipping`);
      continue;
    }

    console.log(`  ${dishName} | ${ingName} — ${row.inclusion_type}/${row.option_group || 'none'} → choice/Peas`);

    const { error: updateErr } = await supabase
      .from('menu_dish_ingredients')
      .update({
        inclusion_type: 'choice',
        option_group: 'Peas',
        upgrade_price: null,
      })
      .eq('id', row.id);

    if (updateErr) {
      console.error(`    FAILED: ${updateErr.message}`);
    } else {
      updated++;
      affectedDishIds.add(row.dish_id);
    }
  }

  // Also fix gravy on Sausage & Mash — should be included, not removable
  // (menu: "served on creamy mash with crispy onions and rich onion gravy")
  console.log('\nFixing gravy on Sausage & Mash (should be included, not removable)...');
  const { data: gravyRows } = await supabase
    .from('menu_dish_ingredients')
    .select('id, dish_id, inclusion_type, ingredient:menu_ingredients(name), dish:menu_dishes(name)')
    .ilike('ingredient.name', '%gravy%');

  if (gravyRows) {
    for (const row of gravyRows) {
      const dishName = (row.dish as any)?.name || '';
      if (/sausage.*mash/i.test(dishName) && row.inclusion_type !== 'included') {
        console.log(`  ${dishName} | ${(row.ingredient as any)?.name} — ${row.inclusion_type} → included`);
        await supabase
          .from('menu_dish_ingredients')
          .update({ inclusion_type: 'included', option_group: null })
          .eq('id', row.id);
        affectedDishIds.add(row.dish_id);
        updated++;
      }
    }
  }

  // Refresh GP for all affected dishes
  console.log(`\nRefreshing GP calculations for ${affectedDishIds.size} affected dish(es)...`);
  for (const dishId of affectedDishIds) {
    const { error: refreshErr } = await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: dishId });
    if (refreshErr) console.error(`  Failed: ${refreshErr.message}`);
  }

  console.log(`\n=== Done. Updated ${updated} rows across ${affectedDishIds.size} dishes. ===`);
}

fix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
