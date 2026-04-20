/**
 * Adds 4 Brakes roast-meat ingredients to menu_ingredients with price history.
 *
 * For variable-weight meat, pack_size is the midpoint of the supplier's
 * stated min/max weight range — this reproduces the supplier's
 * pack_price_est_current when multiplied by price_per_kg_current.
 *
 * Safe to re-run: skips insert if supplier_sku already exists (Brakes SKUs are unique).
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

type Input = {
  supplier_sku: string;
  name: string;
  brand: string | null;
  category: string;
  cut: string;
  pack_min_kg: number;
  pack_max_kg: number;
  units_per_case: number;
  price_per_kg_current: number;
  price_per_kg_standard: number;
  on_offer: boolean;
  offer_type: string | null;
  pack_price_est_current: number;
  pack_price_est_standard: number;
  certification: string | null;
  storage: string;
  supplier: string;
  usage: string;
};

const inputs: Input[] = [
  {
    supplier_sku: 'C136621',
    name: 'Birchstead 28-Day Aged Beef Topside',
    brand: 'Birchstead',
    category: 'Beef',
    cut: 'Topside',
    pack_min_kg: 4.0,
    pack_max_kg: 7.0,
    units_per_case: 1,
    price_per_kg_current: 13.67,
    price_per_kg_standard: 13.67,
    on_offer: false,
    offer_type: null,
    pack_price_est_current: 75.18,
    pack_price_est_standard: 75.18,
    certification: '28-day matured',
    storage: 'Chilled',
    supplier: 'Brakes',
    usage: 'Roast and slice',
  },
  {
    supplier_sku: 'C5007131',
    name: 'Premium British Red Tractor Boneless Lamb Leg',
    brand: 'Premium',
    category: 'Lamb',
    cut: 'Boneless leg',
    pack_min_kg: 1.4,
    pack_max_kg: 1.8,
    units_per_case: 1,
    price_per_kg_current: 19.49,
    price_per_kg_standard: 22.41,
    on_offer: true,
    offer_type: 'Multi-buy',
    pack_price_est_current: 31.18,
    pack_price_est_standard: 35.86,
    certification: 'Red Tractor, British',
    storage: 'Chilled',
    supplier: 'Brakes',
    usage: 'Roast and slice',
  },
  {
    supplier_sku: 'C72011',
    name: 'Pork Leg Rind On and Boneless',
    brand: null,
    category: 'Pork',
    cut: 'Boneless leg, rind on',
    pack_min_kg: 6.0,
    pack_max_kg: 7.5,
    units_per_case: 1,
    price_per_kg_current: 5.49,
    price_per_kg_standard: 9.19,
    on_offer: true,
    offer_type: 'Multi-buy',
    pack_price_est_current: 37.06,
    pack_price_est_standard: 62.03,
    certification: null,
    storage: 'Chilled',
    supplier: 'Brakes',
    usage: 'Roast and slice',
  },
  {
    supplier_sku: 'C110765',
    name: 'Unbanded Boneless Butterfly Turkey Breast',
    brand: null,
    category: 'Turkey',
    cut: 'Butterfly breast, boneless, skin on',
    pack_min_kg: 4.0,
    pack_max_kg: 6.5,
    units_per_case: 1,
    price_per_kg_current: 9.49,
    price_per_kg_standard: 10.09,
    on_offer: true,
    offer_type: 'Standard promo',
    pack_price_est_current: 49.82,
    pack_price_est_standard: 52.97,
    certification: null,
    storage: 'Chilled',
    supplier: 'Brakes',
    usage: 'Roast and slice',
  },
];

function buildDescription(i: Input): string {
  return `${i.category} — ${i.cut}. ${i.usage}.`;
}

function buildNotes(i: Input): string {
  const parts: string[] = [
    `Pack weight range: ${i.pack_min_kg}–${i.pack_max_kg} kg (midpoint used for pack_size).`,
    `${i.units_per_case} unit per case.`,
    `Standard price: £${i.price_per_kg_standard.toFixed(2)}/kg.`,
  ];
  if (i.on_offer && i.offer_type) {
    parts.push(`Currently on offer (${i.offer_type}): £${i.price_per_kg_current.toFixed(2)}/kg.`);
  }
  if (i.certification) parts.push(`Certification: ${i.certification}.`);
  return parts.join(' ');
}

async function upsertIngredient(i: Input) {
  const midpointKg = Number(((i.pack_min_kg + i.pack_max_kg) / 2).toFixed(3));

  const { data: existing } = await supabase
    .from('menu_ingredients')
    .select('id, name, supplier_sku, pack_cost')
    .eq('supplier_sku', i.supplier_sku)
    .eq('supplier_name', i.supplier)
    .maybeSingle();

  const payload = {
    name: i.name,
    description: buildDescription(i),
    default_unit: 'kilogram',
    storage_type: i.storage.toLowerCase(), // "chilled"
    supplier_name: i.supplier,
    supplier_sku: i.supplier_sku,
    brand: i.brand,
    pack_size: midpointKg,
    pack_size_unit: 'kilogram',
    pack_cost: i.pack_price_est_current,
    portions_per_pack: null as number | null,
    wastage_pct: 0,
    allergens: [] as string[],
    dietary_flags: [] as string[],
    notes: buildNotes(i),
    is_active: true,
  };

  let ingredientId: string;
  if (existing) {
    const { error } = await supabase
      .from('menu_ingredients')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw new Error(`update "${i.name}" failed: ${error.message}`);
    ingredientId = existing.id;
    console.log(`  ~ updated "${i.name}" (sku=${i.supplier_sku}, pack=${midpointKg}kg, £${i.pack_price_est_current})`);
  } else {
    const { data: inserted, error } = await supabase
      .from('menu_ingredients')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw new Error(`insert "${i.name}" failed: ${error.message}`);
    ingredientId = inserted.id;
    console.log(`  + inserted "${i.name}" (id=${ingredientId}, sku=${i.supplier_sku}, pack=${midpointKg}kg, £${i.pack_price_est_current})`);
  }

  // Write a price-history row only if pack_cost changed (or new ingredient)
  const shouldWritePriceRow = !existing || Number(existing.pack_cost) !== i.pack_price_est_current;
  if (shouldWritePriceRow) {
    const { error: priceErr } = await supabase
      .from('menu_ingredient_prices')
      .insert({
        ingredient_id: ingredientId,
        pack_cost: i.pack_price_est_current,
        effective_from: new Date().toISOString(),
        supplier_name: i.supplier,
        supplier_sku: i.supplier_sku,
        notes: i.on_offer ? `Promo price (${i.offer_type})` : 'Standard price',
      });
    if (priceErr) throw new Error(`price history insert failed: ${priceErr.message}`);
    console.log(`    + price history row written (£${i.pack_price_est_current})`);
  } else {
    console.log(`    - price unchanged, no history row needed`);
  }
}

async function main() {
  console.log('=== Adding Brakes roast-meat ingredients ===');
  for (const i of inputs) {
    await upsertIngredient(i);
  }

  console.log('\n=== Verification ===');
  const skus = inputs.map(i => i.supplier_sku);
  const { data: results } = await supabase
    .from('menu_ingredients')
    .select('name, supplier_sku, brand, storage_type, pack_size, pack_size_unit, pack_cost, supplier_name, is_active')
    .in('supplier_sku', skus)
    .order('name');
  for (const r of (results ?? []) as any[]) {
    const pricePerKg = (Number(r.pack_cost) / Number(r.pack_size)).toFixed(2);
    console.log(`  ${r.is_active ? 'A' : 'I'}  ${r.supplier_name}/${r.supplier_sku}  £${Number(r.pack_cost).toFixed(2)} / ${r.pack_size}${r.pack_size_unit.charAt(0)} = £${pricePerKg}/kg — ${r.name}`);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
