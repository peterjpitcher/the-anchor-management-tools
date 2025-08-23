#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testBookingAPI() {
  console.log('🧪 TESTING BOOKING INITIATION API\n');
  console.log('=' + '='.repeat(50) + '\n');

  // Get API key from environment or prompt
  const apiKey = process.env.TEST_API_KEY;
  if (!apiKey) {
    console.error('❌ Please set TEST_API_KEY in your .env.local file');
    console.log('\nTo find your API key:');
    console.log('1. Go to https://management.orangejelly.co.uk/settings/api-keys');
    console.log('2. Copy an active API key');
    console.log('3. Add to .env.local: TEST_API_KEY=your-key-here');
    return;
  }

  // Get test event ID from environment or use a default
  const eventId = process.env.TEST_EVENT_ID;
  if (!eventId) {
    console.error('❌ Please set TEST_EVENT_ID in your .env.local file');
    console.log('\nTo find an event ID:');
    console.log('1. Go to https://management.orangejelly.co.uk/events');
    console.log('2. Click on any scheduled event');
    console.log('3. Copy the ID from the URL');
    console.log('4. Add to .env.local: TEST_EVENT_ID=your-event-id');
    return;
  }

  const apiUrl = 'https://management.orangejelly.co.uk/api/bookings/initiate';
  const testPhone = '07700900123'; // Test phone number

  console.log('📋 Test Configuration:');
  console.log(`API URL: ${apiUrl}`);
  console.log(`API Key: ${apiKey.substring(0, 10)}...`);
  console.log(`Event ID: ${eventId}`);
  console.log(`Phone: ${testPhone}`);
  console.log('\n');

  try {
    console.log('🚀 Sending booking initiation request...\n');
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        event_id: eventId,
        mobile_number: testPhone,
      }),
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse response as JSON');
      console.log('Raw response:', responseText);
      return;
    }

    console.log(`📡 Response Status: ${response.status}`);
    console.log('📦 Response Data:', JSON.stringify(responseData, null, 2));

    if (response.ok) {
      console.log('\n✅ SUCCESS! Booking initiated');
      console.log('\n📊 Key Information:');
      console.log(`- Booking Token: ${responseData.data?.booking_token}`);
      console.log(`- Confirmation URL: ${responseData.data?.confirmation_url}`);
      console.log(`- SMS Sent: ${responseData.data?.sms_sent ? '✅ Yes' : '❌ No'}`);
      console.log(`- Customer Exists: ${responseData.data?.customer_exists ? 'Yes' : 'No (New Customer)'}`);
      
      if (responseData.data?._debug_summary) {
        console.log('\n🔍 Debug Summary:');
        console.log(`- Errors: ${responseData.data._debug_summary.errors}`);
        console.log(`- Warnings: ${responseData.data._debug_summary.warnings}`);
        console.log(`- SMS Attempted: ${responseData.data._debug_summary.sms_attempted ? 'Yes' : 'No'}`);
        console.log(`- SMS Sent: ${responseData.data._debug_summary.sms_sent ? 'Yes' : 'No'}`);
      }
    } else {
      console.log('\n❌ ERROR! Booking failed');
      console.log(`Error: ${responseData.error || 'Unknown error'}`);
      console.log(`Code: ${responseData.code || 'Unknown'}`);
      
      if (responseData.debug) {
        console.log('\n🔍 Debug Information:');
        console.log(JSON.stringify(responseData.debug, null, 2));
      }
    }

    // Check Twilio environment variables
    console.log('\n🔧 Environment Check:');
    console.log(`- TWILIO_ACCOUNT_SID: ${process.env.TWILIO_ACCOUNT_SID ? '✅ Set' : '❌ Not set'}`);
    console.log(`- TWILIO_AUTH_TOKEN: ${process.env.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Not set'}`);
    console.log(`- TWILIO_PHONE_NUMBER: ${process.env.TWILIO_PHONE_NUMBER ? '✅ Set' : '❌ Not set'}`);
    console.log(`- TWILIO_MESSAGING_SERVICE_SID: ${process.env.TWILIO_MESSAGING_SERVICE_SID ? '✅ Set' : '❌ Not set'}`);

  } catch (error: any) {
    console.error('\n❌ Request failed:', error.message);
    console.error('Details:', error);
  }

  console.log('\n📋 NEXT STEPS:');
  console.log('1. Check if SMS was sent to the test phone number');
  console.log('2. Run the diagnostic script to check database state:');
  console.log('   tsx scripts/diagnose-booking-issues.ts');
  console.log('3. Check Vercel logs for any errors');
  console.log('4. If SMS not sent, verify Twilio credentials in Vercel environment');
}

testBookingAPI().catch(console.error);