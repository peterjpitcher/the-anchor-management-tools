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
 *
 * Safety:
 * - DRY RUN by default.
 * - Mutations require --confirm + env gates + explicit caps.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety';

const SCRIPT_NAME = 'seed-menu-dishes';
const RUN_MUTATION_ENV = 'RUN_SEED_MENU_DISHES_MUTATION';
const ALLOW_MUTATION_ENV = 'ALLOW_SEED_MENU_DISHES_MUTATION_SCRIPT';
const HARD_CAP = 500;

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (entry === flag) {
      const next = argv[i + 1];
      return typeof next === 'string' ? next : null;
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length);
    }
  }
  return null;
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid positive integer: ${raw}`);
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

type Args = {
  confirm: boolean;
  dryRun: boolean;
  limit: number | null;
};

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2);
  const confirm = rest.includes('--confirm');
  const dryRun = !confirm || rest.includes('--dry-run');
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'));

  return { confirm, dryRun, limit };
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function assertSupabaseOk(operation: string, error: { message?: string } | null): void {
  if (!error) return;
  throw new Error(`${operation} failed: ${error.message || 'unknown error'}`);
}

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
    const { data, error } = await supabase
      .from('menu_dishes')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    assertSupabaseOk(`[${SCRIPT_NAME}] Check dish slug uniqueness`, error);
    if (!data) return slug;
    slug = `${base}-${suffix++}`;
  }
}

async function seedSundayLunchDishes(supabase: ReturnType<typeof createClient>) {
  console.log('Seeding Sunday lunch dishes...');
  const { data: menu, error: menuError } = await supabase
    .from('menu_menus')
    .select('id')
    .eq('code', 'sunday_lunch')
    .single();
  assertSupabaseOk(`[${SCRIPT_NAME}] Load sunday_lunch menu`, menuError);
  invariant(menu, 'Sunday lunch menu missing');

  const { data: mainsCategory, error: mainsError } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('code', 'sunday_lunch_mains')
    .single();
  assertSupabaseOk(`[${SCRIPT_NAME}] Load sunday_lunch_mains category`, mainsError);

  const { data: sidesCategory, error: sidesError } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('code', 'sunday_lunch_sides')
    .single();
  assertSupabaseOk(`[${SCRIPT_NAME}] Load sunday_lunch_sides category`, sidesError);
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
    const { data: existing, error: existingError } = await supabase
      .from('menu_dishes')
      .select('id, slug, selling_price, is_active')
      .eq('name', item.name)
      .maybeSingle();
    assertSupabaseOk(`[${SCRIPT_NAME}] Lookup existing menu dish`, existingError);

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

    const { error: refreshError } = await supabase.rpc('menu_refresh_dish_calculations', {
      p_dish_id: dishId,
    });
    assertSupabaseOk(`[${SCRIPT_NAME}] Refresh dish calculations`, refreshError);
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

  const { data: menu, error: menuError } = await supabase
    .from('menu_menus')
    .select('id')
    .eq('code', 'website_food')
    .single();
  assertSupabaseOk(`[${SCRIPT_NAME}] Load website_food menu`, menuError);
  invariant(menu, 'Website food menu missing');

  const { data: categoriesData, error: categoriesError } = await supabase
    .from('menu_categories')
    .select('id, code, name');
  if (categoriesError) {
    throw categoriesError;
  }
  const categoryMap = new Map<string, { id: string; name: string }>();
  categoriesData?.forEach((cat) => categoryMap.set(cat.code, cat));

  const missingCategoryCodes = (payload.categories || [])
    .map((category) => String(category?.id || '').replace(/-/g, '_'))
    .filter((code) => code && !categoryMap.has(code));

  if (missingCategoryCodes.length > 0) {
    throw new Error(
      `Website menu seed blocked: missing menu_categories code(s): ${missingCategoryCodes.slice(0, 5).join(', ')}`
    );
  }

  const sortCounters = new Map<string, number>();

  for (const category of payload.categories || []) {
    const categoryCode = category.id.replace(/-/g, '_');
    const categoryMeta = categoryMap.get(categoryCode)!;

    for (const section of category.sections || []) {
      const sectionIsSpecial =
        (section.title || '').toLowerCase().includes('special');

      for (const item of section.items || []) {
        const price = parsePrice(item.price);
        const allergens = (item.allergens || []).map((a) => String(a).trim());
        const dietaryFlags = toDietaryFlags(item);

        const { data: existing, error: existingError } = await supabase
          .from('menu_dishes')
          .select('id, slug')
          .eq('name', item.name)
          .maybeSingle();
        assertSupabaseOk(`[${SCRIPT_NAME}] Lookup existing menu dish`, existingError);

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

        const { error: refreshError } = await supabase.rpc('menu_refresh_dish_calculations', {
          p_dish_id: dishId,
        });
        assertSupabaseOk(`[${SCRIPT_NAME}] Refresh dish calculations`, refreshError);
      }
    }
  }
  console.log('Website menu seeding complete.');
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  const args = parseArgs(process.argv);
  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`);

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabase = createClient(supabaseUrl, serviceKey);

  const foodJsonPath = path.resolve(process.cwd(), 'temp/food.json');
  invariant(fs.existsSync(foodJsonPath), `File not found: ${foodJsonPath}`);

  const { data: legacyItems, error: legacyError } = await supabase
    .from('sunday_lunch_menu_items')
    .select('id')
    .order('display_order', { ascending: true });
  assertSupabaseOk(`[${SCRIPT_NAME}] Load legacy Sunday lunch items`, legacyError);

  const legacyCount = Array.isArray(legacyItems) ? legacyItems.length : 0;

  const fileContents = await fs.promises.readFile(foodJsonPath, 'utf8');
  const payload = JSON.parse(fileContents) as FoodJson;

  const { data: categoriesData, error: categoriesError } = await supabase
    .from('menu_categories')
    .select('code');
  assertSupabaseOk(`[${SCRIPT_NAME}] Load menu_categories codes`, categoriesError);

  const categoryCodes = new Set((categoriesData ?? []).map((row) => row.code).filter(Boolean));
  const missingCategoryCodes = (payload.categories || [])
    .map((category) => String(category?.id || '').replace(/-/g, '_'))
    .filter((code) => code && !categoryCodes.has(code));

  if (missingCategoryCodes.length > 0) {
    throw new Error(
      `[${SCRIPT_NAME}] blocked: missing menu_categories code(s): ${missingCategoryCodes.slice(0, 5).join(', ')}`
    );
  }

  const websiteCount = (payload.categories || []).reduce((sum, category) => {
    const sections = Array.isArray(category?.sections) ? category.sections : [];
    const itemsCount = sections.reduce((sectionSum, section) => {
      const items = Array.isArray(section?.items) ? section.items : [];
      return sectionSum + items.length;
    }, 0);
    return sum + itemsCount;
  }, 0);

  const plannedDishCount = legacyCount + websiteCount;

  console.log(`[${SCRIPT_NAME}] Planned legacy dishes: ${legacyCount}`);
  console.log(`[${SCRIPT_NAME}] Planned website dishes: ${websiteCount}`);
  console.log(`[${SCRIPT_NAME}] Planned total dish upserts: ${plannedDishCount}`);

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows inserted/updated.`);
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`);
    console.log(`- Pass --confirm`);
    console.log(`- Set ${RUN_MUTATION_ENV}=true`);
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`);
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP}) where n >= ${plannedDishCount}`);
    return;
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`);
  }

  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
    );
  }

  assertScriptMutationAllowed({
    scriptName: SCRIPT_NAME,
    envVar: ALLOW_MUTATION_ENV,
  });

  const limit = args.limit;
  if (!limit) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`);
  }
  if (limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`);
  }
  if (plannedDishCount > limit) {
    throw new Error(`[${SCRIPT_NAME}] planned dish upserts (${plannedDishCount}) exceeds --limit (${limit})`);
  }

  await seedSundayLunchDishes(supabase);
  await seedWebsiteMenuFromJson(supabase, foodJsonPath);

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Seeding completed successfully.`);
}

main().catch((error) => {
  console.error('Seeding failed:', error);
  process.exitCode = 1;
});
