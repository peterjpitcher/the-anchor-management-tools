#!/usr/bin/env tsx
/**
 * Test a Sunday lunch booking with the API to verify it's working
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testBooking() {
  console.log('🧪 Testing Sunday lunch booking...\n');
  
  const API_URL = 'https://management.orangejelly.co.uk/api/table-bookings';
  const API_KEY = 'anch_lCAAVji4euH04UlTlifDm5-x3IWq3ISC59v64iSeNaQ';
  
  const bookingData = {
    booking_type: 'sunday_lunch',
    date: '2025-08-17',
    time: '13:00',
    party_size: 1,
    customer: {
      first_name: 'Test',
      last_name: 'Booking',
      mobile_number: '07700900999',
      sms_opt_in: false
    },
    menu_selections: [
      {
        menu_item_id: '7991bf75-2a41-44b4-808b-2c4947b9e4a7', // A real menu item ID
        quantity: 1,
        guest_name: 'Guest 1'
        // NO item_type or price_at_booking - server enriches these
      }
    ]
  };
  
  console.log('📤 Sending booking request...');
  console.log('   Type: Sunday Lunch');
  console.log('   Date: August 17, 2025');
  console.log('   Time: 13:00');
  console.log('   Party size: 1');
  console.log('   Menu: Only sending menu_item_id (simplified v2 format)\n');
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'Idempotency-Key': `test-${Date.now()}`
      },
      body: JSON.stringify(bookingData)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ SUCCESS! Booking created:');
      console.log(`   Booking ID: ${result.booking_id || result.data?.booking_id}`);
      console.log(`   Reference: ${result.booking_reference || result.data?.booking_reference}`);
      console.log(`   Status: ${result.status || result.data?.status}`);
      
      if (result.payment_required || result.data?.payment_required) {
        const payment = result.payment_details || result.data?.payment_details;
        console.log('\n💳 Payment Required:');
        console.log(`   Deposit: £${payment?.deposit_amount}`);
        console.log(`   Total: £${payment?.total_amount}`);
      }
      
      console.log('\n🎉 The API is working correctly with simplified menu format!');
      
    } else {
      console.log('❌ Booking failed:');
      console.log(`   Status: ${response.status}`);
      console.log(`   Error: ${result.error?.code || 'Unknown'}`);
      console.log(`   Message: ${result.error?.message || result.message || 'No message'}`);
      
      if (result.error?.code === 'NO_AVAILABILITY') {
        console.log('\n⚠️  This error means service slots might not be configured.');
        console.log('   Run: tsx scripts/setup-service-slots.ts');
      } else if (result.error?.code === 'VALIDATION_ERROR') {
        console.log('\n⚠️  Validation error details:');
        console.log(JSON.stringify(result.error.details, null, 2));
      }
    }
    
  } catch (error) {
    console.log('❌ Network error:', error.message);
  }
}

testBooking().catch(console.error);