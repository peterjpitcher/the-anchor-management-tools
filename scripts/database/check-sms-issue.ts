#!/usr/bin/env tsx
/**
 * Check SMS sending issues for new customers
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkSmsIssue() {
  console.log('=== Checking SMS Issues for New Customers ===\n');

  // 1. Check Environment
  console.log('1. TWILIO CONFIGURATION:');
  console.log('------------------------');
  
  const hasAccountSid = !!process.env.TWILIO_ACCOUNT_SID;
  const hasAuthToken = !!process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  
  console.log(`TWILIO_ACCOUNT_SID: ${hasAccountSid ? '✅ SET' : '❌ MISSING'}`);
  console.log(`TWILIO_AUTH_TOKEN: ${hasAuthToken ? '✅ SET' : '❌ MISSING'}`);
  console.log(`TWILIO_PHONE_NUMBER: ${phoneNumber || '❌ NOT SET'}`);
  console.log(`TWILIO_MESSAGING_SERVICE_SID: ${messagingServiceSid || '❌ NOT SET'}`);
  
  const canSendSms = hasAccountSid && hasAuthToken && (phoneNumber || messagingServiceSid);
  
  if (!canSendSms) {
    console.log('\n❌ PROBLEM FOUND: Twilio is not properly configured!');
    if (!hasAccountSid || !hasAuthToken) {
      console.log('   Missing credentials - SMS cannot be sent');
    }
    if (!phoneNumber && !messagingServiceSid) {
      console.log('   No sender configured - need TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
    }
  } else {
    console.log('\n✅ Twilio configuration looks complete');
  }

  // 2. Check Database
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('\n⚠️  Cannot check database - Supabase credentials missing');
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  console.log('\n2. RECENT BOOKING ATTEMPTS:');
  console.log('---------------------------');

  try {
    // Get recent pending bookings
    const { data: bookings, error } = await supabase
      .from('pending_bookings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.log('Error fetching bookings:', error.message);
      return;
    }

    if (!bookings || bookings.length === 0) {
      console.log('No pending bookings found');
      return;
    }

    // Analyze the data
    let totalNew = 0;
    let totalExisting = 0;
    let smsSuccessNew = 0;
    let smsFailedNew = 0;
    let smsSuccessExisting = 0;
    let smsFailedExisting = 0;

    console.log(`\nFound ${bookings.length} recent booking attempts:\n`);

    bookings.forEach((booking) => {
      const isNew = !booking.customer_id;
      const hasSms = booking.metadata?.initial_sms?.message_sid;
      
      if (isNew) {
        totalNew++;
        if (hasSms) smsSuccessNew++;
        else smsFailedNew++;
      } else {
        totalExisting++;
        if (hasSms) smsSuccessExisting++;
        else smsFailedExisting++;
      }

      // Show details for new customers without SMS
      if (isNew && !hasSms) {
        console.log(`❌ NEW CUSTOMER - NO SMS:`);
        console.log(`   Phone: ${booking.mobile_number}`);
        console.log(`   Created: ${new Date(booking.created_at).toLocaleString()}`);
        if (booking.metadata) {
          console.log(`   Metadata: ${JSON.stringify(booking.metadata)}`);
        }
        console.log('');
      }
    });

    // Summary
    console.log('SUMMARY:');
    console.log('--------');
    console.log(`New Customers: ${totalNew}`);
    if (totalNew > 0) {
      console.log(`  ✅ SMS Sent: ${smsSuccessNew} (${Math.round(smsSuccessNew/totalNew * 100)}%)`);
      console.log(`  ❌ SMS Failed: ${smsFailedNew} (${Math.round(smsFailedNew/totalNew * 100)}%)`);
    }
    console.log(`\nExisting Customers: ${totalExisting}`);
    if (totalExisting > 0) {
      console.log(`  ✅ SMS Sent: ${smsSuccessExisting} (${Math.round(smsSuccessExisting/totalExisting * 100)}%)`);
      console.log(`  ❌ SMS Failed: ${smsFailedExisting} (${Math.round(smsFailedExisting/totalExisting * 100)}%)`);
    }

    // Diagnosis
    console.log('\n3. DIAGNOSIS:');
    console.log('-------------');
    
    if (totalNew > 0 && smsFailedNew === totalNew) {
      console.log('❌ CONFIRMED: New customers are NOT receiving SMS');
      console.log('\nMost likely cause: Twilio configuration issue (see above)');
    } else if (totalNew > 0 && smsFailedNew > 0) {
      console.log('⚠️  PARTIAL FAILURE: Some new customers not receiving SMS');
      console.log('\nPossible causes:');
      console.log('- Intermittent Twilio issues');
      console.log('- Phone number formatting problems');
      console.log('- Rate limiting');
    } else if (totalNew > 0 && smsSuccessNew === totalNew) {
      console.log('✅ New customers ARE receiving SMS successfully');
    } else {
      console.log('ℹ️  No new customer bookings found to analyze');
    }

  } catch (error: any) {
    console.log('Error:', error.message);
  }

  console.log('\n4. RECOMMENDED ACTIONS:');
  console.log('----------------------');
  console.log('1. Check Twilio environment variables in .env.local');
  console.log('2. Verify Twilio account status at https://console.twilio.com');
  console.log('3. Check Twilio balance and phone number status');
  console.log('4. Review error logs in Twilio console');
  console.log('5. Test with: curl -X POST http://localhost:3000/api/bookings/initiate ...');
}

checkSmsIssue().catch(console.error);