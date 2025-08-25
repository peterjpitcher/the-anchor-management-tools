#!/usr/bin/env tsx
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

console.log('🔍 API Field Mapping Analysis\n');

console.log('📥 What the Website Developer is Sending:');
console.log('   Field name: "menu_items"');
console.log('   Structure:');
console.log(`   {
     "custom_item_name": "Slow-Cooked Lamb Shank",
     "item_type": "main",
     "quantity": 1,
     "guest_name": "Guest 1",
     "price_at_booking": 15.49
   }`);

console.log('\n📤 What the API Expects (from API route):');
console.log('   Field name: "menu_selections"');
console.log('   Structure:');
console.log(`   {
     "menu_item_id": "uuid" (optional),
     "custom_item_name": "string" (optional),
     "item_type": "main|side",
     "quantity": number,
     "special_requests": "string" (optional),
     "guest_name": "string" (optional),
     "price_at_booking": number
   }`);

console.log('\n❌ ISSUE IDENTIFIED:');
console.log('   1. Field name mismatch: "menu_items" vs "menu_selections"');
console.log('   2. The API expects "menu_selections" but website is sending "menu_items"');
console.log('   3. This might cause the API to ignore the menu data entirely');

console.log('\n💾 What\'s Being Stored in Database:');
console.log('   - menu_item_id: UUID (being set)');
console.log('   - custom_item_name: NULL (not being stored)');
console.log('   - Other fields: Correctly stored');

console.log('\n🔧 Possible Causes:');
console.log('   1. The website might be calling a different endpoint that transforms the data');
console.log('   2. There might be middleware that\'s converting custom_item_name to menu_item_id');
console.log('   3. The field name mismatch might be causing data loss');

console.log('\n✅ Recommendations:');
console.log('   1. Check if website is calling /api/table-bookings or a different endpoint');
console.log('   2. Website should send "menu_selections" instead of "menu_items"');
console.log('   3. Check server logs to see what data is actually received');
console.log('   4. Add logging to the API route to debug the issue');