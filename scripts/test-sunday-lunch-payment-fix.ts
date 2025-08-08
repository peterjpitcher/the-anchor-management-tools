#!/usr/bin/env tsx
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

async function testSundayLunchPaymentFix() {
  console.log('🧪 Testing Sunday Lunch Payment Fix\n');
  console.log('=' .repeat(60));
  
  const apiUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const apiKey = process.env.API_KEY_FOR_TESTING || 'test-key';
  
  // Test booking data
  const testBooking = {
    booking_type: 'sunday_lunch',
    date: '2025-08-17', // Next Sunday
    time: '13:00',
    party_size: 2,
    customer: {
      first_name: 'Test',
      last_name: 'Customer',
      mobile_number: '07700900123',
      sms_opt_in: false
    },
    menu_selections: [
      {
        custom_item_name: 'Roasted Chicken',
        item_type: 'main',
        quantity: 1,
        guest_name: 'Guest 1',
        price_at_booking: 14.99
      },
      {
        custom_item_name: 'Slow-Cooked Lamb Shank',
        item_type: 'main',
        quantity: 1,
        guest_name: 'Guest 2',
        price_at_booking: 15.49
      }
    ],
    special_requirements: 'API Test - Please ignore',
    source: 'api_test'
  };
  
  console.log('📋 Test Booking Details:');
  console.log(`   Date: ${testBooking.date} at ${testBooking.time}`);
  console.log(`   Party Size: ${testBooking.party_size}`);
  console.log(`   Menu Items: ${testBooking.menu_selections.length}`);
  console.log(`   Total Order Value: £${testBooking.menu_selections.reduce((sum, item) => sum + item.price_at_booking, 0).toFixed(2)}`);
  console.log(`   Expected Deposit: £${(testBooking.party_size * 5).toFixed(2)}\n`);
  
  console.log('🚀 Sending booking request to API...\n');
  
  try {
    const response = await fetch(`${apiUrl}/api/table-bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(testBooking)
    });
    
    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse response as JSON:');
      console.error(responseText);
      return;
    }
    
    console.log('📥 API Response:');
    console.log('   Status Code:', response.status);
    console.log('   Status:', response.ok ? '✅ Success' : '❌ Error');
    
    if (!response.ok) {
      console.error('\n❌ API Error:', data.error || data.message || 'Unknown error');
      if (data.details) {
        console.error('   Details:', JSON.stringify(data.details, null, 2));
      }
      return;
    }
    
    console.log('\n✅ Booking Created Successfully!');
    console.log('   Booking ID:', data.booking_id);
    console.log('   Reference:', data.booking_reference);
    console.log('   Status:', data.status);
    
    if (data.payment_required && data.payment_details) {
      console.log('\n💳 Payment Details:');
      console.log('   Payment Required:', data.payment_required ? 'Yes' : 'No');
      
      // Check for both field names
      const depositAmount = data.payment_details.amount || data.payment_details.deposit_amount;
      console.log('   Deposit Amount:', depositAmount ? `£${depositAmount}` : 'Not provided');
      
      if (data.payment_details.deposit_amount) {
        console.log('   Deposit Amount (explicit):', `£${data.payment_details.deposit_amount}`);
      }
      
      console.log('   Total Amount:', data.payment_details.total_amount ? `£${data.payment_details.total_amount}` : 'Not provided');
      console.log('   Outstanding:', data.payment_details.outstanding_amount ? `£${data.payment_details.outstanding_amount}` : 'Not provided');
      console.log('   Currency:', data.payment_details.currency || 'Not provided');
      
      console.log('\n🔗 Payment URL Analysis:');
      const paymentUrl = data.payment_details.payment_url;
      
      if (!paymentUrl) {
        console.error('   ❌ NO PAYMENT URL PROVIDED!');
      } else {
        console.log('   URL Provided:', '✅ Yes');
        console.log('   URL:', paymentUrl);
        
        // Analyze the URL
        try {
          const url = new URL(paymentUrl);
          console.log('   Domain:', url.hostname);
          console.log('   Path:', url.pathname);
          
          if (url.hostname.includes('paypal.com')) {
            console.log('   Type:', '✅ Direct PayPal URL (FIXED!)');
          } else if (url.hostname.includes('orangejelly')) {
            console.log('   Type:', '⚠️ Internal web page URL (needs redirect)');
          } else {
            console.log('   Type:', '❓ Unknown URL type');
          }
          
          // Check for expected PayPal patterns
          if (url.pathname.includes('checkoutnow') || url.searchParams.has('token')) {
            console.log('   PayPal Token:', '✅ Present');
          }
        } catch (e) {
          console.log('   ⚠️ Invalid URL format:', paymentUrl);
        }
      }
      
      console.log('\n📊 Field Compatibility Check:');
      console.log('   payment_details.amount:', data.payment_details.amount ? '✅ Present' : '❌ Missing');
      console.log('   payment_details.deposit_amount:', data.payment_details.deposit_amount ? '✅ Present' : '❌ Missing');
      console.log('   payment_details.payment_url:', data.payment_details.payment_url ? '✅ Present' : '❌ Missing');
      
      if (data.payment_details.error) {
        console.log('\n⚠️ Payment Error Message:', data.payment_details.error);
      }
    } else {
      console.error('\n❌ No payment details in response!');
      console.log('Full response:', JSON.stringify(data, null, 2));
    }
    
  } catch (error) {
    console.error('\n❌ Request Failed:', error);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Test completed');
}

// Run the test
testSundayLunchPaymentFix();