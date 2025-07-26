#!/usr/bin/env tsx

// Test script to verify the table booking API fix

const API_KEY = 'anch_iPRE-XAgeN-D5QcfNTy_DxDbi1kZcrWg110ZroLotY4';
const API_URL = 'http://localhost:3000/api/table-bookings';

async function testBookingCreation() {
  console.log('Testing Table Booking API Fix...\n');

  const testBooking = {
    booking_type: 'regular',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
    time: '19:00',
    party_size: 2,
    duration_minutes: 120,
    customer: {
      first_name: 'Test',
      last_name: 'User',
      mobile_number: '07700900123',
      sms_opt_in: true
    },
    source: 'website'
  };

  console.log('Request payload:', JSON.stringify(testBooking, null, 2));
  
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
    
    console.log('\nResponse status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (response.ok && data.success !== false) {
      console.log('\n✅ SUCCESS! Booking created successfully');
      console.log('Booking ID:', data.booking_id);
      console.log('Booking Reference:', data.booking_reference);
    } else {
      console.log('\n❌ FAILED:', data.error || data.message);
      if (data.code === 'DATABASE_ERROR') {
        console.log('\nCheck the server logs for detailed error information');
      }
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error);
  }
}

// Test with optional fields
async function testBookingWithOptionalFields() {
  console.log('\n\nTesting with optional fields...\n');

  const testBooking = {
    booking_type: 'regular',
    date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split('T')[0], // Day after tomorrow
    time: '20:00',
    party_size: 4,
    customer: {
      first_name: 'John',
      last_name: 'Smith',
      mobile_number: '07700900456',
      sms_opt_in: true
    },
    special_requirements: 'Window table please',
    dietary_requirements: ['Vegetarian', 'Gluten free'],
    allergies: ['Nuts'],
    celebration_type: 'birthday'
  };

  console.log('Request payload:', JSON.stringify(testBooking, null, 2));
  
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
    
    console.log('\nResponse status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (response.ok && data.success !== false) {
      console.log('\n✅ SUCCESS! Booking with optional fields created successfully');
    } else {
      console.log('\n❌ FAILED:', data.error || data.message);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error);
  }
}

// Run tests
async function runTests() {
  console.log('API Fix Test - Table Bookings');
  console.log('=============================\n');
  
  await testBookingCreation();
  await testBookingWithOptionalFields();
  
  console.log('\n\nTest complete!');
  console.log('\nIf you see DATABASE_ERROR, check the server logs for details.');
  console.log('The fix removes the email field that was causing the error.');
}

runTests();