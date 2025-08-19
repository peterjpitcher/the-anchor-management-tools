#!/usr/bin/env tsx
/**
 * Diagnose SMS sending issues for new customers
 */

import { config } from 'dotenv';
import path from 'path';
import { createAdminClient } from '@/lib/supabase/server';

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') });

async function diagnoseSmsIssue() {
  console.log('=== SMS Issue Diagnosis for New Customers ===\n');

  // 1. Check Environment Variables
  console.log('1. ENVIRONMENT CONFIGURATION CHECK:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const twilioConfig = {
    accountSid: !!process.env.TWILIO_ACCOUNT_SID,
    authToken: !!process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  };

  console.log(`TWILIO_ACCOUNT_SID: ${twilioConfig.accountSid ? '✅ SET' : '❌ MISSING'}`);
  console.log(`TWILIO_AUTH_TOKEN: ${twilioConfig.authToken ? '✅ SET' : '❌ MISSING'}`);
  console.log(`TWILIO_PHONE_NUMBER: ${twilioConfig.phoneNumber ? `✅ ${twilioConfig.phoneNumber}` : '⚠️  NOT SET'}`);
  console.log(`TWILIO_MESSAGING_SERVICE_SID: ${twilioConfig.messagingServiceSid ? `✅ ${twilioConfig.messagingServiceSid}` : '⚠️  NOT SET'}`);

  // Critical check
  const hasSender = twilioConfig.phoneNumber || twilioConfig.messagingServiceSid;
  const hasCredentials = twilioConfig.accountSid && twilioConfig.authToken;
  
  console.log('\n📊 STATUS:');
  if (!hasCredentials) {
    console.log('❌ CRITICAL: Twilio credentials are missing! SMS cannot be sent.');
    console.log('   ACTION: Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to .env.local');
  } else if (!hasSender) {
    console.log('❌ CRITICAL: No SMS sender configured! SMS cannot be sent.');
    console.log('   ACTION: Add either TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID to .env.local');
  } else {
    console.log('✅ Twilio configuration appears complete');
  }

  // 2. Check Recent Pending Bookings
  console.log('\n2. RECENT PENDING BOOKINGS ANALYSIS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const supabase = createAdminClient();
    
    // Get recent pending bookings
    const { data: bookings, error } = await supabase
      .from('pending_bookings')
      .select(`
        *,
        customers:customer_id(
          id,
          first_name,
          last_name,
          sms_opt_in
        )
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log('❌ Error fetching bookings:', error.message);
      return;
    }

    if (!bookings || bookings.length === 0) {
      console.log('ℹ️  No pending bookings found');
      return;
    }

    // Analyze bookings
    let newCustomerCount = 0;
    let existingCustomerCount = 0;
    let smsSuccessNew = 0;
    let smsSuccessExisting = 0;
    let smsFailureNew = 0;
    let smsFailureExisting = 0;

    console.log('\nRecent Booking Attempts:');
    console.log('─────────────────────────');
    
    bookings.forEach((booking, index) => {
      const isNewCustomer = !booking.customer_id;
      const smsSent = booking.metadata?.initial_sms?.message_sid;
      const customerType = isNewCustomer ? '🆕 NEW' : '👤 EXISTING';
      const smsStatus = smsSent ? '✅ SMS SENT' : '❌ SMS FAILED';
      
      if (isNewCustomer) {
        newCustomerCount++;
        if (smsSent) smsSuccessNew++;
        else smsFailureNew++;
      } else {
        existingCustomerCount++;
        if (smsSent) smsSuccessExisting++;
        else smsFailureExisting++;
      }

      console.log(`${index + 1}. ${customerType} | ${smsStatus}`);
      console.log(`   Phone: ${booking.mobile_number}`);
      console.log(`   Created: ${new Date(booking.created_at).toLocaleString()}`);
      
      if (smsSent) {
        console.log(`   SMS SID: ${booking.metadata.initial_sms.message_sid}`);
      } else if (booking.metadata?.sms_error) {
        console.log(`   Error: ${booking.metadata.sms_error}`);
      }
      
      if (!isNewCustomer && booking.customers) {
        const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
        console.log(`   Customer: ${customer.first_name} ${customer.last_name}`);
        console.log(`   SMS Opt-in: ${customer.sms_opt_in ? 'Yes' : 'No'}`);
      }
      console.log('');
    });

    // Summary statistics
    console.log('📊 SUMMARY STATISTICS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Bookings Analyzed: ${bookings.length}`);
    console.log(`├─ New Customers: ${newCustomerCount}`);
    console.log(`│  ├─ SMS Success: ${smsSuccessNew} (${newCustomerCount > 0 ? Math.round(smsSuccessNew/newCustomerCount * 100) : 0}%)`);
    console.log(`│  └─ SMS Failed: ${smsFailureNew} (${newCustomerCount > 0 ? Math.round(smsFailureNew/newCustomerCount * 100) : 0}%)`);
    console.log(`└─ Existing Customers: ${existingCustomerCount}`);
    console.log(`   ├─ SMS Success: ${smsSuccessExisting} (${existingCustomerCount > 0 ? Math.round(smsSuccessExisting/existingCustomerCount * 100) : 0}%)`);
    console.log(`   └─ SMS Failed: ${smsFailureExisting} (${existingCustomerCount > 0 ? Math.round(smsFailureExisting/existingCustomerCount * 100) : 0}%)`);

    // Identify the issue
    console.log('\n🔍 DIAGNOSIS:');
    console.log('━━━━━━━━━━━━━');
    
    if (smsFailureNew > 0 && smsSuccessNew === 0) {
      console.log('❌ CONFIRMED: New customers are NOT receiving SMS messages');
      
      if (!hasCredentials || !hasSender) {
        console.log('   CAUSE: Twilio configuration is incomplete (see above)');
      } else {
        console.log('   POSSIBLE CAUSES:');
        console.log('   - Twilio account suspended or out of credits');
        console.log('   - Phone number formatting issues');
        console.log('   - Network/API connectivity issues');
        console.log('   - Check Twilio console for error logs');
      }
    } else if (smsSuccessNew > 0 && smsFailureNew > 0) {
      console.log('⚠️  INTERMITTENT: Some new customers receive SMS, others don\'t');
      console.log('   POSSIBLE CAUSES:');
      console.log('   - Phone number validation issues');
      console.log('   - Carrier-specific delivery problems');
      console.log('   - Rate limiting');
    } else if (smsSuccessNew > 0 && smsFailureNew === 0) {
      console.log('✅ New customers ARE receiving SMS successfully');
    } else {
      console.log('ℹ️  No new customer bookings found in recent data');
    }

    // Check for patterns in failures
    const failedNewCustomerBookings = bookings.filter(b => !b.customer_id && !b.metadata?.initial_sms?.message_sid);
    if (failedNewCustomerBookings.length > 0) {
      console.log('\n📱 FAILED SMS ATTEMPTS (New Customers):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      failedNewCustomerBookings.forEach(booking => {
        console.log(`Phone: ${booking.mobile_number}`);
        if (booking.metadata) {
          console.log(`Metadata: ${JSON.stringify(booking.metadata, null, 2)}`);
        }
      });
    }

  } catch (error: any) {
    console.log('❌ Error during diagnosis:', error.message);
  }

  // 3. Recommendations
  console.log('\n💡 RECOMMENDED ACTIONS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1. Verify Twilio configuration in .env.local');
  console.log('2. Check Twilio account status and balance at https://console.twilio.com');
  console.log('3. Review Twilio error logs for failed message attempts');
  console.log('4. Test with a known working phone number');
  console.log('5. Check if Twilio package needs reinstalling: npm install twilio@5.7.0');
  console.log('6. Review the /api/bookings/initiate endpoint logs in production');
}

// Run the diagnosis
diagnoseSmsIssue()
  .then(() => {
    console.log('\n✅ Diagnosis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Diagnosis failed:', error);
    process.exit(1);
  });