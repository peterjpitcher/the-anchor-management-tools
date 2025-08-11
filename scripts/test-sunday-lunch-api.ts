#!/usr/bin/env tsx
/**
 * Test the Sunday Lunch API v2 with simplified menu selections
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const API_URL = 'https://management.orangejelly.co.uk/api/table-bookings';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || 'your-api-key';

async function testSundayLunchBooking() {
  console.log('🧪 Testing Sunday Lunch API v2...\n');
  
  // Test data - simplified format (no item_type or price_at_booking)
  const bookingData = {
    booking_type: 'sunday_lunch',
    date: '2025-08-17', // Next Sunday
    time: '13:00',
    party_size: 1,
    customer: {
      first_name: 'Test',
      last_name: 'User',
      mobile_number: '07700900123',
      sms_opt_in: false
    },
    menu_selections: [
      {
        menu_item_id: '0c8054cb-ad07-4bbe-a730-48279ab1b615', // Lamb Shank
        quantity: 1,
        guest_name: 'Guest 1'
        // NOTE: No item_type or price_at_booking - server should enrich
      }
    ]
  };
  
  console.log('📤 Sending simplified request:');
  console.log(JSON.stringify(bookingData.menu_selections, null, 2));
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'Idempotency-Key': `test-${Date.now()}` // Unique key for this test
      },
      body: JSON.stringify(bookingData)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('\n✅ Success! Booking created:');
      console.log(`   Booking ID: ${result.booking_id}`);
      console.log(`   Reference: ${result.booking_reference}`);
      console.log(`   Status: ${result.status}`);
      
      if (result.payment_required) {
        console.log('\n💳 Payment Required:');
        console.log(`   Deposit: £${result.payment_details.deposit_amount}`);
        console.log(`   Total: £${result.payment_details.total_amount}`);
        console.log(`   Payment URL: ${result.payment_details.payment_url}`);
      }
    } else {
      console.log('\n❌ API Error:');
      console.log(`   Status: ${response.status}`);
      console.log(`   Error Code: ${result.error?.code}`);
      console.log(`   Message: ${result.error?.message}`);
      
      if (result.error?.details) {
        console.log('\n📋 Error Details:');
        console.log(JSON.stringify(result.error.details, null, 2));
      }
      
      // Check if it's the old validation error
      if (result.error?.code === 'VALIDATION_ERROR') {
        const errors = result.error.details?.errors || [];
        const hasItemTypeError = errors.some(e => e.message?.includes('item_type'));
        const hasPriceError = errors.some(e => e.message?.includes('price_at_booking'));
        
        if (hasItemTypeError || hasPriceError) {
          console.log('\n⚠️  API still requires old fields!');
          console.log('   The API v2 changes may not be deployed yet.');
          console.log('   Waiting for deployment to complete...');
        }
      }
    }
  } catch (error) {
    console.log('\n❌ Network Error:', error.message);
  }
}

// Also test fetching the menu
async function testGetMenu() {
  console.log('\n🍽️  Testing Sunday Lunch Menu Fetch...');
  
  try {
    const response = await fetch(
      'https://management.orangejelly.co.uk/api/table-bookings/menu/sunday-lunch?date=2025-08-17',
      {
        headers: {
          'X-API-Key': API_KEY
        }
      }
    );
    
    const menu = await response.json();
    
    if (response.ok) {
      console.log('✅ Menu fetched successfully');
      console.log(`   Mains: ${menu.data?.mains?.length || 0} items`);
      console.log(`   Sides: ${menu.data?.sides?.length || 0} items`);
      
      // Show first main
      if (menu.data?.mains?.[0]) {
        const firstMain = menu.data.mains[0];
        console.log(`\n   Example Main: ${firstMain.name}`);
        console.log(`   ID: ${firstMain.id}`);
        console.log(`   Price: £${firstMain.price}`);
      }
    } else {
      console.log('❌ Failed to fetch menu');
    }
  } catch (error) {
    console.log('❌ Error fetching menu:', error.message);
  }
}

// Run tests
async function runTests() {
  await testGetMenu();
  await testSundayLunchBooking();
  
  console.log('\n📝 Summary:');
  console.log('   - API v2 expects simplified format (no item_type/price_at_booking)');
  console.log('   - Server should enrich data from database');
  console.log('   - Check deployment status if still getting validation errors');
}

runTests().catch(console.error);