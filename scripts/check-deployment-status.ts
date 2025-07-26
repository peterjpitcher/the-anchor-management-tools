#!/usr/bin/env tsx

// Check if the fix has been deployed to production

const API_KEY = 'anch_iPRE-XAgeN-D5QcfNTy_DxDbi1kZcrWg110ZroLotY4';
const API_URL = 'https://management.orangejelly.co.uk/api/table-bookings';

async function checkDeployment() {
  console.log('Checking deployment status...\n');

  // Test with a minimal booking that should work if fix is deployed
  const testBooking = {
    booking_type: 'regular',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '19:00',
    party_size: 2,
    customer: {
      first_name: 'Deployment',
      last_name: 'Test',
      mobile_number: '07700900999',
      sms_opt_in: false
    }
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(testBooking)
    });

    const data = await response.json();
    
    console.log('Response status:', response.status);
    
    if (response.ok && data.success !== false) {
      console.log('\n✅ FIX IS DEPLOYED! The API is working correctly.');
      console.log('Booking created:', data.booking_reference);
      
      // Clean up test booking
      if (data.booking_id) {
        console.log('\nNote: Test booking created. You may want to cancel it.');
        console.log('Booking ID:', data.booking_id);
      }
    } else if (data.code === 'DATABASE_ERROR') {
      console.log('\n❌ FIX NOT DEPLOYED YET');
      console.log('The production server is still running the old code.');
      console.log('Error:', data.message);
      console.log('\nWait for Vercel to auto-deploy or trigger a manual deployment.');
    } else {
      console.log('\n⚠️  Unexpected response:', data);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error);
  }
}

checkDeployment();