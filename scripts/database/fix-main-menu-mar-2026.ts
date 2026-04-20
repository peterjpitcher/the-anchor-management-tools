/**
 * Fixes Main Menu vs March 2026 PDF discrepancies:
 *   1. Add "Chicken, Ham Hock & Leek Pie" £15 (Mains)
 *   2. Add "Butternut Squash, Mixed Bean & Mature Cheddar Pie" £15 (V, Mains)
 *   3. Add "Chocolate Fudge Cake" £6 (V, Desserts)
 *   4. Rename "Garlic Bread with Mozzarella" → "Garlic Bread + Mozzarella"
 *
 * Safe to re-run: each step checks for existing records first.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAIN_MENU_ID = 'a8c763f8-7ab5-4ff6-9b7d-48d1cfbdaa0f';
const MAINS_CAT_ID = '332d2efa-6921-44cd-a8ca-13d18f33e9ae';
const DESSERTS_CAT_ID = '6dca2d07-f4c8-429e-b85a-71a1f54fa1c7';

type NewDish = {
  name: string;
  slug: string;
  description: string;
  selling_price: number;
  dietary_flags: string[];
  category_id: string;
  sort_order: number;
};

const newDishes: NewDish[] = [
  {
    name: 'Chicken, Ham Hock & Leek Pie',
    slug: 'chicken-ham-hock-leek-pie',
    description:
      'Chicken, slow-cooked ham hock and tender leeks in a rich creamy sauce, baked in crisp pastry.',
    selling_price: 15,
    dietary_flags: [],
    category_id: MAINS_CAT_ID,
    sort_order: 13,
  },
  {
    name: 'Butternut Squash, Mixed Bean & Mature Cheddar Pie',
    slug: 'butternut-squash-mixed-bean-mature-cheddar-pie',
    description:
      'Butternut squash, mixed beans and mature cheddar in a gently spiced tomato sauce, baked in crisp pastry.',
    selling_price: 15,
    dietary_flags: ['vegetarian'],
    category_id: MAINS_CAT_ID,
    sort_order: 14,
  },
  {
    name: 'Chocolate Fudge Cake',
    slug: 'chocolate-fudge-cake',
    description: 'Hot chocolate fudge cake served with cream or custard.',
    selling_price: 6,
    dietary_flags: ['vegetarian'],
    category_id: DESSERTS_CAT_ID,
    sort_order: 5,
  },
];

async function upsertDish(dish: NewDish) {
  const { data: existing } = await supabase
    .from('menu_dishes')
    .select('id, name, selling_price, is_active')
    .eq('name', dish.name)
    .maybeSingle();

  let dishId = existing?.id;
  if (existing) {
    console.log(`  - dish already exists: "${dish.name}" (id=${existing.id}, £${existing.selling_price}, active=${existing.is_active})`);
  } else {
    const { data: inserted, error } = await supabase
      .from('menu_dishes')
      .insert({
        name: dish.name,
        slug: dish.slug,
        description: dish.description,
        selling_price: dish.selling_price,
        target_gp_pct: 0.7,
        portion_cost: 0,
        gp_pct: 1,
        allergen_flags: [],
        dietary_flags: dish.dietary_flags,
        is_active: true,
        is_sunday_lunch: false,
        removable_allergens: [],
        is_modifiable_for: {},
        allergen_verified: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`insert dish "${dish.name}" failed: ${error.message}`);
    dishId = inserted.id;
    console.log(`  + inserted dish "${dish.name}" (id=${dishId}, £${dish.selling_price})`);
  }

  const { data: existingAssn } = await supabase
    .from('menu_dish_menu_assignments')
    .select('id')
    .eq('dish_id', dishId)
    .eq('menu_id', MAIN_MENU_ID)
    .eq('category_id', dish.category_id)
    .maybeSingle();

  if (existingAssn) {
    console.log(`    - assignment already present (id=${existingAssn.id})`);
  } else {
    const { error: assnErr } = await supabase
      .from('menu_dish_menu_assignments')
      .insert({
        dish_id: dishId,
        menu_id: MAIN_MENU_ID,
        category_id: dish.category_id,
        sort_order: dish.sort_order,
        is_special: false,
        is_default_side: false,
      });
    if (assnErr) throw new Error(`insert assignment "${dish.name}" failed: ${assnErr.message}`);
    console.log(`    + assigned to Main Menu (sort_order=${dish.sort_order})`);
  }
}

async function renameGarlicBread() {
  const { data: row } = await supabase
    .from('menu_dishes')
    .select('id, name')
    .in('name', ['Garlic Bread with Mozzarella', 'Garlic Bread + Mozzarella'])
    .maybeSingle();

  if (!row) {
    console.log('  - no garlic bread + mozzarella dish found, skipping');
    return;
  }
  if (row.name === 'Garlic Bread + Mozzarella') {
    console.log(`  - already named "Garlic Bread + Mozzarella" (id=${row.id})`);
    return;
  }

  const { error } = await supabase
    .from('menu_dishes')
    .update({ name: 'Garlic Bread + Mozzarella' })
    .eq('id', row.id);
  if (error) throw new Error(`rename failed: ${error.message}`);
  console.log(`  ~ renamed "${row.name}" → "Garlic Bread + Mozzarella" (id=${row.id}, slug unchanged)`);
}

async function main() {
  console.log('=== 1. Adding missing dishes to Main Menu ===');
  for (const d of newDishes) {
    await upsertDish(d);
  }

  console.log('\n=== 2. Renaming Garlic Bread + Mozzarella ===');
  await renameGarlicBread();

  console.log('\n=== 3. Final verification ===');
  const { data: assignments } = await supabase
    .from('menu_dish_menu_assignments')
    .select('menu_dishes!inner(name, selling_price, is_active)')
    .eq('menu_id', MAIN_MENU_ID);

  const active = ((assignments ?? []) as any[])
    .map(a => a.menu_dishes)
    .filter(d => d.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));
  console.log(`  Active Main Menu dishes: ${active.length}`);
  for (const d of active) console.log(`    £${Number(d.selling_price).toFixed(2)}  ${d.name}`);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
