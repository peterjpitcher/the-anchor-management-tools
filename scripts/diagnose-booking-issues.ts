#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createAdminClient } from '../src/lib/supabase/server';
import { formatDistanceToNow } from 'date-fns';

async function diagnoseBookingIssues() {
  console.log('🔍 COMPREHENSIVE BOOKING FLOW DIAGNOSIS\n');
  console.log('=' + '='.repeat(50) + '\n');

  const supabase = createAdminClient();

  // 1. Check recent pending bookings
  console.log('1. RECENT PENDING BOOKINGS (Last 24 hours):');
  console.log('-'.repeat(50));
  
  const { data: pendingBookings, error: pbError } = await supabase
    .from('pending_bookings')
    .select('*')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (pbError) {
    console.error('❌ Error fetching pending bookings:', pbError);
  } else {
    console.log(`Found ${pendingBookings?.length || 0} pending bookings\n`);
    pendingBookings?.forEach((pb, index) => {
      console.log(`${index + 1}. Token: ${pb.token.substring(0, 8)}...`);
      console.log(`   Created: ${formatDistanceToNow(new Date(pb.created_at))} ago`);
      console.log(`   Mobile: ${pb.mobile_number}`);
      console.log(`   Customer ID: ${pb.customer_id || 'NULL (NEW CUSTOMER)'}`);
      console.log(`   Confirmed: ${pb.confirmed_at ? '✅ Yes' : '❌ No'}`);
      console.log(`   Metadata: ${JSON.stringify(pb.metadata || {}, null, 2)}`);
      console.log('');
    });
  }

  // 2. Check recent messages
  console.log('\n2. RECENT SMS MESSAGES (Last 24 hours):');
  console.log('-'.repeat(50));
  
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(10);

  if (msgError) {
    console.error('❌ Error fetching messages:', msgError);
  } else {
    console.log(`Found ${messages?.length || 0} outbound messages\n`);
    messages?.forEach((msg, index) => {
      console.log(`${index + 1}. Message SID: ${msg.message_sid}`);
      console.log(`   Created: ${formatDistanceToNow(new Date(msg.created_at))} ago`);
      console.log(`   To: ${msg.to_number}`);
      console.log(`   Customer ID: ${msg.customer_id || 'NULL ⚠️'}`);
      console.log(`   Status: ${msg.twilio_status}`);
      console.log(`   Body preview: ${msg.body.substring(0, 50)}...`);
      console.log('');
    });
  }

  // 3. Check for orphaned messages (no customer_id)
  console.log('\n3. ORPHANED MESSAGES CHECK:');
  console.log('-'.repeat(50));
  
  const { data: orphanedMessages, error: orphanError } = await supabase
    .from('messages')
    .select('*')
    .is('customer_id', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (orphanError) {
    console.error('❌ Error checking orphaned messages:', orphanError);
  } else {
    console.log(`Found ${orphanedMessages?.length || 0} messages with NULL customer_id\n`);
    if (orphanedMessages && orphanedMessages.length > 0) {
      console.log('⚠️  WARNING: Messages without customer_id found!');
      orphanedMessages.forEach((msg, index) => {
        console.log(`${index + 1}. Created: ${formatDistanceToNow(new Date(msg.created_at))} ago`);
        console.log(`   To: ${msg.to_number}`);
        console.log(`   SID: ${msg.message_sid}`);
      });
    }
  }

  // 4. Check recent audit logs for booking operations
  console.log('\n\n4. RECENT BOOKING AUDIT LOGS:');
  console.log('-'.repeat(50));
  
  const { data: auditLogs, error: auditError } = await supabase
    .from('audit_logs')
    .select('*')
    .or('action.eq.booking.initiated,entity_type.eq.pending_booking,entity_type.eq.booking')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (auditError) {
    console.error('❌ Error fetching audit logs:', auditError);
  } else {
    console.log(`Found ${auditLogs?.length || 0} booking-related audit logs\n`);
    auditLogs?.forEach((log, index) => {
      console.log(`${index + 1}. Action: ${log.action}`);
      console.log(`   Time: ${formatDistanceToNow(new Date(log.created_at))} ago`);
      console.log(`   Entity: ${log.entity_type} (${log.entity_id?.substring(0, 8)}...)`);
      console.log(`   Metadata: ${JSON.stringify(log.metadata || {}, null, 2)}`);
      console.log('');
    });
  }

  // 5. Check webhook logs for SMS issues
  console.log('\n5. RECENT WEBHOOK LOGS (Twilio):');
  console.log('-'.repeat(50));
  
  const { data: webhookLogs, error: webhookError } = await supabase
    .from('webhook_logs')
    .select('*')
    .eq('source', 'twilio')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (webhookError) {
    console.error('❌ Error fetching webhook logs:', webhookError);
  } else {
    console.log(`Found ${webhookLogs?.length || 0} Twilio webhook logs\n`);
    webhookLogs?.forEach((log, index) => {
      console.log(`${index + 1}. Time: ${formatDistanceToNow(new Date(log.created_at))} ago`);
      console.log(`   Status: ${log.status_code}`);
      console.log(`   Path: ${log.path}`);
      if (log.error) {
        console.log(`   Error: ${log.error}`);
      }
      console.log('');
    });
  }

  // 6. Test database constraints
  console.log('\n6. DATABASE CONSTRAINT TEST:');
  console.log('-'.repeat(50));
  
  try {
    // Try to insert a message without customer_id
    const { error: testError } = await supabase
      .from('messages')
      .insert({
        direction: 'outbound',
        message_sid: 'TEST_' + Date.now(),
        twilio_message_sid: 'TEST_' + Date.now(),
        body: 'Test message',
        status: 'test',
        twilio_status: 'test',
        from_number: '+44test',
        to_number: '+44test',
        message_type: 'sms',
        // Deliberately omitting customer_id
      });

    if (testError) {
      if (testError.message.includes('null value in column "customer_id"')) {
        console.log('❌ CONFIRMED: customer_id is still NOT NULL constraint');
        console.log('   This means messages CANNOT be inserted without a customer_id');
      } else {
        console.log('❓ Unexpected error:', testError.message);
      }
    } else {
      console.log('✅ Test message inserted without customer_id - constraint may be removed');
      // Clean up test message
      await supabase
        .from('messages')
        .delete()
        .like('message_sid', 'TEST_%');
    }
  } catch (e) {
    console.error('❌ Test failed:', e);
  }

  // 7. Summary and recommendations
  console.log('\n\n📊 DIAGNOSIS SUMMARY:');
  console.log('=' + '='.repeat(50));
  
  console.log('\n🔍 Key Findings:');
  console.log('1. Pending bookings with metadata:', pendingBookings?.filter(pb => pb.metadata?.initial_sms).length || 0);
  console.log('2. Messages without customer_id:', orphanedMessages?.length || 0);
  console.log('3. Recent booking initiations:', auditLogs?.filter(log => log.action === 'booking.initiated').length || 0);
  
  console.log('\n💡 NEXT STEPS:');
  console.log('1. Check if the deployment includes our latest code changes');
  console.log('2. Verify the messages table still has NOT NULL constraint on customer_id');
  console.log('3. Look for any error patterns in the logs above');
  console.log('4. Test the booking flow end-to-end with debug logging');
}

diagnoseBookingIssues().catch(console.error);