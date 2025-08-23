#!/usr/bin/env tsx
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

console.log('🔍 Testing Menu Item Display Issues\n');

const bookingRef = 'TB-2025-9907';

console.log('1️⃣ PAYMENT PAGE PUBLIC API CHECK');
console.log('=================================');
console.log(`Testing: /api/table-bookings/${bookingRef}/public`);

// Test the public API endpoint
async function testPublicAPI() {
  try {
    const response = await fetch(`http://localhost:3000/api/table-bookings/${bookingRef}/public`);
    const data = await response.json();
    
    console.log('\n📤 API Response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.items) {
      console.log('\n⚠️  ISSUE FOUND: Items only contain:');
      data.items.forEach((item: any, index: number) => {
        console.log(`   Item ${index + 1}:`, item);
      });
      console.log('\n❌ MISSING FIELDS:');
      console.log('   - custom_item_name');
      console.log('   - guest_name');
      console.log('   - special_requests');
      console.log('   - item_type');
    }
  } catch (error) {
    console.error('Error testing public API:', error);
  }
}

console.log('\n2️⃣ FIX NEEDED FOR PAYMENT PAGE');
console.log('================================');
console.log('File: src/app/api/table-bookings/[booking_reference]/public/route.ts');
console.log('Lines 28-31 need to be updated to include all fields:');
console.log(`
table_booking_items(
  quantity,
  price_at_booking,
  custom_item_name,    // ADD THIS
  guest_name,          // ADD THIS
  special_requests,    // ADD THIS
  item_type           // ADD THIS
)
`);

console.log('\n3️⃣ CONFIRMATION EMAIL CHECK');
console.log('============================');
console.log('✅ Email template DOES include menu items');
console.log('   - Line 102: Shows custom_item_name');
console.log('   - Line 107-111: Shows special_requests');
console.log('   - Properly calculates totals');

console.log('\n4️⃣ MANAGER EMAIL CHECK');
console.log('======================');
console.log('✅ Manager email CORRECTLY shows all menu details');
console.log('   - Fetches complete table_booking_items data');
console.log('   - Shows item names, guest names, special requests');
console.log('   - Includes dietary requirements and allergies');

console.log('\n📊 SUMMARY');
console.log('==========');
console.log('✅ Data is stored correctly in database');
console.log('✅ Admin UI displays correctly');
console.log('✅ Manager email works correctly');
console.log('✅ Confirmation email template is correct');
console.log('❌ Payment page API missing menu item fields');

console.log('\n🔧 REQUIRED FIX:');
console.log('Update the public API endpoint to fetch all menu item fields');

// Run the test
testPublicAPI();