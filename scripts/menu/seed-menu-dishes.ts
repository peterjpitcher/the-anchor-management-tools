#!/usr/bin/env ts-node

/**
 * Seed menu dishes from existing Sunday lunch records and temp/food.json
 *
 * Usage:
 *   npx tsx scripts/menu/seed-menu-dishes.ts
 *
 * Requires:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

type Nullable<T> = T | null | undefined;

interface FoodJson {
  categories: Array<{
    id: string;
    title: string;
    sections: Array<{
      title?: string;
      items: Array<{
        name: string;
        price?: string;
        description?: string;
        allergens?: string[];
        vegetarian?: boolean;
        vegan?: boolean;
      }>;
    }>;
  }>;
}

function invariant(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function toSlug(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : `dish-${Date.now()}`;
}

function parsePrice(raw: Nullable<string>): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  return cleaned ? Number.parseFloat(cleaned) : 0;
}

function toDietaryFlags(item: { vegetarian?: boolean; vegan?: boolean }): string[] {
  const flags: string[] = [];
  if (item.vegan) flags.push('vegan');
  if (item.vegetarian) flags.push('vegetarian');
  return flags;
}

async function ensureUniqueSlug(supabase: ReturnType<typeof createClient>, base: string) {
  let slug = base;
  let suffix = 1;
  while (true) {
    const { data } = await supabase
      .from('menu_dishes')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${base}-${suffix++}`;
  }
}

async function seedSundayLunchDishes(supabase: ReturnType<typeof createClient>) {
  console.log('Seeding Sunday lunch dishes...');
  const { data: menu } = await supabase
    .from('menu_menus')
    .select('id')
    .eq('code', 'sunday_lunch')
    .single();
  invariant(menu, 'Sunday lunch menu missing');

  const { data: mainsCategory } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('code', 'sunday_lunch_mains')
    .single();
  const { data: sidesCategory } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('code', 'sunday_lunch_sides')
    .single();
  invariant(mainsCategory && sidesCategory, 'Sunday lunch categories missing');

  const { data: items, error } = await supabase
    .from('sunday_lunch_menu_items')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) {
    throw error;
  }
  if (!items || items.length === 0) {
    console.log('No sunday lunch legacy items detected, skipping.');
    return;
  }

  for (const item of items) {
    const price = Number(item.price ?? 0);
    const { data: existing } = await supabase
      .from('menu_dishes')
      .select('id, slug, selling_price, is_active')
      .eq('name', item.name)
      .maybeSingle();

    let dishId: string;
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from('menu_dishes')
        .update({
          description: item.description ?? null,
          selling_price: price,
          allergen_flags: item.allergens ?? [],
          dietary_flags: item.dietary_info ?? [],
          is_active: item.is_active ?? true,
          is_sunday_lunch: true,
        })
        .eq('id', existing.id)
        .select('id')
        .single();
      if (updateError) {
        throw updateError;
      }
      dishId = updated.id;
    } else {
      const proposedSlug = toSlug(item.name);
      const slug = await ensureUniqueSlug(supabase, proposedSlug);
      const { data: inserted, error: insertError } = await supabase
        .from('menu_dishes')
        .insert({
          name: item.name,
          slug,
          description: item.description ?? null,
          selling_price: price,
          target_gp_pct: 0.7,
          allergen_flags: item.allergens ?? [],
          dietary_flags: item.dietary_info ?? [],
          is_active: item.is_active ?? true,
          is_sunday_lunch: true,
        })
        .select('id')
        .single();
      if (insertError) {
        throw insertError;
      }
      dishId = inserted.id;
    }

    const categoryId =
      item.category === 'main' ? mainsCategory.id : sidesCategory.id;

    const { error: assignmentError } = await supabase
      .from('menu_dish_menu_assignments')
      .upsert(
        {
          dish_id: dishId,
          menu_id: menu.id,
          category_id: categoryId,
          sort_order: item.display_order ?? 0,
          is_special: false,
          is_default_side:
            item.category !== 'main' && Number(item.price ?? 0) === 0,
        },
        { onConflict: 'dish_id,menu_id,category_id' }
      );
    if (assignmentError) {
      throw assignmentError;
    }

    await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: dishId });
  }
  console.log(`Seeded ${items.length} Sunday lunch dishes.`);
}

async function seedWebsiteMenuFromJson(
  supabase: ReturnType<typeof createClient>,
  jsonPath: string
) {
  console.log(`Seeding website menu from ${jsonPath}...`);
  const fileContents = await fs.promises.readFile(jsonPath, 'utf8');
  const payload = JSON.parse(fileContents) as FoodJson;

  const { data: menu } = await supabase
    .from('menu_menus')
    .select('id')
    .eq('code', 'website_food')
    .single();
  invariant(menu, 'Website food menu missing');

  const { data: categoriesData, error: categoriesError } = await supabase
    .from('menu_categories')
    .select('id, code, name');
  if (categoriesError) {
    throw categoriesError;
  }
  const categoryMap = new Map<string, { id: string; name: string }>();
  categoriesData?.forEach((cat) => categoryMap.set(cat.code, cat));

  const sortCounters = new Map<string, number>();

  for (const category of payload.categories || []) {
    const categoryCode = category.id.replace(/-/g, '_');
    if (!categoryMap.has(categoryCode)) {
      console.warn(
        `Category ${categoryCode} not found in menu_categories, skipping.`
      );
      continue;
    }
    const categoryMeta = categoryMap.get(categoryCode)!;

    for (const section of category.sections || []) {
      const sectionIsSpecial =
        (section.title || '').toLowerCase().includes('special');

      for (const item of section.items || []) {
        const price = parsePrice(item.price);
        const allergens = (item.allergens || []).map((a) => String(a).trim());
        const dietaryFlags = toDietaryFlags(item);

        const { data: existing } = await supabase
          .from('menu_dishes')
          .select('id, slug')
          .eq('name', item.name)
          .maybeSingle();

        let dishId: string;
        if (existing) {
          const { data: updated, error: updateError } = await supabase
            .from('menu_dishes')
            .update({
              description: item.description ?? null,
              selling_price: price,
              allergen_flags: allergens,
              dietary_flags: dietaryFlags,
              is_active: true,
              target_gp_pct: 0.7,
            })
            .eq('id', existing.id)
            .select('id')
            .single();
          if (updateError) throw updateError;
          dishId = updated.id;
        } else {
          const baseSlug = toSlug(item.name);
          const slug = await ensureUniqueSlug(supabase, baseSlug);
          const { data: inserted, error: insertError } = await supabase
            .from('menu_dishes')
            .insert({
              name: item.name,
              slug,
              description: item.description ?? null,
              selling_price: price,
              allergen_flags: allergens,
              dietary_flags: dietaryFlags,
              target_gp_pct: 0.7,
              is_active: true,
            })
            .select('id')
            .single();
          if (insertError) throw insertError;
          dishId = inserted.id;
        }

        const sortOrder =
          (sortCounters.get(categoryCode) ?? 0) + 1;
        sortCounters.set(categoryCode, sortOrder);

        const { error: assignmentError } = await supabase
          .from('menu_dish_menu_assignments')
          .upsert(
            {
              dish_id: dishId,
              menu_id: menu.id,
              category_id: categoryMeta.id,
              sort_order: sortOrder,
              is_special: sectionIsSpecial,
              is_default_side: false,
            },
            { onConflict: 'dish_id,menu_id,category_id' }
          );
        if (assignmentError) {
          throw assignmentError;
        }

        await supabase.rpc('menu_refresh_dish_calculations', {
          p_dish_id: dishId,
        });
      }
    }
  }
  console.log('Website menu seeding complete.');
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  invariant(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is required');
  invariant(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY is required');

  const supabase = createClient(supabaseUrl, serviceKey);

  const foodJsonPath = path.resolve(process.cwd(), 'temp/food.json');
  invariant(fs.existsSync(foodJsonPath), `File not found: ${foodJsonPath}`);

  await seedSundayLunchDishes(supabase);
  await seedWebsiteMenuFromJson(supabase, foodJsonPath);

  console.log('Seeding completed successfully.');
}

main().catch((error) => {
  console.error('Seeding failed:', error);
  process.exitCode = 1;
});
