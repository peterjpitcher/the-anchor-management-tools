#!/usr/bin/env tsx
/**
 * Test SMS sending for new customers in booking initiation
 * This script helps diagnose why new customers aren't receiving SMS invites
 */

import { config } from 'dotenv';
import path from 'path';
import twilio from 'twilio';

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') });

async function testSmsForNewCustomer() {
  console.log('=== SMS Diagnostic for New Customers ===\n');

  // 1. Check Twilio Configuration
  console.log('1. Checking Twilio Configuration:');
  console.log('   TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✓ Set' : '✗ Missing');
  console.log('   TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '✓ Set' : '✗ Missing');
  console.log('   TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER || 'Not set');
  console.log('   TWILIO_MESSAGING_SERVICE_SID:', process.env.TWILIO_MESSAGING_SERVICE_SID || 'Not set');
  
  if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
    console.log('\n❌ ERROR: Neither TWILIO_PHONE_NUMBER nor TWILIO_MESSAGING_SERVICE_SID is set!');
    console.log('   At least one of these must be configured to send SMS.\n');
  }

  // 2. Test Twilio Connection
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    console.log('\n2. Testing Twilio Connection:');
    try {
      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      
      const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      console.log('   Account Status:', account.status);
      console.log('   Account Name:', account.friendlyName);
      
      // Check balance if available
      try {
        const balance = await client.balance.fetch();
        console.log('   Account Balance:', balance.balance, balance.currency);
      } catch (e) {
        console.log('   Balance check not available');
      }
      
      // List available phone numbers
      const phoneNumbers = await client.incomingPhoneNumbers.list({ limit: 5 });
      console.log(`   Available Phone Numbers: ${phoneNumbers.length} found`);
      phoneNumbers.forEach(num => {
        console.log(`     - ${num.phoneNumber} (${num.friendlyName})`);
      });
      
      // Check messaging services
      const messagingServices = await client.messaging.v1.services.list({ limit: 5 });
      console.log(`   Messaging Services: ${messagingServices.length} found`);
      messagingServices.forEach(service => {
        console.log(`     - ${service.sid}: ${service.friendlyName}`);
      });
      
    } catch (error: any) {
      console.log('   ❌ Twilio connection failed:', error.message);
    }
  }

  // 3. Test SMS Sending (with test number)
  console.log('\n3. Test SMS Sending Capability:');
  console.log('   Would you like to send a test SMS? (Requires a test phone number)');
  console.log('   To test, run: npm run test-sms -- +447123456789');
  
  const testNumber = process.argv[2];
  if (testNumber) {
    console.log(`\n   Attempting to send test SMS to: ${testNumber}`);
    
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('   ❌ Cannot send: Twilio credentials missing');
      return;
    }
    
    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      console.log('   ❌ Cannot send: No sender configured (need TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID)');
      return;
    }
    
    try {
      const { sendSMS } = await import('@/lib/twilio');
      
      console.log('   Sending SMS using integrated sendSMS function (with auto-logging)...');
      const result = await sendSMS(testNumber, 'Test SMS from Anchor Management Tools - New Customer Booking Test', {
        // Metadata to identify this test
        metadata: {
          test_script: 'test-sms-new-customer.ts',
          timestamp: new Date().toISOString()
        }
      });
      
      if (result.success) {
        console.log('   ✓ SMS sent successfully!');
        console.log('     Message SID:', result.sid);
        console.log('     Status:', result.status);
        console.log('     From:', result.fromNumber);
        console.log('     Message ID (DB):', result.messageId || 'Not logged (or pending)');
        
        if (result.messageId) {
          console.log('     ✅ SMS was successfully logged to the database.');
        } else {
          console.log('     ⚠️ SMS was sent but might not be logged (logging is async). Check logs for "Failed to automatically log outbound SMS" if it does not appear.');
        }
      } else {
        console.log('   ❌ SMS send failed:', result.error);
        if (result.code) {
          console.log('     Error Code:', result.code);
        }
      }
      
    } catch (error: any) {
      console.log('   ❌ SMS send exception:', error.message);
    }
  }

  // 4. Common Issues Summary
  console.log('\n4. Common Issues to Check:');
  console.log('   [ ] TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID must be set');
  console.log('   [ ] Phone number must be in E.164 format (+44...)');
  console.log('   [ ] Twilio account must have sufficient balance');
  console.log('   [ ] Phone number/messaging service must be configured in Twilio');
  console.log('   [ ] Check Twilio console for any blocked numbers or filters');
  console.log('   [ ] Verify the phone number can receive SMS (not landline)');
  
  // 5. Check recent pending bookings
  console.log('\n5. Checking Recent Pending Bookings (requires database):');
  try {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const supabase = createAdminClient();
    
    const { data: recentBookings, error } = await supabase
      .from('pending_bookings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.log('   Unable to fetch pending bookings:', error.message);
    } else if (recentBookings && recentBookings.length > 0) {
      console.log(`   Found ${recentBookings.length} recent pending bookings:`);
      recentBookings.forEach(booking => {
        const isNewCustomer = !booking.customer_id;
        const smsSent = booking.metadata?.initial_sms?.message_sid ? '✓' : '✗';
        console.log(`   - ${booking.mobile_number} | New Customer: ${isNewCustomer ? 'Yes' : 'No'} | SMS Sent: ${smsSent}`);
        if (booking.metadata?.initial_sms?.message_sid) {
          console.log(`     SMS SID: ${booking.metadata.initial_sms.message_sid}`);
        }
      });
    } else {
      console.log('   No recent pending bookings found');
    }
  } catch (e) {
    console.log('   Database check skipped (not available in this context)');
  }
}

// Run the diagnostic
testSmsForNewCustomer().catch(console.error);
