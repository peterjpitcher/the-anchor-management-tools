#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

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

// Load env vars (same behaviour as other menu seed scripts)
['.env.local', '.env'].forEach((file) => {
  const full = path.resolve(process.cwd(), file);
  if (fs.existsSync(full)) {
    dotenv.config({ path: full, override: false });
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE env vars. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

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

const rawFeatures = ['Needs no refrigeration', 'Microwave 8 mins', 'Suitable for Microwave', 'Extended shelf life', 'Fully cooked'];
const rawLifestyleStatements = [];
const manualDietaryFlags = [];
const rawDietaryFlags = [
  ...extractDietaryFlagsFromStatements([...rawFeatures, ...rawLifestyleStatements]),
  ...manualDietaryFlags,
];
const rawAllergens = [];

const ingredientPayload = {
  name: "Chef's Larder Slow Cooked Lamb Shanks with a Rich Red Wine Gravy 6 x 475g (2.85kg)",
  description: 'Slow cooked lamb shanks in red wine, redcurrant and port gravy.',
  default_unit: 'kilogram',
  storage_type: 'ambient',
  supplier_name: 'Booker / Makro Belfast',
  supplier_sku: '248762',
  brand: "Chef's Larder",
  pack_size: 2.85,
  pack_size_unit: 'kilogram',
  pack_cost: 48.99,
  portions_per_pack: 6,
  wastage_pct: 0,
  shelf_life_days: 100,
  allergens: normalizeAllergens(rawAllergens),
  dietary_flags: normalizeDietaryFlags(rawDietaryFlags),
  notes: [
    'Barcode: 5020379150330.',
    'Case contains 6 x 475g pouches (approx 400g edible portion each).',
    'Store in a cool, dry place. Best before: see front of pack and individual pouch.',
    'Microwave: heat pouch 4 min (1000W), stand 1 min, shake, heat for a further 3 min and decant.',
    'Boil in pouch: simmer 30 min from ambient, shake pouch, then open carefully.',
    'Warning: product contains bones.',
  ].join(' '),
  is_active: true,
};

async function upsertIngredient() {
  const { data: existing, error: fetchError } = await supabase
    .from('menu_ingredients')
    .select('id')
    .eq('name', ingredientPayload.name)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (existing) {
    console.log('Ingredient exists, updating…');
    const { error: updateError } = await supabase
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
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return existing.id;
  }

  console.log('Creating ingredient…');
  const { data: created, error: insertError } = await supabase
    .from('menu_ingredients')
    .insert(ingredientPayload)
    .select('id')
    .single();
  if (insertError) throw insertError;
  return created.id;
}

async function recordPrice(ingredientId) {
  const { error } = await supabase.from('menu_ingredient_prices').insert({
    ingredient_id: ingredientId,
    pack_cost: ingredientPayload.pack_cost,
    supplier_name: ingredientPayload.supplier_name,
    supplier_sku: ingredientPayload.supplier_sku,
  });
  if (error) throw error;
}

async function logIngredient(ingredientId) {
  const { data, error } = await supabase
    .from('menu_ingredients')
    .select('name, supplier_name, supplier_sku, allergens, dietary_flags, updated_at')
    .eq('id', ingredientId)
    .maybeSingle();
  if (error) {
    console.warn('Unable to verify ingredient record:', error);
    return;
  }
  console.log('Current record snapshot:', data);
}

async function main() {
  try {
    const ingredientId = await upsertIngredient();
    await recordPrice(ingredientId);
    await logIngredient(ingredientId);
    console.log('Ingredient seeded successfully.');
  } catch (error) {
    console.error('Failed to seed ingredient:', error);
    process.exit(1);
  }
}

main();
