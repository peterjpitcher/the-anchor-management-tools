/**
 * Fix ingredient gaps identified by the verification audit.
 *
 * 1. Create tartare sauce + bamboo stick ingredients, add to fish dishes as removable
 * 2. Re-add ice cream to Sticky Toffee Pudding as choice (Accompaniment)
 * 3. Create Salt & Chilli Squid & Chips dish with ingredients
 *
 * Run with: npx tsx scripts/database/fix-ingredient-gaps.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fix() {
  console.log('=== Fixing Ingredient Gaps ===\n');

  // ---- 1. Create tartare sauce ingredient ----
  console.log('1. Creating tartare sauce ingredient...');
  const { data: tartare, error: tartareErr } = await supabase
    .from('menu_ingredients')
    .upsert(
      {
        name: 'Tartare Sauce',
        description: 'House tartare sauce served with fish dishes',
        default_unit: 'portion',
        storage_type: 'chilled',
        pack_cost: 0,
        is_active: true,
        allergens: ['eggs', 'mustard'],
        dietary_flags: ['gluten_free'],
      },
      { onConflict: 'name', ignoreDuplicates: true }
    )
    .select('id, name')
    .single();

  // If upsert didn't return (already exists), find it
  let tartareId: string;
  if (tartare) {
    tartareId = tartare.id;
    console.log(`  Created: ${tartare.name} (${tartare.id})`);
  } else {
    const { data: existing } = await supabase
      .from('menu_ingredients')
      .select('id, name')
      .ilike('name', '%tartar%')
      .single();
    if (!existing) {
      // Try insert without upsert
      const { data: inserted, error: insErr } = await supabase
        .from('menu_ingredients')
        .insert({
          name: 'Tartare Sauce',
          description: 'House tartare sauce served with fish dishes',
          default_unit: 'portion',
          storage_type: 'chilled',
          pack_cost: 0,
          is_active: true,
          allergens: ['eggs', 'mustard'],
          dietary_flags: ['gluten_free'],
        })
        .select('id, name')
        .single();
      if (insErr) {
        console.error('  Failed to create tartare sauce:', insErr.message);
        return;
      }
      tartareId = inserted!.id;
      console.log(`  Created: ${inserted!.name} (${inserted!.id})`);
    } else {
      tartareId = existing.id;
      console.log(`  Already exists: ${existing.name} (${existing.id})`);
    }
  }

  // ---- 2. Create bamboo stick ingredient ----
  console.log('\n2. Creating bamboo stick ingredient...');
  let bambooId: string;
  const { data: bamboo } = await supabase
    .from('menu_ingredients')
    .select('id, name')
    .ilike('name', '%bamboo%')
    .single();

  if (bamboo) {
    bambooId = bamboo.id;
    console.log(`  Already exists: ${bamboo.name} (${bamboo.id})`);
  } else {
    const { data: newBamboo, error: bambooErr } = await supabase
      .from('menu_ingredients')
      .insert({
        name: 'Bamboo Stick',
        description: 'Decorative bamboo stick for fish dish presentation',
        default_unit: 'each',
        storage_type: 'ambient',
        pack_cost: 0,
        is_active: true,
        allergens: [],
        dietary_flags: ['vegan', 'vegetarian', 'gluten_free'],
      })
      .select('id, name')
      .single();
    if (bambooErr) {
      console.error('  Failed to create bamboo stick:', bambooErr.message);
      return;
    }
    bambooId = newBamboo!.id;
    console.log(`  Created: ${newBamboo!.name} (${newBamboo!.id})`);
  }

  // ---- 3. Add tartare sauce + bamboo stick to fish dishes ----
  console.log('\n3. Adding tartare sauce + bamboo stick to fish dishes...');

  const fishDishNames = ['Fish & Chips', 'Half Fish & Chips', 'Scampi & Chips'];
  const { data: fishDishes } = await supabase
    .from('menu_dishes')
    .select('id, name')
    .in('name', fishDishNames);

  if (!fishDishes || fishDishes.length === 0) {
    console.error('  No fish dishes found!');
  } else {
    for (const dish of fishDishes) {
      // Add tartare sauce (removable)
      const { error: t1 } = await supabase
        .from('menu_dish_ingredients')
        .upsert(
          {
            dish_id: dish.id,
            ingredient_id: tartareId,
            quantity: 1,
            unit: 'portion',
            inclusion_type: 'removable',
          },
          { onConflict: 'dish_id,ingredient_id', ignoreDuplicates: true }
        );
      if (t1) console.error(`  Failed tartare on ${dish.name}:`, t1.message);
      else console.log(`  Added tartare sauce to ${dish.name} (removable)`);

      // Add bamboo stick (removable)
      const { error: b1 } = await supabase
        .from('menu_dish_ingredients')
        .upsert(
          {
            dish_id: dish.id,
            ingredient_id: bambooId,
            quantity: 1,
            unit: 'each',
            inclusion_type: 'removable',
          },
          { onConflict: 'dish_id,ingredient_id', ignoreDuplicates: true }
        );
      if (b1) console.error(`  Failed bamboo on ${dish.name}:`, b1.message);
      else console.log(`  Added bamboo stick to ${dish.name} (removable)`);
    }
  }

  // ---- 4. Re-add ice cream to Sticky Toffee Pudding as choice ----
  console.log('\n4. Re-adding ice cream to Sticky Toffee Pudding...');

  const { data: stickyToffee } = await supabase
    .from('menu_dishes')
    .select('id, name')
    .eq('name', 'Sticky Toffee Pudding')
    .single();

  const { data: iceCream } = await supabase
    .from('menu_ingredients')
    .select('id, name')
    .ilike('name', '%ice cream%')
    .limit(1)
    .single();

  if (stickyToffee && iceCream) {
    // Also update existing custard to be choice/Accompaniment if not already
    const { data: custardRow } = await supabase
      .from('menu_dish_ingredients')
      .select('id, inclusion_type, option_group')
      .eq('dish_id', stickyToffee.id)
      .ilike('ingredient:menu_ingredients(name)', '%custard%')
      .single();

    // Update custard to choice if it's still included
    await supabase
      .from('menu_dish_ingredients')
      .update({ inclusion_type: 'choice', option_group: 'Accompaniment' })
      .eq('dish_id', stickyToffee.id)
      .neq('inclusion_type', 'choice');

    // Re-check if custard needs updating via direct query
    const { data: custardRows } = await supabase
      .from('menu_dish_ingredients')
      .select('id, ingredient_id, inclusion_type, option_group, ingredient:menu_ingredients(name)')
      .eq('dish_id', stickyToffee.id);

    if (custardRows) {
      for (const row of custardRows) {
        const ingName = (row.ingredient as any)?.name || '';
        if (/custard/i.test(ingName) && row.inclusion_type !== 'choice') {
          await supabase
            .from('menu_dish_ingredients')
            .update({ inclusion_type: 'choice', option_group: 'Accompaniment' })
            .eq('id', row.id);
          console.log(`  Updated custard to choice/Accompaniment on Sticky Toffee`);
        }
      }
    }

    // Add ice cream as choice/Accompaniment
    const { error: iceErr } = await supabase
      .from('menu_dish_ingredients')
      .upsert(
        {
          dish_id: stickyToffee.id,
          ingredient_id: iceCream.id,
          quantity: 2,
          unit: 'portion',
          inclusion_type: 'choice',
          option_group: 'Accompaniment',
        },
        { onConflict: 'dish_id,ingredient_id', ignoreDuplicates: false }
      );
    if (iceErr) {
      console.error(`  Failed to add ice cream:`, iceErr.message);
    } else {
      console.log(`  Added ice cream to Sticky Toffee Pudding (choice/Accompaniment)`);
    }
  } else {
    console.error('  Could not find Sticky Toffee Pudding or ice cream ingredient');
  }

  // ---- 5. Create Salt & Chilli Squid & Chips dish ----
  console.log('\n5. Creating Salt & Chilli Squid & Chips dish...');

  // Check if it already exists
  const { data: existingSquid } = await supabase
    .from('menu_dishes')
    .select('id')
    .eq('name', 'Salt & Chilli Squid & Chips')
    .single();

  if (existingSquid) {
    console.log('  Dish already exists, skipping creation');
  } else {
    // Find ingredients we need
    const { data: chips } = await supabase
      .from('menu_ingredients')
      .select('id, name')
      .ilike('name', '%straight cut chips%')
      .limit(1)
      .single();

    const { data: steakChips } = await supabase
      .from('menu_ingredients')
      .select('id, name')
      .ilike('name', '%steak cut%')
      .limit(1)
      .single();

    const { data: sweetPotato } = await supabase
      .from('menu_ingredients')
      .select('id, name')
      .ilike('name', '%sweet potato%')
      .limit(1)
      .single();

    // Check for squid ingredient
    let squidId: string;
    const { data: squid } = await supabase
      .from('menu_ingredients')
      .select('id, name')
      .ilike('name', '%squid%')
      .limit(1)
      .single();

    if (squid) {
      squidId = squid.id;
      console.log(`  Found squid ingredient: ${squid.name}`);
    } else {
      const { data: newSquid, error: squidErr } = await supabase
        .from('menu_ingredients')
        .insert({
          name: 'Salt & Chilli Squid',
          description: 'Salt and chilli seasoned squid pieces',
          default_unit: 'each',
          storage_type: 'frozen',
          pack_cost: 0,
          is_active: true,
          allergens: ['molluscs'],
          dietary_flags: [],
        })
        .select('id, name')
        .single();
      if (squidErr) {
        console.error('  Failed to create squid ingredient:', squidErr.message);
        return;
      }
      squidId = newSquid!.id;
      console.log(`  Created squid ingredient: ${newSquid!.name}`);
    }

    // Find a menu to assign to (website_food)
    const { data: menus } = await supabase
      .from('menu_menus')
      .select('id, code')
      .eq('code', 'website_food')
      .single();

    // Find a category (wraps & smaller plates or similar)
    const { data: categories } = await supabase
      .from('menu_categories')
      .select('id, code, name')
      .ilike('name', '%smaller%');

    const menuId = menus?.id;
    const categoryId = categories?.[0]?.id;

    if (!menuId || !categoryId) {
      console.log('  Warning: Could not find menu/category for assignment. Creating dish without assignment.');
    }

    // Build dish payload
    const ingredients = [
      { ingredient_id: squidId, quantity: 5, unit: 'each', inclusion_type: 'included' },
    ];

    if (chips) {
      ingredients.push({ ingredient_id: chips.id, quantity: 1, unit: 'portion', inclusion_type: 'included' });
    }
    if (steakChips) {
      ingredients.push({ ingredient_id: steakChips.id, quantity: 1, unit: 'portion', inclusion_type: 'upgrade' as any });
    }
    if (sweetPotato) {
      ingredients.push({ ingredient_id: sweetPotato.id, quantity: 1, unit: 'portion', inclusion_type: 'upgrade' as any });
    }

    // Create the dish directly
    const { data: newDish, error: dishErr } = await supabase
      .from('menu_dishes')
      .insert({
        name: 'Salt & Chilli Squid & Chips',
        description: '5 salt and chilli squid with chips and your choice of dip.',
        selling_price: 9.00,
        is_active: true,
        is_sunday_lunch: false,
      })
      .select('id, name')
      .single();

    if (dishErr) {
      console.error('  Failed to create dish:', dishErr.message);
    } else {
      console.log(`  Created dish: ${newDish!.name} (${newDish!.id})`);

      // Add ingredients
      for (const ing of ingredients) {
        const upgradeParts = ing.inclusion_type === 'upgrade'
          ? { option_group: 'Chips upgrade', upgrade_price: ing.ingredient_id === sweetPotato?.id ? 2.00 : 0 }
          : {};

        const { error: ingErr } = await supabase
          .from('menu_dish_ingredients')
          .insert({
            dish_id: newDish!.id,
            ingredient_id: ing.ingredient_id,
            quantity: ing.quantity,
            unit: ing.unit,
            inclusion_type: ing.inclusion_type,
            ...upgradeParts,
          });
        if (ingErr) console.error(`  Failed to add ingredient:`, ingErr.message);
      }
      console.log(`  Added ${ingredients.length} ingredients`);

      // Add menu assignment if we have menu/category
      if (menuId && categoryId) {
        await supabase
          .from('menu_dish_menu_assignments')
          .insert({
            dish_id: newDish!.id,
            menu_id: menuId,
            category_id: categoryId,
            sort_order: 0,
          });
        console.log(`  Assigned to website_food menu`);
      }

      // Refresh calculations
      await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: newDish!.id });
      console.log(`  Refreshed GP calculations`);
    }
  }

  // ---- 6. Refresh all affected dishes ----
  console.log('\n6. Refreshing GP calculations for affected dishes...');
  const affectedDishes = [...fishDishNames, 'Sticky Toffee Pudding'];
  const { data: toRefresh } = await supabase
    .from('menu_dishes')
    .select('id, name')
    .in('name', affectedDishes);

  if (toRefresh) {
    for (const dish of toRefresh) {
      const { error: refreshErr } = await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: dish.id });
      if (refreshErr) console.error(`  Failed to refresh ${dish.name}:`, refreshErr.message);
      else console.log(`  Refreshed ${dish.name}`);
    }
  }

  console.log('\n=== Done ===');
}

fix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
