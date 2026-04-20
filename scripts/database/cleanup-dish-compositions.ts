/**
 * Clean up dish compositions based on the March 2026 Main Menu
 *
 * Removes paid add-on ingredients that were incorrectly included as part of base dishes.
 * Sets option groups where the menu offers genuine choices (puddings: custard or ice cream).
 *
 * Run with: npx tsx scripts/database/cleanup-dish-compositions.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Row IDs to DELETE (paid add-ons not part of base dish) ----
const ROWS_TO_DELETE: string[] = [
  // --- Fish & Chips: steak cut chips + sweet potato fries (menu: "chunky chips") ---
  '8a0dc4bf-c545-4a38-a540-00315efebd2f', // Steak Cut Chips
  'e13d05e2-3c30-482f-8b2f-df5e196bb09d', // Sweet Potato Fries

  // --- Half Fish & Chips: steak cut chips + sweet potato fries ---
  'e6bce518-d33d-4f1b-8b88-aee7b8aa6bb1', // Steak Cut Chips
  '801668e2-acdf-4eef-9c78-66a04174f53f', // Sweet Potato Fries

  // --- Scampi & Chips: steak cut chips + sweet potato fries ---
  'e7743167-bf28-449f-aede-98e04501f65b', // Steak Cut Chips
  'a8e970a0-d78b-4e60-af5f-4927db3fc5ac', // Sweet Potato Fries

  // --- Jumbo Sausage & Chips: steak cut chips + sweet potato fries ---
  '8c72f6ab-f5a9-400d-9864-8976c3d57837', // Steak Cut Chips
  '8ff852e9-8ca1-4cf1-a412-a30c1f1720c7', // Sweet Potato Fries

  // --- Sausage & Mash (Bangers & Mash): sweet potato fries (menu: "on creamy mash") ---
  '2212ad22-e19d-437b-a889-1e42a215a176', // Sweet Potato Fries

  // --- Beef & Ale Pie: steak cut chips + sweet potato fries (menu: "with mash, vegetables and gravy") ---
  '1f270d6a-7ac4-4610-8c7c-4dc15901dd4d', // Steak Cut Chips
  'cacec0ac-d710-47e5-b1b7-51049473d3f2', // Sweet Potato Fries

  // --- Chicken & Wild Mushroom Pie: steak cut chips + sweet potato fries ---
  '7f150987-38af-46c6-a832-e14e21a57bb9', // Steak Cut Chips
  'e67fd14e-6cb9-43e6-9272-5166f6e232d6', // Sweet Potato Fries

  // --- Chicken, Ham Hock & Leek Pie: steak cut chips + sweet potato fries ---
  'fcd95549-f995-4d7a-b1ac-a432917b6563', // Steak Cut Chips
  'b917d107-8257-41cb-8943-99954c257455', // Sweet Potato Fries

  // --- Butternut Squash Pie: steak cut chips + sweet potato fries ---
  'd1a64f0a-861c-4078-967f-a311ad9ccd00', // Steak Cut Chips
  '2dce1f01-3860-4153-8f21-765b7c91bd9e', // Sweet Potato Fries

  // --- Classic Beef Burger: steak cut chips, sweet potato fries, hash brown, cheese, onion rings, bacon ---
  // (menu: "Beef burger with salad, sauce and chips" — add-ons listed separately)
  '1a44793b-a979-4bcc-b117-068e5cd8edc1', // Steak Cut Chips
  '67ffe3cc-7b23-4130-9ad8-7e42f0dc45e4', // Sweet Potato Fries
  '8a65163d-b693-4241-a526-c2e187dd11cc', // Hash Brown
  '8449368f-603d-4de0-b22d-c8891245c5c2', // Cheddar
  '4d1f4afa-8eed-43e8-803f-7e009ae50452', // Onion Rings
  'e22a188e-5069-4b43-ad7f-5eae8ff54e2c', // Bacon

  // --- Chicken Burger: steak cut chips, sweet potato fries, hash brown, cheese, onion rings, bacon ---
  // (menu: "Breaded chicken fillet with salad and chips")
  'b105624c-0481-4ede-baf8-6645367064f8', // Steak Cut Chips
  '6c399e1a-5a00-40f5-9514-9b94114376fe', // Sweet Potato Fries
  '093c4de8-ccee-4449-bf64-c3f2798547ba', // Hash Brown
  '6ef6620e-25bb-454e-b494-e04176084481', // Cheddar
  '17d8dcca-35aa-4c43-a83d-48c311b74fcf', // Onion Rings
  '6e3e4b5c-e980-4363-b780-4ee8f99a2a52', // Bacon

  // --- Spicy Chicken Burger: steak cut chips, sweet potato fries, hash brown, cheese, onion rings, bacon ---
  // (menu: "Spicy chicken with salad, sauce and chips")
  'e45dcc25-5ede-45c6-b4a3-fd0d8ef20961', // Steak Cut Chips
  'f3383762-873f-43c9-aecb-f2b205afa854', // Sweet Potato Fries
  'ba2afd7d-10b4-4f28-abf5-fd420a57878a', // Hash Brown
  'c5a5456b-6d94-47bf-af65-bf3bc9e382dc', // Cheddar
  'baab5c6d-d923-4dc2-a128-e58b0c8fc3b9', // Onion Rings
  '870fcb1c-325a-45a4-9914-ae1841509b25', // Bacon

  // --- Garden Veg Burger: steak cut chips, sweet potato fries, hash brown, cheese, bacon ---
  // (menu: "Veggie stack with onion ring, salad and chips" — onion ring STAYS)
  '6a2b8c68-00e8-4d2a-95af-47152a38743c', // Steak Cut Chips
  '0d069dca-be23-4716-9eae-2c312c35a129', // Sweet Potato Fries
  'bc8aa3a4-7381-4a69-9121-e7857dac3147', // Hash Brown
  '3172b2ad-1197-4c08-9a0c-8dde37c77b81', // Cheddar
  '29e05ed5-6c5f-40c7-a9ad-01ef4cd72c6a', // Bacon

  // --- Beef Stack: steak cut chips, sweet potato fries, hash brown, cheese, bacon ---
  // (menu: "Double beef with onion ring, salad and chips" — onion ring STAYS)
  '17726e09-0052-40e5-9057-ddf7c44f4fa3', // Steak Cut Chips
  '00600dec-3036-41f5-92fe-cd3b846022fd', // Sweet Potato Fries
  '0debc415-5457-4e74-bd8e-21858bc86e0c', // Hash Brown
  '54ad4339-a4b5-4a7a-a713-4192c4416dc5', // Cheddar
  '182efcd3-658d-4a4a-8b58-1d52ee661837', // Bacon

  // --- Chicken Stack: steak cut chips, sweet potato fries, cheese, onion ring, bacon ---
  // (menu: "Chicken fillet with hash brown, salad and chips" — hash brown STAYS)
  'b358b189-1797-4346-8b8b-d19eeda597c1', // Steak Cut Chips
  '65391c52-90d6-4c04-9970-7caf8a35d923', // Sweet Potato Fries
  '40cd6554-8bad-4976-9d2f-9f9b9b446301', // Cheddar
  '276141d6-b6e4-49da-9f20-27e4fbe2b5fb', // Onion Ring
  'd61b120b-f709-4350-932e-98bcdbc23800', // Bacon

  // --- Spicy Chicken Stack: steak cut chips, sweet potato fries, cheese, onion ring, bacon ---
  // (menu: "Spicy chicken, hash brown, salad and chips" — hash brown STAYS)
  'cfac61e7-41cd-43b7-92a7-b09c1fa55ca9', // Steak Cut Chips
  'fe7e57b5-1161-4f23-8311-e98324eec5d6', // Sweet Potato Fries
  '8af9e2ba-fe2c-4842-a45f-f89d36d7a0d5', // Cheddar
  '5cf542a6-9ea5-48e5-a85f-585dddd87701', // Onion Ring
  '37c75e07-4df2-4493-9c23-e0f774dec33c', // Bacon

  // --- Veggie Stack: steak cut chips, sweet potato fries, hash brown, cheese, bacon ---
  // (menu: "2 veggie patties, onion ring, salad and chips" — onion ring STAYS)
  'b55f50e9-1839-49f5-8003-54564a43ef79', // Steak Cut Chips
  '7fec3186-3e57-46cc-97ee-fa4a54f291e5', // Sweet Potato Fries
  '4263949a-1e46-4399-b849-3d0c5e5bb670', // Hash Brown
  '0364e2ba-e6f2-4c83-9f97-eb688dd2a21d', // Cheddar
  'd60aa515-5d9c-4603-b50b-f929516e0766', // Bacon

  // --- Katsu Chicken Burger: steak cut chips, sweet potato fries, hash brown, cheese, onion ring, bacon ---
  // (menu: "Chicken fillet, katsu sauce, cucumber and chips")
  'd678b640-23de-4015-92d0-096243bb174c', // Steak Cut Chips
  'a07d4612-5020-4a6d-a2a0-0b02586adacd', // Sweet Potato Fries
  '691a3eb2-3b4f-4b5c-93d4-2f038af96a53', // Hash Brown
  'c28ff0de-50c1-49ac-a678-eca43427b5ca', // Cheddar
  '21a591a7-9ef0-4011-acc2-95bb34fcca4e', // Onion Ring
  'e4ae861a-0c8d-4212-ac93-fc78797b88b7', // Bacon
  '68084ce9-b066-4717-bb16-e3d1fd10b434', // Tomato (menu says cucumber, not tomato)

  // --- 3 Fish Fingers with Chips: steak cut chips + sweet potato fries ---
  '8c90c6f6-35c9-46f5-962d-9d61c26eb76e', // Steak Cut Chips
  '38776a56-50bb-45f6-895a-65bbb876917b', // Sweet Potato Fries

  // --- 4 Chicken Goujons with Chips: steak cut chips + sweet potato fries ---
  '401456fa-1154-4926-a5a7-093bf682eb85', // Steak Cut Chips
  'e5f050da-697b-46d6-a61a-89da9c06daf4', // Sweet Potato Fries

  // --- Chicken Goujon Wrap: steak cut chips + sweet potato fries ---
  '5aa1b512-8e40-4829-bb47-4f35a87337da', // Steak Cut Chips
  'bf079b6b-0b3c-4793-8bc2-26a0346f4592', // Sweet Potato Fries

  // --- Fish Finger Wrap: steak cut chips + sweet potato fries ---
  '1d6d8f88-c971-4c01-a129-124ed73e3d68', // Steak Cut Chips
  'b7373790-07cf-48b2-90ed-aee695146f45', // Sweet Potato Fries
];

// ---- Row IDs to set option_group = 'Accompaniment' (puddings: custard OR ice cream) ----
const PUDDING_OPTION_GROUP_ROWS: string[] = [
  // Apple Crumble: "served with custard or ice cream"
  '6e34d287-e952-4c93-99e0-b79de9cfcc9b', // Custard
  '1a2e37e4-08c1-45d5-97f4-adc39b893ae4', // Ice Cream

  // Chocolate Fudge Brownie: "served with custard or ice cream"
  '14708e1f-7ded-4328-9d26-196b70e14792', // Custard
  'cdd88ce0-4cb8-4151-b3e0-90acf4967245', // Ice Cream

  // Chocolate Fudge Cake: "served with cream or custard"
  'c7173bad-9986-4d6d-99e9-697f899c000d', // Custard
  '90016a30-1126-4a60-8463-a87d7771c460', // Ice Cream (note: menu says "cream" not "ice cream" — but DB has ice cream)

  // Sticky Toffee Pudding: "served warm with custard" (no choice, but custard + ice cream both in DB)
  // Menu says custard only, so ice cream should be removed
  'f8f07fc9-cd6b-4903-97f8-028758983c81', // Ice Cream — REMOVE (menu says custard only)
];

// Sticky Toffee Pudding ice cream removal
const STICKY_TOFFEE_ICE_CREAM_ROW = 'f8f07fc9-cd6b-4903-97f8-028758983c81';

async function cleanup() {
  console.log('=== Dish Composition Cleanup ===\n');

  // 1. Delete paid add-on rows
  console.log(`Deleting ${ROWS_TO_DELETE.length} paid add-on ingredient rows...`);
  const { error: deleteError, count: deleteCount } = await supabase
    .from('menu_dish_ingredients')
    .delete({ count: 'exact' })
    .in('id', ROWS_TO_DELETE);

  if (deleteError) {
    console.error('DELETE failed:', deleteError);
    return;
  }
  console.log(`  Deleted ${deleteCount} rows`);

  // 2. Remove Sticky Toffee Pudding ice cream (menu says custard only)
  console.log('\nRemoving ice cream from Sticky Toffee Pudding (menu says custard only)...');
  const { error: stickyError } = await supabase
    .from('menu_dish_ingredients')
    .delete()
    .eq('id', STICKY_TOFFEE_ICE_CREAM_ROW);

  if (stickyError) {
    console.error('Sticky Toffee delete failed:', stickyError);
  } else {
    console.log('  Done');
  }

  // 3. Set option groups on pudding accompaniments (excluding Sticky Toffee ice cream)
  const puddingRows = PUDDING_OPTION_GROUP_ROWS.filter(id => id !== STICKY_TOFFEE_ICE_CREAM_ROW);
  console.log(`\nSetting option_group = 'Accompaniment' on ${puddingRows.length} pudding rows...`);
  const { error: groupError, count: groupCount } = await supabase
    .from('menu_dish_ingredients')
    .update({ option_group: 'Accompaniment' }, { count: 'exact' })
    .in('id', puddingRows);

  if (groupError) {
    console.error('Option group update failed:', groupError);
  } else {
    console.log(`  Updated ${groupCount} rows`);
  }

  // 4. Refresh GP% calculations for all affected dishes
  console.log('\nRefreshing GP% calculations for all dishes...');
  const { data: allDishes } = await supabase
    .from('menu_dishes')
    .select('id, name')
    .eq('is_active', true);

  if (allDishes) {
    let refreshed = 0;
    for (const dish of allDishes) {
      const { error: refreshError } = await supabase.rpc('menu_refresh_dish_calculations', {
        p_dish_id: dish.id,
      });
      if (refreshError) {
        console.error(`  Failed to refresh ${dish.name}:`, refreshError.message);
      } else {
        refreshed++;
      }
    }
    console.log(`  Refreshed ${refreshed}/${allDishes.length} dishes`);
  }

  console.log('\n=== Cleanup Complete ===');
  console.log(`Summary:`);
  console.log(`  - Removed ${(deleteCount ?? 0) + 1} paid add-on ingredients`);
  console.log(`  - Set option groups on ${puddingRows.length} pudding accompaniments`);
  console.log(`  - Refreshed GP% on all active dishes`);
}

cleanup().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
