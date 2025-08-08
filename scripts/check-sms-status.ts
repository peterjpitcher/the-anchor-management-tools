#!/usr/bin/env tsx
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function checkSmsStatus(bookingReference: string) {
  console.log(`📱 Checking SMS Status for Booking: ${bookingReference}\n`);
  console.log('=' .repeat(60));
  
  try {
    // Get the booking
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*)
      `)
      .eq('booking_reference', bookingReference)
      .single();

    if (bookingError || !booking) {
      console.error('❌ Booking not found:', bookingReference);
      return;
    }

    console.log('📌 Booking Details:');
    console.log(`   Reference: ${booking.booking_reference}`);
    console.log(`   Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
    console.log(`   Phone: ${booking.customer?.mobile_number}`);
    console.log(`   SMS Opt-in: ${booking.customer?.sms_opt_in ? '✅ Yes' : '❌ No'}`);
    console.log(`   Status: ${booking.status}`);
    console.log(`   Created: ${new Date(booking.created_at).toLocaleString()}`);

    // Check jobs queue for SMS
    console.log('\n📨 Checking SMS Jobs Queue:');
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .or(`payload->booking_id.eq.${booking.id},payload->variables->reference.eq.${bookingReference}`)
      .order('created_at', { ascending: false });

    if (!jobs || jobs.length === 0) {
      console.log('   ⚠️  NO SMS JOBS FOUND IN QUEUE');
      console.log('   This means the SMS was never queued for sending');
    } else {
      console.log(`   Found ${jobs.length} job(s):\n`);
      for (const job of jobs) {
        console.log(`   Job ID: ${job.id}`);
        console.log(`   Type: ${job.type}`);
        console.log(`   Status: ${job.status || 'pending'}`);
        console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
        console.log(`   Scheduled: ${new Date(job.scheduled_for).toLocaleString()}`);
        if (job.processed_at) {
          console.log(`   Processed: ${new Date(job.processed_at).toLocaleString()}`);
        }
        if (job.error) {
          console.log(`   ❌ Error: ${job.error}`);
        }
        console.log(`   Template: ${job.payload?.template}`);
        console.log(`   To: ${job.payload?.to}`);
        console.log('');
      }
    }

    // Check messages table
    console.log('💬 Checking Messages Table:');
    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .eq('customer_id', booking.customer?.id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!messages || messages.length === 0) {
      console.log('   ⚠️  No messages found for this customer');
    } else {
      console.log(`   Found ${messages.length} recent message(s):\n`);
      for (const msg of messages) {
        console.log(`   Message ID: ${msg.id}`);
        console.log(`   Direction: ${msg.direction}`);
        console.log(`   Status: ${msg.status}`);
        console.log(`   Created: ${new Date(msg.created_at).toLocaleString()}`);
        console.log(`   Body: ${msg.body?.substring(0, 50)}...`);
        if (msg.error_message) {
          console.log(`   ❌ Error: ${msg.error_message}`);
        }
        console.log('');
      }
    }

    // Check webhook logs for recent SMS attempts
    console.log('🔍 Checking Recent Webhook Logs:');
    const { data: webhooks } = await supabase
      .from('webhook_logs')
      .select('*')
      .eq('webhook_type', 'twilio_status')
      .order('created_at', { ascending: false })
      .limit(5);

    if (webhooks && webhooks.length > 0) {
      console.log(`   Found ${webhooks.length} recent webhook(s)`);
      const recentWebhook = webhooks[0];
      console.log(`   Latest: ${new Date(recentWebhook.created_at).toLocaleString()}`);
      console.log(`   Status: ${recentWebhook.response_status}`);
    } else {
      console.log('   No recent webhook activity');
    }

    // Check if customer messaging is healthy
    console.log('\n📊 Customer Messaging Health:');
    const { data: health } = await supabase
      .from('customer_messaging_health')
      .select('*')
      .eq('customer_id', booking.customer?.id)
      .single();

    if (health) {
      console.log(`   SMS Suspended: ${health.sms_suspended ? '❌ Yes' : '✅ No'}`);
      console.log(`   Failure Count: ${health.sms_failure_count}`);
      if (health.last_sms_sent_at) {
        console.log(`   Last SMS Sent: ${new Date(health.last_sms_sent_at).toLocaleString()}`);
      }
      if (health.last_sms_error) {
        console.log(`   Last Error: ${health.last_sms_error}`);
      }
    } else {
      console.log('   No health record found (this is normal for new customers)');
    }

    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('📋 Summary:');
    if (!jobs || jobs.length === 0) {
      console.log('   ❌ SMS was never queued - this is the problem!');
      console.log('   The return handler should have called queueBookingConfirmationSMS()');
    } else if (jobs.some(j => j.status === 'completed')) {
      console.log('   ✅ SMS job was processed');
      if (!messages || messages.length === 0) {
        console.log('   ❌ But no message was created - Twilio might have failed');
      }
    } else if (jobs.some(j => j.error)) {
      console.log('   ❌ SMS job failed with error');
    } else {
      console.log('   ⏳ SMS job is pending/not processed yet');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Check if booking reference was provided
const bookingRef = process.argv[2] || 'TB-2025-9837';
checkSmsStatus(bookingRef);