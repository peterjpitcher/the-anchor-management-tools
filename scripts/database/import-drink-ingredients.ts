/**
 * Import drink ingredients from till CSV and link to drink dishes.
 *
 * Creates ingredients with correct portions_per_pack based on industry yields:
 * - Draught kegs: 50L = ~88 pints (50000ml / 568ml)
 * - Spirit bottles: 70cl = 28 x 25ml singles; 1.5L = 60 x 25ml singles
 * - Wine bottles: 750ml = ~4.3 x 175ml glasses; 187ml = 1 glass
 * - Bottled beer/cider: 1 case = N bottles (from order_unit)
 * - Soft drinks/mixers: per unit
 *
 * Run with: npx tsx scripts/database/import-drink-ingredients.ts
 * Add --commit to apply changes.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DRY_RUN = !process.argv.includes('--commit');

// ── CSV Parsing ──────────────────────────────────────────────────────────

function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

function loadCsv(path: string): Record<string, string>[] {
  const csv = fs.readFileSync(path, 'utf8');
  const lines = csv.split('\n');
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const fields = parseLine(l);
    const obj: Record<string, string> = {};
    header.forEach((h, i) => obj[h] = fields[i] || '');
    return obj;
  });
}

// ── Yield calculations ───────────────────────────────────────────────────

const PINT_ML = 568;
const HALF_PINT_ML = 284;
const SINGLE_MEASURE_ML = 25;
const WINE_GLASS_ML = 175;
const SPLASH_ML = 50;

interface IngredientSpec {
  name: string;
  packCost: number;
  packSize: number;
  packSizeUnit: string;
  portionsPerPack: number;
  portionUnit: string;
  abv: number | null;
  storageType: string;
  category: string; // till category for reference
}

interface DishLink {
  dishName: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  measureMl: number | null;
}

// ── Build ingredients and links from till data ───────────────────────────

function processDraughtItems(rows: Record<string, string>[]): { ingredients: IngredientSpec[]; links: DishLink[] } {
  const ingredients: IngredientSpec[] = [];
  const links: DishLink[] = [];
  const seen = new Set<string>();

  // Group by base beer name (strip "Half "/"Pint " prefix)
  for (const row of rows) {
    const name = row.product_name;
    const costPrice = parseFloat(row.cost_price) || 0;
    const orderUnit = parseFloat(row.order_unit) || 1;

    // Extract base name and size info from product name
    // e.g. "Pint Birra Moretti 4.6 50L" -> base="Birra Moretti", abv=4.6, volume=50L
    const isHalf = name.startsWith('Half ');
    const isPint = name.startsWith('Pint ');
    const baseName = name.replace(/^(Half|Pint)\s+/, '');

    // Parse ABV from name (look for number like 4.6, 4.1, 3.7)
    const abvMatch = baseName.match(/\b(\d+\.\d+)\b/);
    const abv = abvMatch ? parseFloat(abvMatch[1]) : null;

    // Parse keg volume from name (look for 50L, 30Ltr, 11G etc)
    const volMatch = baseName.match(/(\d+)\s*(?:L(?:tr)?|G)\b/i);
    let kegLitres = 50; // default
    if (volMatch) {
      const val = parseInt(volMatch[1]);
      const isGallons = baseName.match(/\d+\s*G\b/i);
      kegLitres = isGallons ? val * 4.546 : val; // convert gallons
    }

    const pintsPerKeg = Math.round((kegLitres * 1000) / PINT_ML);

    // Create ingredient (one per base beer, using pint cost data)
    const ingredientName = `${baseName} (Keg)`;
    if (!seen.has(ingredientName.toLowerCase()) && isPint && costPrice > 0) {
      seen.add(ingredientName.toLowerCase());
      // Pack cost from till = cost per keg (cost_price is per order_unit, but for kegs order_unit=1 usually)
      const packCost = costPrice * orderUnit; // total cost for order_unit kegs
      ingredients.push({
        name: ingredientName,
        packCost: costPrice, // cost per keg
        packSize: kegLitres,
        packSizeUnit: 'litre',
        portionsPerPack: pintsPerKeg,
        portionUnit: 'pint',
        abv,
        storageType: 'chilled',
        category: row.reporting_category,
      });
    }

    // Create dish link
    links.push({
      dishName: name,
      ingredientName,
      quantity: isHalf ? 0.5 : 1,
      unit: 'portion',
      measureMl: isHalf ? HALF_PINT_ML : PINT_ML,
    });
  }

  return { ingredients, links };
}

function processShandyItems(rows: Record<string, string>[], draughtIngredients: IngredientSpec[]): { links: DishLink[] } {
  const links: DishLink[] = [];

  for (const row of rows) {
    const name = row.product_name; // e.g. "Half Moretti Shandy"
    const isHalf = name.startsWith('Half ');
    const baseName = name.replace(/^(Half|Pint)\s+/, '').replace(/\s+Shandy$/i, '');

    // Find matching draught ingredient
    const matchingIng = draughtIngredients.find(i =>
      i.name.toLowerCase().includes(baseName.toLowerCase())
    );

    if (matchingIng) {
      // Shandy = half beer, half lemonade (so a pint shandy = 0.5 pint beer + 0.5 pint lemonade)
      const beerQty = isHalf ? 0.25 : 0.5;
      links.push({
        dishName: name,
        ingredientName: matchingIng.name,
        quantity: beerQty,
        unit: 'portion',
        measureMl: isHalf ? HALF_PINT_ML / 2 : PINT_ML / 2,
      });
    }

    // Add lemonade component (will be created as a separate ingredient)
    links.push({
      dishName: name,
      ingredientName: 'Post-Mix Lemonade',
      quantity: isHalf ? 0.25 : 0.5,
      unit: 'portion',
      measureMl: isHalf ? HALF_PINT_ML / 2 : PINT_ML / 2,
    });
  }

  return { links };
}

function processBottledItems(rows: Record<string, string>[]): { ingredients: IngredientSpec[]; links: DishLink[] } {
  const ingredients: IngredientSpec[] = [];
  const links: DishLink[] = [];

  for (const row of rows) {
    const name = row.product_name;
    const costPrice = parseFloat(row.cost_price) || 0;
    const orderUnit = parseFloat(row.order_unit) || 1;

    if (costPrice <= 0) continue;

    const ingredientName = `${name} (Bottle)`;
    ingredients.push({
      name: ingredientName,
      packCost: costPrice,
      packSize: orderUnit,
      packSizeUnit: 'each',
      portionsPerPack: orderUnit, // bottles per case
      portionUnit: 'each',
      abv: null, // could parse from description
      storageType: 'chilled',
      category: row.reporting_category,
    });

    links.push({
      dishName: name,
      ingredientName,
      quantity: 1,
      unit: 'each',
      measureMl: null,
    });
  }

  return { ingredients, links };
}

function processSpiritItems(rows: Record<string, string>[]): { ingredients: IngredientSpec[]; links: DishLink[] } {
  const ingredients: IngredientSpec[] = [];
  const links: DishLink[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const name = row.product_name;
    const costPrice = parseFloat(row.cost_price) || 0;
    const orderUnit = parseFloat(row.order_unit) || 1;

    if (costPrice <= 0) continue;

    const isDouble = name.startsWith('Double ');
    const isSingle = name.startsWith('Single ');
    const baseName = name.replace(/^(Single|Double)\s+/, '');

    // Determine bottle size from name
    const is1_5L = baseName.includes('1.5L');
    const bottleMl = is1_5L ? 1500 : 700; // default 70cl
    const measuresPerBottle = Math.floor(bottleMl / SINGLE_MEASURE_ML);

    const ingredientName = `${baseName} (${is1_5L ? '1.5L' : '70cl'})`;

    // Create ingredient from single entries (they have the per-bottle cost)
    if (!seen.has(ingredientName.toLowerCase()) && isSingle && costPrice > 0) {
      seen.add(ingredientName.toLowerCase());
      ingredients.push({
        name: ingredientName,
        packCost: costPrice, // cost per bottle
        packSize: bottleMl / 1000,
        packSizeUnit: 'litre',
        portionsPerPack: measuresPerBottle,
        portionUnit: 'measure',
        abv: null,
        storageType: 'ambient',
        category: row.reporting_category,
      });
    }

    // Link dish
    links.push({
      dishName: name,
      ingredientName,
      quantity: isDouble ? 2 : 1,
      unit: 'portion',
      measureMl: isDouble ? SINGLE_MEASURE_ML * 2 : SINGLE_MEASURE_ML,
    });
  }

  return { ingredients, links };
}

function processWineItems(rows: Record<string, string>[]): { ingredients: IngredientSpec[]; links: DishLink[] } {
  const ingredients: IngredientSpec[] = [];
  const links: DishLink[] = [];

  for (const row of rows) {
    const name = row.product_name;
    const costPrice = parseFloat(row.cost_price) || 0;
    const orderUnit = parseFloat(row.order_unit) || 1;

    if (costPrice <= 0) continue;

    const is187 = name.includes('187ml');
    const is750 = name.includes('750ml');
    const is175 = name.includes('175ml');

    // For 187ml single serve - 1 portion per bottle
    // For 750ml - ~4.3 glasses of 175ml
    const ingredientName = `${name.replace(/\s*\(\d+ml\)/, '')} (Bottle)`;
    const bottleMl = is187 ? 187 : 750;
    const portionsPerBottle = is187 ? 1 : Math.floor(750 / WINE_GLASS_ML); // 4 glasses

    // Check if we already have this wine as a 750ml ingredient
    const existing = ingredients.find(i => i.name === ingredientName);
    if (!existing) {
      ingredients.push({
        name: ingredientName,
        packCost: costPrice,
        packSize: orderUnit,
        packSizeUnit: 'each',
        portionsPerPack: is187 ? orderUnit : orderUnit * portionsPerBottle,
        portionUnit: is187 ? 'each' : 'glass',
        abv: null,
        storageType: 'ambient',
        category: row.reporting_category,
      });
    }

    if (is187) {
      // Single serve glass = 1 portion
      links.push({
        dishName: name,
        ingredientName,
        quantity: 1,
        unit: 'each',
        measureMl: 187,
      });
    } else if (is750) {
      // Full bottle = all glasses
      links.push({
        dishName: name,
        ingredientName,
        quantity: portionsPerBottle,
        unit: 'portion',
        measureMl: 750,
      });
    } else {
      // Mulled wine etc - treat as single portion
      const ingName = `${name} (Bottle)`;
      if (!ingredients.find(i => i.name === ingName)) {
        ingredients.push({
          name: ingName,
          packCost: costPrice,
          packSize: orderUnit,
          packSizeUnit: 'each',
          portionsPerPack: orderUnit,
          portionUnit: 'each',
          abv: null,
          storageType: 'ambient',
          category: row.reporting_category,
        });
      }
      links.push({
        dishName: name,
        ingredientName: ingName,
        quantity: 1,
        unit: 'each',
        measureMl: WINE_GLASS_ML,
      });
    }
  }

  return { ingredients, links };
}

function processSimpleItems(rows: Record<string, string>[], storageType: string): { ingredients: IngredientSpec[]; links: DishLink[] } {
  const ingredients: IngredientSpec[] = [];
  const links: DishLink[] = [];

  for (const row of rows) {
    const name = row.product_name;
    const costPrice = parseFloat(row.cost_price) || 0;
    const orderUnit = parseFloat(row.order_unit) || 1;
    const salePrice = parseFloat(row.sale_price) || 0;

    if (salePrice <= 0) continue;

    const ingredientName = `${name} (Stock)`;

    if (costPrice > 0) {
      ingredients.push({
        name: ingredientName,
        packCost: costPrice,
        packSize: orderUnit,
        packSizeUnit: 'each',
        portionsPerPack: orderUnit,
        portionUnit: 'each',
        abv: null,
        storageType,
        category: row.reporting_category,
      });
    }

    links.push({
      dishName: name,
      ingredientName,
      quantity: 1,
      unit: 'each',
      measureMl: null,
    });
  }

  return { ingredients, links };
}

function processCocktailItems(rows: Record<string, string>[]): { ingredients: IngredientSpec[]; links: DishLink[] } {
  // Cocktails are complex - multiple spirits/mixers per drink.
  // For now, treat each cocktail as a single-ingredient item with the cost from the till.
  // Proper cocktail recipes would need manual setup.
  const ingredients: IngredientSpec[] = [];
  const links: DishLink[] = [];

  for (const row of rows) {
    const name = row.product_name;
    const costPrice = parseFloat(row.cost_price) || 0;
    const orderUnit = parseFloat(row.order_unit) || 1;
    const salePrice = parseFloat(row.sale_price) || 0;

    if (salePrice <= 0) continue;

    // For cocktails, cost_price / order_unit gives per-cocktail ingredient cost
    const perServe = costPrice > 0 ? costPrice / orderUnit : 0;

    if (perServe > 0) {
      const ingredientName = `${name} (Cocktail Mix)`;
      ingredients.push({
        name: ingredientName,
        packCost: costPrice,
        packSize: orderUnit,
        packSizeUnit: 'each',
        portionsPerPack: orderUnit,
        portionUnit: 'each',
        abv: null,
        storageType: 'ambient',
        category: row.reporting_category,
      });

      links.push({
        dishName: name,
        ingredientName,
        quantity: 1,
        unit: 'each',
        measureMl: null,
      });
    }
  }

  return { ingredients, links };
}

function processMixerItems(rows: Record<string, string>[]): { ingredients: IngredientSpec[]; links: DishLink[] } {
  const ingredients: IngredientSpec[] = [];
  const links: DishLink[] = [];
  const seen = new Set<string>();

  // Mixers include post-mix (pint/half/splash), bottled mixers, cordials
  for (const row of rows) {
    const name = row.product_name;
    const costPrice = parseFloat(row.cost_price) || 0;
    const orderUnit = parseFloat(row.order_unit) || 1;
    const salePrice = parseFloat(row.sale_price) || 0;

    if (salePrice <= 0) continue;

    const isHalf = name.startsWith('Half ');
    const isPint = name.startsWith('Pint ');
    const isSplash = name.startsWith('Splash');

    // Post-mix items (Coke, Diet Coke, Lemonade, Soda)
    if (isHalf || isPint || isSplash) {
      const baseName = name.replace(/^(Half|Pint|Splash)\s+(of\s+)?/, '');
      const ingredientName = `Post-Mix ${baseName}`;

      if (!seen.has(ingredientName.toLowerCase()) && costPrice > 0) {
        seen.add(ingredientName.toLowerCase());
        // Post-mix BIB (bag in box) - typically 7-10L syrup making ~50L of drink
        // Use pint pricing to derive: cost_price for a pint-selling item is the BIB cost
        if (isPint) {
          // A typical BIB makes ~300 pints
          ingredients.push({
            name: ingredientName,
            packCost: costPrice,
            packSize: 1,
            packSizeUnit: 'each',
            portionsPerPack: orderUnit, // BIBs per order
            portionUnit: 'pint',
            abv: null,
            storageType: 'ambient',
            category: row.reporting_category,
          });
        }
      }

      const qty = isSplash ? 0.1 : isHalf ? 0.5 : 1;
      links.push({
        dishName: name,
        ingredientName,
        quantity: qty,
        unit: 'portion',
        measureMl: isSplash ? SPLASH_ML : isHalf ? HALF_PINT_ML : PINT_ML,
      });
    } else {
      // Bottled/canned mixers (200ml tonics, cordials, juices)
      const ingredientName = `${name} (Stock)`;
      if (costPrice > 0) {
        ingredients.push({
          name: ingredientName,
          packCost: costPrice,
          packSize: orderUnit,
          packSizeUnit: 'each',
          portionsPerPack: orderUnit,
          portionUnit: 'each',
          abv: null,
          storageType: 'ambient',
          category: row.reporting_category,
        });
      }

      links.push({
        dishName: name,
        ingredientName,
        quantity: 1,
        unit: 'each',
        measureMl: null,
      });
    }
  }

  return { ingredients, links };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function run() {
  console.log(DRY_RUN ? '🔍 DRY RUN\n' : '🚀 COMMIT MODE\n');

  const rows = loadCsv('/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/product-list-export-2026-04-11-08-11-17.csv');
  const drinkRows = rows.filter(r => r.reporting_category.startsWith('Drinks >'));

  // Categorise
  const draught = drinkRows.filter(r => r.reporting_category === 'Drinks > Draught');
  const shandy = drinkRows.filter(r => r.reporting_category === 'Drinks > Draught > Shandy');
  const bottledAle = drinkRows.filter(r => r.reporting_category === 'Drinks > Bottles > Bottled Ale');
  const bottledBeer = drinkRows.filter(r => r.reporting_category === 'Drinks > Bottles > Bottled Beer');
  const bottledCider = drinkRows.filter(r => r.reporting_category === 'Drinks > Bottles > Bottled Cider');
  const cocktails = drinkRows.filter(r => r.reporting_category === 'Drinks > Cocktails');
  const mixers = drinkRows.filter(r => r.reporting_category === 'Drinks > Mixers');
  const softDrinks = drinkRows.filter(r => r.reporting_category === 'Drinks > Soft Drinks');
  const snacks = drinkRows.filter(r => r.reporting_category === 'Drinks > Snacks & Sweets');

  // All spirit categories
  const spirits = drinkRows.filter(r => r.reporting_category.startsWith('Drinks > Spirits >'));

  // All wine categories
  const wines = drinkRows.filter(r => r.reporting_category.startsWith('Drinks > Wines >'));

  // Process each type
  const allIngredients: IngredientSpec[] = [];
  const allLinks: DishLink[] = [];

  const draughtResult = processDraughtItems(draught);
  allIngredients.push(...draughtResult.ingredients);
  allLinks.push(...draughtResult.links);

  const shandyResult = processShandyItems(shandy, draughtResult.ingredients);
  allLinks.push(...shandyResult.links);

  const spiritResult = processSpiritItems(spirits);
  allIngredients.push(...spiritResult.ingredients);
  allLinks.push(...spiritResult.links);

  const wineResult = processWineItems(wines);
  allIngredients.push(...wineResult.ingredients);
  allLinks.push(...wineResult.links);

  for (const [items, type] of [
    [bottledAle, 'chilled'], [bottledBeer, 'chilled'], [bottledCider, 'chilled'],
  ] as const) {
    const result = processBottledItems(items as Record<string, string>[]);
    allIngredients.push(...result.ingredients);
    allLinks.push(...result.links);
  }

  const cocktailResult = processCocktailItems(cocktails);
  allIngredients.push(...cocktailResult.ingredients);
  allLinks.push(...cocktailResult.links);

  const mixerResult = processMixerItems(mixers);
  allIngredients.push(...mixerResult.ingredients);
  allLinks.push(...mixerResult.links);

  const softResult = processSimpleItems(softDrinks, 'ambient');
  allIngredients.push(...softResult.ingredients);
  allLinks.push(...softResult.links);

  const snackResult = processSimpleItems(snacks, 'ambient');
  allIngredients.push(...snackResult.ingredients);
  allLinks.push(...snackResult.links);

  // Add post-mix lemonade ingredient (used by shandies)
  if (!allIngredients.find(i => i.name === 'Post-Mix Lemonade')) {
    allIngredients.push({
      name: 'Post-Mix Lemonade',
      packCost: 25.00, // typical BIB cost
      packSize: 1,
      packSizeUnit: 'each',
      portionsPerPack: 300, // ~300 pints per BIB
      portionUnit: 'pint',
      abv: null,
      storageType: 'ambient',
      category: 'Drinks > Mixers',
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`Ingredients to create: ${allIngredients.length}`);
  console.log(`Dish-ingredient links: ${allLinks.length}`);

  // Show breakdown
  const cats = new Map<string, number>();
  for (const i of allIngredients) {
    cats.set(i.category, (cats.get(i.category) || 0) + 1);
  }
  console.log('\nIngredients by category:');
  for (const [cat, count] of [...cats.entries()].sort()) {
    console.log(`  ${cat}: ${count}`);
  }

  // Show some examples
  console.log('\nExample ingredients:');
  for (const i of allIngredients.slice(0, 5)) {
    const unitCost = (i.packCost / i.portionsPerPack).toFixed(4);
    console.log(`  ${i.name}: pack £${i.packCost} / ${i.portionsPerPack} ${i.portionUnit}s = £${unitCost} per ${i.portionUnit}`);
  }

  console.log('\nExample links:');
  for (const l of allLinks.slice(0, 10)) {
    console.log(`  ${l.dishName} → ${l.ingredientName} (qty: ${l.quantity}, ${l.measureMl ? l.measureMl + 'ml' : 'n/a'})`);
  }

  if (DRY_RUN) {
    console.log('\nRun with --commit to apply.');
    return;
  }

  // ── Create ingredients ─────────────────────────────────────────────────
  console.log('\n═══ CREATING INGREDIENTS ═══\n');
  let createdIngs = 0;
  let skippedIngs = 0;
  const ingIdMap = new Map<string, string>();

  for (const spec of allIngredients) {
    // Check if exists
    const { data: existing } = await supabase
      .from('menu_ingredients')
      .select('id')
      .eq('name', spec.name)
      .limit(1);

    if (existing && existing.length > 0) {
      ingIdMap.set(spec.name.toLowerCase(), existing[0].id);
      // Update cost data
      await supabase.from('menu_ingredients').update({
        pack_cost: spec.packCost,
        pack_size: spec.packSize,
        pack_size_unit: spec.packSizeUnit,
        portions_per_pack: spec.portionsPerPack,
        default_unit: spec.portionUnit,
        storage_type: spec.storageType,
        abv: spec.abv,
      }).eq('id', existing[0].id);
      skippedIngs++;
      continue;
    }

    const { data: ing, error } = await supabase
      .from('menu_ingredients')
      .insert({
        name: spec.name,
        pack_cost: spec.packCost,
        pack_size: spec.packSize,
        pack_size_unit: spec.packSizeUnit,
        portions_per_pack: spec.portionsPerPack,
        default_unit: spec.portionUnit,
        storage_type: spec.storageType,
        abv: spec.abv,
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`  Failed: ${spec.name} — ${error.message}`);
    } else {
      ingIdMap.set(spec.name.toLowerCase(), ing.id);
      createdIngs++;
    }
  }
  console.log(`Created: ${createdIngs}, Updated: ${skippedIngs}`);

  // ── Link ingredients to dishes ─────────────────────────────────────────
  console.log('\n═══ LINKING TO DISHES ═══\n');
  let linked = 0;
  let linkFailed = 0;

  for (const link of allLinks) {
    // Find dish
    const { data: dishes } = await supabase
      .from('menu_dishes')
      .select('id')
      .eq('name', link.dishName)
      .limit(1);

    if (!dishes || dishes.length === 0) {
      continue; // dish not in DB
    }

    const dishId = dishes[0].id;
    const ingId = ingIdMap.get(link.ingredientName.toLowerCase());

    if (!ingId) {
      // Try to find in DB directly
      const { data: ings } = await supabase
        .from('menu_ingredients')
        .select('id')
        .eq('name', link.ingredientName)
        .limit(1);
      if (!ings || ings.length === 0) {
        continue;
      }
      ingIdMap.set(link.ingredientName.toLowerCase(), ings[0].id);
    }

    const finalIngId = ingIdMap.get(link.ingredientName.toLowerCase());
    if (!finalIngId) continue;

    // Delete existing links for this dish-ingredient pair
    await supabase
      .from('menu_dish_ingredients')
      .delete()
      .eq('dish_id', dishId)
      .eq('ingredient_id', finalIngId);

    const { error } = await supabase
      .from('menu_dish_ingredients')
      .insert({
        dish_id: dishId,
        ingredient_id: finalIngId,
        quantity: link.quantity,
        unit: link.unit,
        measure_ml: link.measureMl,
      });

    if (error) {
      // Could be a dupe from multi-link cocktail, skip silently
      linkFailed++;
    } else {
      linked++;
    }
  }

  console.log(`Linked: ${linked}, Failed: ${linkFailed}`);
  console.log('\nDone! DB triggers will auto-recalculate portion_cost and gp_pct.');
}

run().catch(console.error);
