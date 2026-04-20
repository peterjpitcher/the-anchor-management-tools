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

// --- SALES DATA (as provided, pizzas and garlic-bread/mozzarella stripped upstream) ---
// We'll tag each row with a treatment: "match" | "pizza-skip" | "modifier-skip" | "sauce-skip" | "missing-dish"
// Signed quantity: refunds are -qty.

type Row = { pos: string; qty: number; mapTo?: string; skip?: 'pizza' | 'modifier' | 'sauce' | 'noncost' | 'missing' };

const rows: Row[] = [
  { pos: '6 Onion Rings', qty: 26, mapTo: '6 Onion Rings' },
  { pos: 'Apple Crumble', qty: 23, mapTo: 'Apple Crumble' },
  { pos: 'Bangers & Mash', qty: 10, mapTo: 'Bangers & Mash' },
  { pos: 'Barbecue Chicken', qty: 3, skip: 'pizza' },
  { pos: 'Barbecue Chicken 12"', qty: 10, skip: 'pizza' },
  { pos: 'Battered Chicken Burger', qty: 6, mapTo: 'Chicken Burger' },
  { pos: 'BBQ Sauce', qty: 15, skip: 'sauce' },
  { pos: 'Beef & Ale Pie', qty: 44, mapTo: 'Beef & Ale Pie' },
  { pos: 'Beef Burger', qty: 41, mapTo: 'Classic Beef Burger' },
  { pos: 'Beef Stack', qty: 34, mapTo: 'Beef Stack' },
  { pos: 'Breaded Vegetable Burger', qty: 2, mapTo: 'Garden Veg Burger' },
  { pos: 'Burger Sauce', qty: 13, skip: 'sauce' },
  { pos: 'Butternut Squash, Mix Bean & Cheese Pie', qty: 5, skip: 'missing' },
  { pos: 'Cauliflower Cheese', qty: 4, skip: 'noncost' }, // Sunday lunch side
  { pos: 'Cheese Slice', qty: 62, skip: 'noncost' }, // burger add-on (mature cheddar £1)
  { pos: 'Cheesy Chips', qty: 33, mapTo: 'Cheesy Chips' },
  { pos: 'Chicken & Mushroom Pie', qty: 26, mapTo: 'Chicken & Wild Mushroom Pie' },
  { pos: 'Chicken & Wild Mushroom Pie', qty: 4, mapTo: 'Chicken & Wild Mushroom Pie' },
  { pos: 'Chicken and Pesto 12"', qty: 2, skip: 'pizza' },
  { pos: 'Chicken and Pesto 8"', qty: 1, skip: 'pizza' },
  { pos: 'Chicken Burger', qty: 2, mapTo: 'Chicken Burger' },
  { pos: 'Chicken Goujon Snack Pot', qty: 47, mapTo: 'Chicken Goujons & Chips' },
  { pos: 'Chicken Goujon with Salad Wrap', qty: 14, mapTo: 'Chicken Goujon Wrap' },
  { pos: 'Chicken Goujon Wrap', qty: 7, mapTo: 'Chicken Goujon Wrap' },
  { pos: 'Chicken Goujons & Chips', qty: 22, mapTo: 'Chicken Goujons & Chips' },
  { pos: 'Chicken Katsu Curry', qty: 20, mapTo: 'Chicken Katsu Curry' },
  { pos: 'Chicken Stack', qty: 15, mapTo: 'Chicken Stack' },
  { pos: 'Chicken, Ham Hock & Leek Pie', qty: 4, skip: 'missing' },
  { pos: 'Chips', qty: 59, mapTo: 'Chips' },
  { pos: 'Chips Swap', qty: 3, skip: 'modifier' },
  { pos: 'Chocolate Fudge Brownie', qty: 22, mapTo: 'Chocolate Fudge Brownie' },
  { pos: 'Chocolate Fudge Cake', qty: 9, skip: 'missing' },
  { pos: 'Chocolate Syrup', qty: 5, skip: 'noncost' },
  { pos: 'Chunky Chips', qty: 16, mapTo: 'Chunky Chips' },
  { pos: 'Chunky Chips Swap', qty: 3, skip: 'modifier' },
  { pos: 'Crispy Bacon', qty: 22, skip: 'noncost' }, // burger add-on £2
  { pos: 'Cup Americano', qty: 14, mapTo: 'Americano' },
  { pos: "Cup Cadbury's Hot Chocolate", qty: 5, mapTo: 'Hot Chocolate' },
  { pos: 'Cup Cappuccino', qty: 20, mapTo: 'Cappuccino' },
  { pos: 'Cup Hot Chocolate', qty: 3, mapTo: 'Hot Chocolate' },
  { pos: 'Cup Latte', qty: 13, mapTo: 'Latte' },
  { pos: 'Custard', qty: 22, skip: 'noncost' },
  { pos: 'Fish & Chips', qty: 61, mapTo: 'Fish & Chips' },
  { pos: 'Fish Finger Snack Pot', qty: 15, mapTo: 'Fish Fingers & Chips' },
  { pos: 'Fish Finger Wrap', qty: 12, mapTo: 'Fish Finger Wrap' },
  { pos: 'Fish Fingers & Chips', qty: 5, mapTo: 'Fish Fingers & Chips' },
  { pos: 'Fully Loaded', qty: 6, skip: 'pizza' },
  { pos: 'Fully Loaded 12"', qty: 19, skip: 'pizza' },
  { pos: 'Fully Loaded 8"', qty: 2, skip: 'pizza' },
  { pos: 'Garden Stack', qty: 1, mapTo: 'Garden Stack' },
  { pos: 'Garden Veg Burger', qty: 3, mapTo: 'Garden Veg Burger' },
  { pos: 'Garlic Bread', qty: 4, skip: 'pizza' },
  { pos: 'Garlic Bread 12"', qty: 11, skip: 'pizza' },
  { pos: 'Garlic Bread 8"', qty: 1, skip: 'pizza' },
  { pos: 'Garlic Mayonnaise', qty: 21, skip: 'sauce' },
  { pos: 'Half Fish & Chips', qty: 20, mapTo: 'Half Fish & Chips' },
  { pos: 'Hashed Brown', qty: 1, skip: 'noncost' }, // burger add-on £2
  { pos: 'Ice Cream Sundae', qty: 15, mapTo: 'Ice Cream Sundae' },
  { pos: 'Jumbo Sausage & Chips', qty: 4, mapTo: 'Jumbo Sausage & Chips' },
  { pos: 'Katsu Burger', qty: 10, mapTo: 'Katsu Chicken Burger' },
  { pos: 'Kids Chicken Sunday Lunch', qty: 7, skip: 'noncost' }, // Sunday Lunch (out of menu management scope)
  { pos: 'Lamb Shank', qty: 16, mapTo: 'Lamb Shank' }, // still in DB (inactive but priced)
  { pos: 'Lamb Shank Sunday Lunch', qty: 17, skip: 'noncost' },
  { pos: 'Lasagne', qty: 26, mapTo: 'Lasagne' },
  { pos: "Mac 'n Cheese", qty: 9, mapTo: 'Mac & Cheese' },
  { pos: 'Mac & Cheese', qty: 5, mapTo: 'Mac & Cheese' },
  { pos: 'Mozzarella Cheese', qty: 11, skip: 'pizza' }, // pizza topping
  { pos: 'Nice & Spicy', qty: 1, skip: 'pizza' },
  { pos: 'Nice & Spicy 12"', qty: 8, skip: 'pizza' },
  { pos: 'Nice & Spicy 8"', qty: 1, skip: 'pizza' },
  { pos: 'No Cucumber', qty: 4, skip: 'modifier' },
  { pos: 'No Rocket', qty: 4, skip: 'modifier' },
  { pos: 'No Tomato', qty: 5, skip: 'modifier' },
  { pos: 'Onion Ring', qty: 4, skip: 'noncost' }, // burger add-on £1
  { pos: 'Pot Lemon & Ginger Tea', qty: 2, mapTo: 'Lemon & Ginger Tea' },
  { pos: 'Pot Pot of Decaffeinated Tea', qty: 3, mapTo: 'Decaffeinated Tea' },
  { pos: 'Pot Pot of Earl Grey', qty: 1, skip: 'missing' }, // Earl Grey not in DB
  { pos: 'Pot Pot of Green Tea', qty: 1, mapTo: 'Green Tea & Lemon' },
  { pos: 'Pot Pot of Tetley Tea', qty: 12, mapTo: 'Tetley Tea' },
  { pos: 'Pot Red Berries Tea', qty: 1, mapTo: 'Red Berries Tea' },
  { pos: 'Pot Tetley Tea', qty: 6, mapTo: 'Tetley Tea' },
  { pos: 'Refund Chicken & Mushroom Pie', qty: -2, mapTo: 'Chicken & Wild Mushroom Pie' },
  { pos: 'Refund Fish Finger Snack Pot', qty: -2, mapTo: 'Fish Fingers & Chips' },
  { pos: 'Refund Garlic Bread', qty: -1, skip: 'pizza' },
  { pos: 'Refund Mozzarella Cheese', qty: -1, skip: 'pizza' },
  { pos: 'Roast Chicken Sunday Lunch', qty: 18, skip: 'noncost' },
  { pos: 'Roast Pork Belly Sunday Lunch', qty: 9, skip: 'noncost' },
  { pos: 'Rustic Classic', qty: 9, skip: 'pizza' },
  { pos: 'Rustic Classic 12"', qty: 21, skip: 'pizza' },
  { pos: 'Salt & Chilli Squid & Chips', qty: 5, mapTo: 'Salt & Chilli Squid & Chips' },
  { pos: 'Salt & Chilli Squid Snack Pot', qty: 5, mapTo: 'Salt & Chilli Squid & Chips' },
  { pos: 'Sausage & Mash', qty: 14, mapTo: 'Bangers & Mash' },
  { pos: 'Scampi & Chips', qty: 24, mapTo: 'Scampi & Chips' },
  { pos: 'Simply Salami', qty: 5, skip: 'pizza' },
  { pos: 'Simply Salami 12"', qty: 12, skip: 'pizza' },
  { pos: 'Simply Salami 8"', qty: 1, skip: 'pizza' },
  { pos: 'Sliced Cheese', qty: 1, skip: 'noncost' },
  { pos: 'Smoked Chilli Chicken', qty: 3, skip: 'pizza' },
  { pos: 'Smoked Chilli Chicken 12"', qty: 1, skip: 'pizza' },
  { pos: 'Smoked Chilli Chicken 8"', qty: 1, skip: 'pizza' },
  { pos: 'Spicy Chicken Burger', qty: 13, mapTo: 'Spicy Chicken Burger' },
  { pos: 'Spicy Chicken Stack', qty: 6, mapTo: 'Spicy Chicken Stack' },
  { pos: 'Spinach & Ricotta Cannelloni', qty: 8, mapTo: 'Spinach & Ricotta Cannelloni' },
  { pos: 'Sticky Toffee Pudding', qty: 18, mapTo: 'Sticky Toffee Pudding' },
  { pos: 'Strawberry Syrup', qty: 5, skip: 'noncost' },
  { pos: 'Sweet Chilli Sauce', qty: 23, skip: 'sauce' },
  { pos: 'Sweet Potato Fries', qty: 12, mapTo: 'Sweet Potato Fries' },
  { pos: 'Sweet Potato Upgrade', qty: 9, skip: 'noncost' }, // burger upgrade £2
  { pos: 'Tartar Sauce', qty: 5, skip: 'sauce' },
  { pos: 'The Garden Club', qty: 1, skip: 'pizza' },
  { pos: 'The Garden Club 12"', qty: 8, skip: 'pizza' },
  { pos: 'The Garden Club 8"', qty: 1, skip: 'pizza' },
  { pos: 'Vanilla Ice Cream', qty: 34, skip: 'noncost' },
  { pos: 'Vegetarian Wellington', qty: 1, skip: 'noncost' },
];

async function main() {
  const { data: dishes, error } = await supabase
    .from('menu_dishes')
    .select('id, name, selling_price, portion_cost, gp_pct, is_active');

  if (error) { console.error(error); process.exit(1); }

  const dishByName = new Map<string, any>();
  for (const d of dishes ?? []) dishByName.set((d as any).name, d);

  const VAT_RATE = 0.20;

  let grossRevenue = 0;
  let cogs = 0;
  let unmappedCount = 0;
  const perItem: Array<{ name: string; qty: number; revenue: number; cost: number; gpPct: number }> = [];
  const issues: string[] = [];
  const skippedByReason: Record<string, { qty: number; items: string[] }> = {};

  for (const r of rows) {
    if (r.skip) {
      (skippedByReason[r.skip] ||= { qty: 0, items: [] });
      skippedByReason[r.skip].qty += r.qty;
      skippedByReason[r.skip].items.push(`${r.pos} (${r.qty})`);
      continue;
    }
    if (!r.mapTo) continue;
    const d = dishByName.get(r.mapTo);
    if (!d) {
      issues.push(`NO DB MATCH: ${r.pos} → ${r.mapTo}`);
      unmappedCount += r.qty;
      continue;
    }
    const price = Number(d.selling_price);
    const cost = Number(d.portion_cost);
    const revenue = price * r.qty;
    const itemCogs = cost * r.qty;
    grossRevenue += revenue;
    cogs += itemCogs;
    perItem.push({
      name: `${r.pos} → ${r.mapTo}`,
      qty: r.qty,
      revenue,
      cost: itemCogs,
      gpPct: price > 0 ? ((price - cost) / price) * 100 : 0,
    });
  }

  const netRevenue = grossRevenue / (1 + VAT_RATE); // ex-VAT revenue
  const gpGross = grossRevenue - cogs;
  const gpNet = netRevenue - cogs;
  const gpPctGross = (gpGross / grossRevenue) * 100;
  const gpPctNet = (gpNet / netRevenue) * 100;

  const zeroCostItems = perItem.filter(p => p.cost === 0 && p.qty > 0);

  console.log('=== GP ANALYSIS (Pizzas excluded) ===');
  console.log(`Gross revenue (inc VAT):    £${grossRevenue.toFixed(2)}`);
  console.log(`Net revenue (ex VAT @20%):  £${netRevenue.toFixed(2)}`);
  console.log(`Total COGS:                  £${cogs.toFixed(2)}`);
  console.log(`GP £ (on gross):             £${gpGross.toFixed(2)}`);
  console.log(`GP £ (on net/ex-VAT):        £${gpNet.toFixed(2)}`);
  console.log(`GP% (on gross price):        ${gpPctGross.toFixed(2)}%  <-- matches menu-management view formula`);
  console.log(`GP% (on net/ex-VAT):         ${gpPctNet.toFixed(2)}%  <-- TRUE accounting GP%`);

  console.log('\n=== SKIPPED (not priced in menu-management) ===');
  for (const [reason, info] of Object.entries(skippedByReason)) {
    console.log(`  ${reason}: ${info.qty} units across ${info.items.length} items`);
  }

  if (zeroCostItems.length) {
    console.log('\n=== DISHES WITH ZERO PORTION COST (skewing GP upward) ===');
    for (const z of zeroCostItems.sort((a, b) => b.revenue - a.revenue)) {
      console.log(`  ${z.name}  qty=${z.qty}  rev=£${z.revenue.toFixed(2)}  cost=£0`);
    }
  }

  if (issues.length) {
    console.log('\n=== ISSUES ===');
    issues.forEach(i => console.log('  ' + i));
  }

  // Item breakdown top contributors
  console.log('\n=== TOP 10 REVENUE CONTRIBUTORS ===');
  const sorted = [...perItem].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  for (const s of sorted) {
    console.log(`  £${s.revenue.toFixed(0).padStart(6)}  qty=${String(s.qty).padStart(3)}  gp=${s.gpPct.toFixed(1)}%  ${s.name}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
