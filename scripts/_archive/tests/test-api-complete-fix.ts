#!/usr/bin/env tsx

// Comprehensive test for the table booking API fixes

const API_KEY = 'anch_iPRE-XAgeN-D5QcfNTy_DxDbi1kZcrWg110ZroLotY4';
const BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://management.orangejelly.co.uk' 
  : 'http://localhost:3000';

console.log(`Testing against: ${BASE_URL}`);
console.log('-----------------------------------\n');

async function testBasicBooking() {
  console.log('TEST 1: Basic Booking (Minimal Fields)');
  console.log('=====================================');

  const booking = {
    booking_type: 'regular',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '19:00',
    party_size: 2,
    customer: {
      first_name: 'API',
      last_name: 'Test',
      mobile_number: '07700900888',
      sms_opt_in: false
    }
  };

  console.log('Request:', JSON.stringify(booking, null, 2));

  try {
    const response = await fetch(`${BASE_URL}/api/table-bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(booking)
    });

    const data = await response.json();
    console.log('\nResponse Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (response.ok && data.success !== false) {
      console.log('\n✅ PASS: Basic booking created successfully');
      return { success: true, bookingId: data.booking_id };
    } else {
      console.log('\n❌ FAIL:', data.error?.message || 'Unknown error');
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('\n❌ FAIL: Request error:', error);
    return { success: false, error };
  }
}

async function testFullBooking() {
  console.log('\n\nTEST 2: Full Booking (All Optional Fields)');
  console.log('==========================================');

  const booking = {
    booking_type: 'regular',
    date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '20:00',
    party_size: 4,
    duration_minutes: 150,
    customer: {
      first_name: 'Full',
      last_name: 'Test',
      mobile_number: '07700900999',
      sms_opt_in: true
    },
    special_requirements: 'Window table, wheelchair access needed',
    dietary_requirements: ['Vegetarian', 'Gluten free'],
    allergies: ['Nuts', 'Shellfish'],
    celebration_type: 'anniversary',
    source: 'website'
  };

  console.log('Request:', JSON.stringify(booking, null, 2));

  try {
    const response = await fetch(`${BASE_URL}/api/table-bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(booking)
    });

    const data = await response.json();
    console.log('\nResponse Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (response.ok && data.success !== false) {
      console.log('\n✅ PASS: Full booking with all fields created successfully');
      return { success: true, bookingId: data.booking_id };
    } else {
      console.log('\n❌ FAIL:', data.error?.message || 'Unknown error');
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('\n❌ FAIL: Request error:', error);
    return { success: false, error };
  }
}

async function testExistingCustomer() {
  console.log('\n\nTEST 3: Booking with Existing Customer');
  console.log('======================================');

  // Use same phone number as first test
  const booking = {
    booking_type: 'regular',
    date: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '18:30',
    party_size: 3,
    customer: {
      first_name: 'API',
      last_name: 'Test',
      mobile_number: '07700900888', // Same as first test
      sms_opt_in: false
    }
  };

  console.log('Request:', JSON.stringify(booking, null, 2));

  try {
    const response = await fetch(`${BASE_URL}/api/table-bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(booking)
    });

    const data = await response.json();
    console.log('\nResponse Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (response.ok && data.success !== false) {
      console.log('\n✅ PASS: Booking with existing customer created successfully');
      return { success: true, bookingId: data.booking_id };
    } else {
      console.log('\n❌ FAIL:', data.error?.message || 'Unknown error');
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('\n❌ FAIL: Request error:', error);
    return { success: false, error };
  }
}

async function testInvalidData() {
  console.log('\n\nTEST 4: Invalid Data Handling');
  console.log('=============================');

  const booking = {
    booking_type: 'regular',
    date: '2025-07-32', // Invalid date
    time: '25:00', // Invalid time
    party_size: 0, // Invalid party size
    customer: {
      first_name: '',
      last_name: '',
      mobile_number: '123', // Invalid phone
      sms_opt_in: true
    }
  };

  console.log('Request:', JSON.stringify(booking, null, 2));

  try {
    const response = await fetch(`${BASE_URL}/api/table-bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(booking)
    });

    const data = await response.json();
    console.log('\nResponse Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (response.status === 400 && data.error?.code === 'VALIDATION_ERROR') {
      console.log('\n✅ PASS: Invalid data correctly rejected with validation error');
      return { success: true };
    } else {
      console.log('\n❌ FAIL: Expected validation error, got:', data);
      return { success: false };
    }
  } catch (error) {
    console.error('\n❌ FAIL: Request error:', error);
    return { success: false, error };
  }
}

async function runAllTests() {
  console.log('Table Booking API Comprehensive Test Suite');
  console.log('==========================================\n');

  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  // Test 1
  const test1 = await testBasicBooking();
  results.tests.push({ name: 'Basic Booking', ...test1 });
  if (test1.success) results.passed++; else results.failed++;

  // Test 2
  const test2 = await testFullBooking();
  results.tests.push({ name: 'Full Booking', ...test2 });
  if (test2.success) results.passed++; else results.failed++;

  // Test 3
  const test3 = await testExistingCustomer();
  results.tests.push({ name: 'Existing Customer', ...test3 });
  if (test3.success) results.passed++; else results.failed++;

  // Test 4
  const test4 = await testInvalidData();
  results.tests.push({ name: 'Invalid Data', ...test4 });
  if (test4.success) results.passed++; else results.failed++;

  // Summary
  console.log('\n\n========== TEST SUMMARY ==========');
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log('==================================\n');

  if (results.failed === 0) {
    console.log('🎉 ALL TESTS PASSED! The API is working correctly.');
  } else {
    console.log('❌ Some tests failed. Check the output above for details.');
  }

  // Clean up test bookings if running locally
  if (BASE_URL.includes('localhost') && results.tests.some(t => t.bookingId)) {
    console.log('\nNote: Test bookings created. You may want to clean them up.');
  }
}

// Run the test suite
runAllTests();