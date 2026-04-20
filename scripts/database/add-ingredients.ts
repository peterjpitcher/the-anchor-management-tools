#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import { resolve } from 'path'

const SCRIPT_NAME = 'add-ingredients'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

interface IngredientInput {
  name: string
  description: string
  brand: string
  default_unit: string
  storage_type: string
  supplier_name: string
  supplier_sku: string
  pack_size: number
  pack_size_unit: string
  pack_cost: number
  portions_per_pack: number | null
  wastage_pct: number
  shelf_life_days: number | null
  allergens: string[]
  dietary_flags: string[]
  notes: string | null
  is_active: boolean
}

const ingredients: IngredientInput[] = [
  {
    name: "Chef's Larder Breaded Scampi 1.8kg",
    description: 'Reformed scampi pieces with added water, coated in breadcrumbs',
    brand: "Chef's Larder",
    default_unit: 'kilogram',
    storage_type: 'frozen',
    supplier_name: 'Booker',
    supplier_sku: '201011',
    pack_size: 1.8,
    pack_size_unit: 'kilogram',
    pack_cost: 23.19,
    portions_per_pack: 16,
    wastage_pct: 0,
    shelf_life_days: 438,
    allergens: ['crustaceans', 'gluten'],
    dietary_flags: [],
    notes: 'Contains 16 x 111g servings. Warning: may contain small pieces of shell. Deep fry from frozen at 180°C for 3.5-4 minutes.',
    is_active: true,
  },
  {
    name: "Chef's Larder Mushy Peas 2.61kg",
    description: 'Mushy processed peas - sugar and salt added',
    brand: "Chef's Larder",
    default_unit: 'kilogram',
    storage_type: 'ambient',
    supplier_name: 'Booker',
    supplier_sku: '227542',
    pack_size: 2.61,
    pack_size_unit: 'kilogram',
    pack_cost: 4.49,
    portions_per_pack: 32,
    wastage_pct: 0,
    shelf_life_days: 547,
    allergens: [],
    dietary_flags: ['vegetarian'],
    notes: 'Contains 32 x 80g servings. Bain marie stable. No artificial colours. Once opened, refrigerate and use within 2 days. Heat gently, do not boil.',
    is_active: true,
  },
  {
    name: "Chef's Menu Crispy Steak Cut Chips 2.5kg",
    description: 'Pre-fried and frozen 10x20mm steak cut chips with a crispy coating',
    brand: "Chef's Menu",
    default_unit: 'kilogram',
    storage_type: 'frozen',
    supplier_name: 'Booker',
    supplier_sku: '303955',
    pack_size: 2.5,
    pack_size_unit: 'kilogram',
    pack_cost: 3.99,
    portions_per_pack: null,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: [],
    dietary_flags: ['vegan', 'vegetarian', 'gluten_free'],
    notes: 'Suitable for coeliacs. Deep fry from frozen at 175°C for approx. 4 mins until golden yellow. Do not overcook. Designed to stay warmer for longer.',
    is_active: true,
  },
  {
    name: 'Tesco Unsmoked Back Bacon 300g',
    description: 'Unsmoked rindless back bacon with added water',
    brand: 'Tesco',
    default_unit: 'gram',
    storage_type: 'chilled',
    supplier_name: 'Tesco',
    supplier_sku: '',
    pack_size: 300,
    pack_size_unit: 'gram',
    pack_cost: 1.49,
    portions_per_pack: 5,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: [],
    dietary_flags: [],
    notes: '10 rashers per pack (2 rashers = 60g serving). Made using Danish pork. Pan fry 6-8 mins or grill 6-7 mins. Suitable for freezing. Once defrosted use within 24 hours.',
    is_active: true,
  },
  {
    name: 'Creamfields Mild Cheddar Slices 200g',
    description: 'Mild cheddar cheese slices',
    brand: 'Creamfields',
    default_unit: 'gram',
    storage_type: 'chilled',
    supplier_name: 'Tesco',
    supplier_sku: '',
    pack_size: 200,
    pack_size_unit: 'gram',
    pack_cost: 1.39,
    portions_per_pack: 10,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: ['milk'],
    dietary_flags: ['vegetarian'],
    notes: '10 slices per pack (20g per slice). Made using British and Irish milk. Smooth & creamy.',
    is_active: true,
  },
  {
    name: 'Brakes Essentials Garlic & Parsley Bread Slices',
    description: 'Slices of baguette topped with margarine, garlic and parsley',
    brand: 'Brakes Essentials',
    default_unit: 'each',
    storage_type: 'frozen',
    supplier_name: 'Brakes',
    supplier_sku: '32000',
    pack_size: 85,
    pack_size_unit: 'each',
    pack_cost: 13.18,
    portions_per_pack: 85,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: ['gluten'],
    dietary_flags: ['vegetarian'],
    notes: 'Approx 85 x 22g slices. May contain milk and soya. Oven from frozen at 200°C for 7-10 mins, or grill 2-3 mins. Consume immediately after baking or refrigerate and use within 12 hours.',
    is_active: true,
  },
  {
    name: 'Sysco Classic Spinach & Ricotta Cannelloni 2kg',
    description: 'Multi-portion spinach & ricotta filled cannelloni with tomato sauce, cheddar cheese sauce, topped with mozzarella',
    brand: 'Sysco Classic',
    default_unit: 'kilogram',
    storage_type: 'frozen',
    supplier_name: 'Brakes',
    supplier_sku: '148528',
    pack_size: 2,
    pack_size_unit: 'kilogram',
    pack_cost: 19.99,
    portions_per_pack: null,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: ['gluten', 'eggs', 'milk'],
    dietary_flags: ['vegetarian'],
    notes: 'Pack of 2 trays. May contain mustard and soya. Oven from defrost 190°C for 35-40 mins, or from frozen 45-50 mins. Allow to stand 5-10 mins. Defrost in fridge approx 24 hours.',
    is_active: true,
  },
  {
    name: 'Lion Katsu Curry Cooking Sauce 2.27L',
    description: 'Katsu curry cooking sauce',
    brand: 'Lion',
    default_unit: 'litre',
    storage_type: 'ambient',
    supplier_name: 'Booker',
    supplier_sku: '292287',
    pack_size: 2.27,
    pack_size_unit: 'litre',
    pack_cost: 14.59,
    portions_per_pack: null,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: ['soya', 'gluten'],
    dietary_flags: ['vegan', 'vegetarian'],
    notes: 'Contains soy sauce (soy beans, wheat). Shake well before use. Once opened, refrigerate and use within 4 weeks.',
    is_active: true,
  },
  {
    name: "Chef's Essentials 60 White Fillet Fish Fingers 1.5kg",
    description: 'Skinless, boneless pollock fish fingers coated in breadcrumbs',
    brand: "Chef's Essentials",
    default_unit: 'kilogram',
    storage_type: 'frozen',
    supplier_name: 'Booker',
    supplier_sku: '289557',
    pack_size: 1.5,
    pack_size_unit: 'kilogram',
    pack_cost: 13.29,
    portions_per_pack: 60,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: ['fish', 'gluten'],
    dietary_flags: [],
    notes: 'Contains 60 x 25g fish fingers. MSC certified sustainable pollock. Warning: may contain bones. Oven 220°C for 13-15 mins, shallow fry 7-8 mins, or deep fry 180°C for 3-4 mins. Cook from frozen.',
    is_active: true,
  },
  {
    name: 'H.W. Nevills Plain White Tortilla Wraps 8 Pack',
    description: 'Plain wheat tortilla wraps',
    brand: 'H.W. Nevills',
    default_unit: 'each',
    storage_type: 'ambient',
    supplier_name: 'Tesco',
    supplier_sku: '',
    pack_size: 8,
    pack_size_unit: 'each',
    pack_cost: 0.99,
    portions_per_pack: 8,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: ['gluten'],
    dietary_flags: ['vegan'],
    notes: '8 wraps per pack (61g each). Suitable for freezing. Once opened, consume within 2 days. Can be warmed in oven 200°C for 8 mins or microwave.',
    is_active: true,
  },
  {
    name: 'Kuhne Crispy Fried Onions 1kg',
    description: 'Fried pieces of onion',
    brand: 'Kuhne',
    default_unit: 'kilogram',
    storage_type: 'ambient',
    supplier_name: 'Brakes',
    supplier_sku: '134544',
    pack_size: 1,
    pack_size_unit: 'kilogram',
    pack_cost: 7.82,
    portions_per_pack: null,
    wastage_pct: 0,
    shelf_life_days: null,
    allergens: ['gluten'],
    dietary_flags: ['vegan', 'vegetarian'],
    notes: 'Ready to use. Ingredients: onions, palm oil, wheat flour, salt.',
    is_active: true,
  },
]

async function main() {
  const db = createAdminClient()

  for (const ingredient of ingredients) {
    console.log(`\n[${SCRIPT_NAME}] Inserting: ${ingredient.name}`)

    // Check if already exists
    const { data: existing } = await db
      .from('menu_ingredients')
      .select('id, name')
      .eq('name', ingredient.name)
      .maybeSingle()

    if (existing) {
      console.log(`[${SCRIPT_NAME}] ⏭️  Already exists (id: ${existing.id}), skipping.`)
      continue
    }

    // Insert the ingredient
    const { data: inserted, error: insertError } = await db
      .from('menu_ingredients')
      .insert({
        name: ingredient.name,
        description: ingredient.description,
        brand: ingredient.brand,
        default_unit: ingredient.default_unit,
        storage_type: ingredient.storage_type,
        supplier_name: ingredient.supplier_name,
        supplier_sku: ingredient.supplier_sku,
        pack_size: ingredient.pack_size,
        pack_size_unit: ingredient.pack_size_unit,
        pack_cost: ingredient.pack_cost,
        portions_per_pack: ingredient.portions_per_pack,
        wastage_pct: ingredient.wastage_pct,
        shelf_life_days: ingredient.shelf_life_days,
        allergens: ingredient.allergens,
        dietary_flags: ingredient.dietary_flags,
        notes: ingredient.notes,
        is_active: ingredient.is_active,
      })
      .select('id, name')
      .single()

    if (insertError) {
      console.error(`[${SCRIPT_NAME}] ❌ Failed to insert ${ingredient.name}:`, insertError.message)
      continue
    }

    console.log(`[${SCRIPT_NAME}] ✅ Inserted: ${inserted.name} (id: ${inserted.id})`)

    // Record initial price history
    const { error: priceError } = await db
      .from('menu_ingredient_prices')
      .insert({
        ingredient_id: inserted.id,
        pack_cost: ingredient.pack_cost,
        supplier_name: ingredient.supplier_name,
        supplier_sku: ingredient.supplier_sku,
        notes: `Initial price from ${ingredient.supplier_name}`,
      })

    if (priceError) {
      console.error(`[${SCRIPT_NAME}] ⚠️  Ingredient created but price history failed:`, priceError.message)
    } else {
      console.log(`[${SCRIPT_NAME}] ✅ Price history recorded: £${ingredient.pack_cost}`)
    }
  }

  console.log(`\n[${SCRIPT_NAME}] Done.`)
}

main().catch((err) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, err)
  process.exit(1)
})
