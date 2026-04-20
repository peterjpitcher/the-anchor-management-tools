/**
 * Sets portions_per_pack for the 4 Brakes roast meats based on 200g raw per portion.
 * Formula: portions_per_pack = (pack_size_kg * 1000) / 200
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

const PORTION_GRAMS_RAW = 200;
const SKUS = ['C136621', 'C5007131', 'C72011', 'C110765'];

async function main() {
  const { data: ingredients, error } = await supabase
    .from('menu_ingredients')
    .select('id, name, supplier_sku, pack_size, pack_size_unit, pack_cost')
    .in('supplier_sku', SKUS);
  if (error) throw error;

  console.log('=== Setting portions_per_pack (200g raw) ===');
  for (const i of ingredients ?? []) {
    if (i.pack_size_unit !== 'kilogram') {
      console.log(`  SKIP ${i.supplier_sku} — unexpected unit "${i.pack_size_unit}"`);
      continue;
    }
    const portions = Number(((Number(i.pack_size) * 1000) / PORTION_GRAMS_RAW).toFixed(3));
    const portionCost = Number(i.pack_cost) / portions;

    const { error: updErr } = await supabase
      .from('menu_ingredients')
      .update({ portions_per_pack: portions })
      .eq('id', i.id);
    if (updErr) throw new Error(`update "${i.name}" failed: ${updErr.message}`);
    console.log(`  ~ ${i.supplier_sku}  ${i.name}`);
    console.log(`      pack ${i.pack_size}kg @ £${Number(i.pack_cost).toFixed(2)} → ${portions} portions, £${portionCost.toFixed(3)}/portion`);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
