#!/usr/bin/env node

/**
 * Seed a single menu ingredient + price history row (Chef's Essentials chips).
 *
 * Safety:
 * - DRY RUN by default.
 * - To run mutations, you must pass `--confirm`, set env gates, and provide `--limit`.
 *
 * Example (mutation, dangerous):
 *   RUN_SEED_CHEFS_ESSENTIALS_CHIPS_MUTATION=true \\
 *   ALLOW_SEED_CHEFS_ESSENTIALS_CHIPS_MUTATION_SCRIPT=true \\
 *   node scripts/menu/seed-chefs-essentials-chips.js --confirm --limit=2
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const SCRIPT_NAME = 'seed-chefs-essentials-chips';
const RUN_MUTATION_ENV = 'RUN_SEED_CHEFS_ESSENTIALS_CHIPS_MUTATION';
const ALLOW_MUTATION_ENV = 'ALLOW_SEED_CHEFS_ESSENTIALS_CHIPS_MUTATION_SCRIPT';
const HARD_CAP = 10;

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function isTruthyEnv(value) {
  if (!value) return false;
  return TRUTHY.has(String(value).trim().toLowerCase());
}

function findFlagValue(argv, flag) {
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

function parsePositiveInt(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid positive integer: ${raw}`);
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseArgs(argv = process.argv) {
  const rest = argv.slice(2);
  const confirm = rest.includes('--confirm');
  const dryRun = !confirm || rest.includes('--dry-run');
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'));

  return { confirm, dryRun, limit };
}

function requireEnv(name, value) {
  if (!value || String(value).trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

const ALLOWED_ALLERGENS = [
  'celery',
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'lupin',
  'milk',
  'molluscs',
  'mustard',
  'nuts',
  'peanuts',
  'sesame',
  'soya',
  'sulphites',
];

const ALLOWED_DIETARY_FLAGS = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'dairy_free',
  'halal',
  'kosher',
];

const ALLERGEN_SYNONYMS = new Map([
  ['cereals containing gluten', 'gluten'],
  ['cereals', 'gluten'],
  ['tree nuts', 'nuts'],
  ['sesame seeds', 'sesame'],
  ['sulphur dioxide', 'sulphites'],
  ['sulphur dioxide/sulphites', 'sulphites'],
  ['soy', 'soya'],
  ['soybeans', 'soya'],
]);

const DIETARY_SYNONYMS = new Map([
  ['plant based', 'vegan'],
  ['plant-based', 'vegan'],
  ['veg', 'vegetarian'],
  ['veggie', 'vegetarian'],
  ['gf', 'gluten_free'],
  ['gluten-free', 'gluten_free'],
  ['gluten free', 'gluten_free'],
  ['coeliac friendly', 'gluten_free'],
  ['coeliacs', 'gluten_free'],
  ['dairy-free', 'dairy_free'],
  ['dairy free', 'dairy_free'],
  ['lactose-free', 'dairy_free'],
  ['lactose free', 'dairy_free'],
]);

const DIETARY_PATTERNS = [
  { pattern: /vegan/, value: 'vegan' },
  { pattern: /vegetarian/, value: 'vegetarian' },
  { pattern: /plant[\s-]?based/, value: 'vegan' },
  { pattern: /gluten[\s-]?free/, value: 'gluten_free' },
  { pattern: /coeliac/, value: 'gluten_free' },
  { pattern: /dairy[\s-]?free/, value: 'dairy_free' },
  { pattern: /lactose[\s-]?free/, value: 'dairy_free' },
  { pattern: /halal/, value: 'halal' },
  { pattern: /kosher/, value: 'kosher' },
];

// Load env
['.env.local', '.env'].forEach((file) => {
  const full = path.resolve(process.cwd(), file);
  if (fs.existsSync(full)) {
    dotenv.config({ path: full, override: false });
  }
});

function normalizeList(values = []) {
  return values
    .map((value) => (value ?? '').toString().trim().toLowerCase())
    .filter(Boolean);
}

function normalizeAllergens(values = []) {
  const normalized = normalizeList(values).map((value) => ALLERGEN_SYNONYMS.get(value) ?? value);
  const filtered = normalized.filter((value) => ALLOWED_ALLERGENS.includes(value));
  return Array.from(new Set(filtered));
}

function normalizeDietaryFlags(values = []) {
  const normalized = normalizeList(values).map((value) => DIETARY_SYNONYMS.get(value) ?? value);
  const filtered = normalized.filter((value) => ALLOWED_DIETARY_FLAGS.includes(value));
  return Array.from(new Set(filtered));
}

function extractDietaryFlagsFromStatements(statements = []) {
  const flags = new Set();
  statements.forEach((statement) => {
    const lower = statement.toLowerCase();
    DIETARY_PATTERNS.forEach(({ pattern, value }) => {
      if (pattern.test(lower)) {
        flags.add(value);
      }
    });
  });
  return Array.from(flags);
}

const rawFeatures = ['Suitable for vegetarians and suitable for vegans'];
const rawLifestyleStatements = ['Suitable for Vegans', 'Suitable for Vegetarians'];
const manualDietaryFlags = ['gluten_free', 'dairy_free'];
const rawDietaryFlags = [
  ...extractDietaryFlagsFromStatements([...rawFeatures, ...rawLifestyleStatements]),
  ...manualDietaryFlags,
];
const rawAllergens = [];

const ingredientPayload = {
  name: "Chef's Essentials Straight Cut Chips 4 x 2.5kg",
  description: 'Pre-fried and frozen 10 mm straight cut chips. Case of 4 bags.',
  default_unit: 'kilogram',
  storage_type: 'frozen',
  supplier_name: 'Booker',
  supplier_sku: '303934',
  brand: "Chef's Essentials",
  pack_size: 10, // 4 x 2.5kg
  pack_size_unit: 'kilogram',
  pack_cost: 13.19,
  portions_per_pack: null,
  wastage_pct: 0,
  shelf_life_days: null,
  allergens: normalizeAllergens(rawAllergens),
  dietary_flags: normalizeDietaryFlags(rawDietaryFlags),
  notes: 'Barcode: 5020379188111. Keep frozen at -18°C. Do not refreeze once defrosted.',
  is_active: true,
};

async function fetchExistingIngredientId(supabase) {
  const { data: existing, error } = await supabase
    .from('menu_ingredients')
    .select('id')
    .eq('name', ingredientPayload.name)
    .maybeSingle();

  if (error) throw error;
  return existing?.id ?? null;
}

async function upsertIngredient(supabase, existingId) {
  if (existingId) {
    console.log(`[${SCRIPT_NAME}] Ingredient exists, updating...`);
    const { data: updated, error } = await supabase
      .from('menu_ingredients')
      .update({
        description: ingredientPayload.description,
        default_unit: ingredientPayload.default_unit,
        storage_type: ingredientPayload.storage_type,
        supplier_name: ingredientPayload.supplier_name,
        supplier_sku: ingredientPayload.supplier_sku,
        brand: ingredientPayload.brand,
        pack_size: ingredientPayload.pack_size,
        pack_size_unit: ingredientPayload.pack_size_unit,
        pack_cost: ingredientPayload.pack_cost,
        portions_per_pack: ingredientPayload.portions_per_pack,
        wastage_pct: ingredientPayload.wastage_pct,
        shelf_life_days: ingredientPayload.shelf_life_days,
        allergens: ingredientPayload.allergens,
        dietary_flags: ingredientPayload.dietary_flags,
        notes: ingredientPayload.notes,
        is_active: ingredientPayload.is_active,
      })
      .eq('id', existingId)
      .select('id')
      .single();

    if (error) throw error;
    if (!updated?.id) throw new Error('Ingredient update affected no rows');
    return updated.id;
  }

  console.log(`[${SCRIPT_NAME}] Creating ingredient...`);
  const { data: created, error } = await supabase
    .from('menu_ingredients')
    .insert(ingredientPayload)
    .select('id')
    .single();

  if (error) throw error;
  if (!created?.id) throw new Error('Ingredient insert returned no id');
  return created.id;
}

async function recordPrice(supabase, ingredientId) {
  const { data, error } = await supabase
    .from('menu_ingredient_prices')
    .insert({
      ingredient_id: ingredientId,
      pack_cost: ingredientPayload.pack_cost,
      supplier_name: ingredientPayload.supplier_name,
      supplier_sku: ingredientPayload.supplier_sku,
    })
    .select('ingredient_id')
    .single();

  if (error) throw error;
  if (!data?.ingredient_id) throw new Error('Price insert affected no rows');
}

async function logIngredient(supabase, ingredientId) {
  const { data, error } = await supabase
    .from('menu_ingredients')
    .select('name, allergens, dietary_flags, updated_at')
    .eq('id', ingredientId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Unable to verify ingredient record: missing row');
  console.log('Current record snapshot:', data);
}

async function main() {
  const args = parseArgs(process.argv);

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`);

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabase = createClient(supabaseUrl, serviceKey);

  const existingId = await fetchExistingIngredientId(supabase);
  const plannedMutations = 2;

  console.log(`[${SCRIPT_NAME}] Ingredient: ${ingredientPayload.name}`);
  console.log(`[${SCRIPT_NAME}] Existing: ${existingId ? `yes (${existingId})` : 'no'}`);
  console.log(`[${SCRIPT_NAME}] Planned mutations: ${plannedMutations} (ingredient upsert + price insert)`);

  if (args.dryRun) {
    if (existingId) {
      await logIngredient(supabase, existingId);
    }

    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows updated/inserted.`);
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`);
    console.log(`- Pass --confirm`);
    console.log(`- Set ${RUN_MUTATION_ENV}=true`);
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`);
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP})`);
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

  if (!isTruthyEnv(process.env[ALLOW_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${ALLOW_MUTATION_ENV}=true to allow this mutation script.`
    );
  }

  const limit = args.limit;
  if (!limit) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`);
  }
  if (limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`);
  }
  if (plannedMutations > limit) {
    throw new Error(`[${SCRIPT_NAME}] planned mutations (${plannedMutations}) exceeds --limit (${limit})`);
  }

  const ingredientId = await upsertIngredient(supabase, existingId);
  await recordPrice(supabase, ingredientId);
  await logIngredient(supabase, ingredientId);

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Ingredient seeded successfully.`);
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed to seed ingredient:`, error);
  process.exitCode = 1;
});
