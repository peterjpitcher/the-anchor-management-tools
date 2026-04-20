/**
 * Adds the 6 burger add-ons from the March 2026 Main Menu PDF as regular
 * menu_dishes under a new "Burger Add-ons" category on the Main Menu.
 *
 * Safe to re-run: checks for existing category / dishes / assignments.
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
const CATEGORY_CODE = 'burger_addons';
const CATEGORY_NAME = 'Burger Add-ons';
const CATEGORY_SORT_ORDER = 45;

type AddOn = {
  name: string;
  slug: string;
  description: string;
  selling_price: number;
  dietary_flags: string[];
  sort_order: number;
};

const addOns: AddOn[] = [
  {
    name: 'Add onion rings',
    slug: 'add-onion-rings',
    description: 'Add onion rings to your burger.',
    selling_price: 1,
    dietary_flags: ['vegan', 'vegetarian'],
    sort_order: 1,
  },
  {
    name: 'Add mature cheddar',
    slug: 'add-mature-cheddar',
    description: 'Add a slice of mature cheddar to your burger.',
    selling_price: 1,
    dietary_flags: ['vegetarian'],
    sort_order: 2,
  },
  {
    name: 'Upgrade to cheesy chips',
    slug: 'upgrade-to-cheesy-chips',
    description: 'Swap your burger chips for cheesy chips.',
    selling_price: 2,
    dietary_flags: ['vegetarian'],
    sort_order: 3,
  },
  {
    name: 'Upgrade to sweet potato fries',
    slug: 'upgrade-to-sweet-potato-fries',
    description: 'Swap your burger chips for sweet potato fries.',
    selling_price: 2,
    dietary_flags: ['vegan', 'vegetarian'],
    sort_order: 4,
  },
  {
    name: 'Add crispy bacon',
    slug: 'add-crispy-bacon',
    description: 'Add crispy bacon to your burger.',
    selling_price: 2,
    dietary_flags: [],
    sort_order: 5,
  },
  {
    name: 'Add hash brown',
    slug: 'add-hash-brown',
    description: 'Add a hash brown to your burger.',
    selling_price: 2,
    dietary_flags: ['vegetarian'],
    sort_order: 6,
  },
];

async function ensureCategory(): Promise<string> {
  const { data: existing } = await supabase
    .from('menu_categories')
    .select('id, name')
    .eq('code', CATEGORY_CODE)
    .maybeSingle();
  if (existing) {
    console.log(`  - category exists: ${existing.name} (id=${existing.id})`);
    return existing.id;
  }
  const { data: inserted, error } = await supabase
    .from('menu_categories')
    .insert({
      code: CATEGORY_CODE,
      name: CATEGORY_NAME,
      description: 'Main Menu > Burger Add-ons',
      sort_order: CATEGORY_SORT_ORDER,
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`create category failed: ${error.message}`);
  console.log(`  + created category "${CATEGORY_NAME}" (id=${inserted.id}, sort_order=${CATEGORY_SORT_ORDER})`);
  return inserted.id;
}

async function upsertAddOn(addOn: AddOn, categoryId: string) {
  const { data: existing } = await supabase
    .from('menu_dishes')
    .select('id, name, selling_price')
    .eq('name', addOn.name)
    .maybeSingle();

  let dishId = existing?.id;
  if (existing) {
    console.log(`  - dish exists: "${addOn.name}" (id=${existing.id}, £${existing.selling_price})`);
  } else {
    const { data: inserted, error } = await supabase
      .from('menu_dishes')
      .insert({
        name: addOn.name,
        slug: addOn.slug,
        description: addOn.description,
        selling_price: addOn.selling_price,
        target_gp_pct: 0.7,
        portion_cost: 0,
        gp_pct: 1,
        allergen_flags: [],
        dietary_flags: addOn.dietary_flags,
        is_active: true,
        is_sunday_lunch: false,
        removable_allergens: [],
        is_modifiable_for: {},
        allergen_verified: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`insert "${addOn.name}" failed: ${error.message}`);
    dishId = inserted.id;
    console.log(`  + inserted "${addOn.name}" (id=${dishId}, £${addOn.selling_price})`);
  }

  const { data: existingAssn } = await supabase
    .from('menu_dish_menu_assignments')
    .select('id')
    .eq('dish_id', dishId)
    .eq('menu_id', MAIN_MENU_ID)
    .eq('category_id', categoryId)
    .maybeSingle();
  if (existingAssn) {
    console.log(`    - assignment already present`);
    return;
  }
  const { error: assnErr } = await supabase
    .from('menu_dish_menu_assignments')
    .insert({
      dish_id: dishId,
      menu_id: MAIN_MENU_ID,
      category_id: categoryId,
      sort_order: addOn.sort_order,
      is_special: false,
      is_default_side: false,
    });
  if (assnErr) throw new Error(`assign "${addOn.name}" failed: ${assnErr.message}`);
  console.log(`    + assigned to Main Menu / ${CATEGORY_NAME} (sort_order=${addOn.sort_order})`);
}

async function main() {
  console.log('=== 1. Ensuring category exists ===');
  const categoryId = await ensureCategory();

  console.log('\n=== 2. Adding add-on dishes ===');
  for (const a of addOns) {
    await upsertAddOn(a, categoryId);
  }

  console.log('\n=== 3. Verification ===');
  const { data: assignments } = await supabase
    .from('menu_dish_menu_assignments')
    .select('sort_order, menu_dishes!inner(name, selling_price, is_active, dietary_flags)')
    .eq('menu_id', MAIN_MENU_ID)
    .eq('category_id', categoryId)
    .order('sort_order');

  console.log(`  ${CATEGORY_NAME}: ${assignments?.length ?? 0} items`);
  for (const a of (assignments ?? []) as any[]) {
    const d = a.menu_dishes;
    const flags = (d.dietary_flags ?? []).length ? ` [${(d.dietary_flags as string[]).join(',')}]` : '';
    console.log(`    ${a.sort_order}. £${Number(d.selling_price).toFixed(2)}  ${d.name}${flags}`);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
