#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { format } from 'date-fns';

// Load environment variables
config({ path: '.env.local' });

async function investigateTableBookingSMS() {
  // Create admin client with service role key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  
  console.log('=== Investigating Table Booking SMS Issue ===\n');
  
  try {
    // 1. Get the most recent table bookings
    console.log('1. Fetching most recent table bookings...');
    const { data: recentBookings, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customers:customer_id (
          id,
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (bookingError) {
      console.error('Error fetching bookings:', bookingError);
      return;
    }
    
    if (!recentBookings || recentBookings.length === 0) {
      console.log('No table bookings found.');
      return;
    }
    
    console.log(`\nFound ${recentBookings.length} recent table bookings:`);
    recentBookings.forEach((booking, index) => {
      console.log(`\n${index + 1}. Booking ID: ${booking.id}`);
      console.log(`   Created: ${format(new Date(booking.created_at), 'yyyy-MM-dd HH:mm:ss')}`);
      console.log(`   Customer: ${booking.customers?.first_name || ''} ${booking.customers?.last_name || ''} (ID: ${booking.customer_id})`);
      console.log(`   Phone: ${booking.customers?.mobile_number || 'No phone'}`);
      console.log(`   Date: ${booking.booking_date || booking.date || 'N/A'} at ${booking.booking_time || booking.time || 'N/A'}`);
      console.log(`   Party Size: ${booking.party_size}`);
      console.log(`   Status: ${booking.status}`);
      console.log(`   SMS Opt-in: ${booking.customers?.sms_opt_in ? 'Yes' : 'No'}`);
    });
    
    // Focus on the most recent booking
    const latestBooking = recentBookings[0];
    console.log(`\n\n=== Investigating Latest Booking (ID: ${latestBooking.id}) ===`);
    
    // Check customer messaging health
    if (latestBooking.customer_id) {
      const { data: messagingHealth } = await supabase
        .from('customer_messaging_health')
        .select('*')
        .eq('customer_id', latestBooking.customer_id)
        .single();
      
      if (messagingHealth) {
        console.log(`\nCustomer Messaging Health:`);
        console.log(`   SMS Suspended: ${messagingHealth.sms_suspended ? 'Yes' : 'No'}`);
        console.log(`   SMS Failure Count: ${messagingHealth.sms_failure_count}`);
      }
    }
    
    // 2. Check for SMS jobs related to this booking
    console.log('\n2. Checking for SMS jobs...');
    // First, let's get all recent SMS jobs and filter manually
    const { data: allJobs, error: jobsError } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });
    
    // Filter for jobs related to this booking
    const jobs = allJobs?.filter(job => {
      const payload = job.payload;
      return payload?.booking_id === latestBooking.id || 
             payload?.table_booking_id === latestBooking.id ||
             payload?.variables?.booking_id === latestBooking.id;
    });
    
    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
    } else if (!jobs || jobs.length === 0) {
      console.log('❌ No SMS jobs found for this booking!');
      
      // Check if there are any jobs with matching customer
      const { data: customerJobs } = await supabase
        .from('jobs')
        .select('*')
        .eq('type', 'send_sms')
        .filter('payload->to', 'cs', latestBooking.customers?.mobile_number || '')
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (customerJobs && customerJobs.length > 0) {
        console.log(`\nFound ${customerJobs.length} SMS jobs for this customer's phone number:`);
        customerJobs.forEach(job => {
          console.log(`- Job ID: ${job.id}, Status: ${job.status}, Created: ${format(new Date(job.created_at), 'yyyy-MM-dd HH:mm:ss')}`);
          console.log(`  Template: ${job.payload?.template || 'Unknown'}`);
        });
      }
      
      // Also check recent table booking related jobs
      console.log('\nChecking all recent table booking SMS jobs...');
      const { data: tableBookingJobs } = await supabase
        .from('jobs')
        .select('*')
        .eq('type', 'send_sms')
        .ilike('payload', '%table_booking%')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (tableBookingJobs && tableBookingJobs.length > 0) {
        console.log(`\nFound ${tableBookingJobs.length} table booking SMS jobs in last 24 hours:`);
        tableBookingJobs.forEach(job => {
          console.log(`\n- Job ID: ${job.id}`);
          console.log(`  Status: ${job.status}`);
          console.log(`  Created: ${format(new Date(job.created_at), 'yyyy-MM-dd HH:mm:ss')}`);
          if (job.payload?.to) console.log(`  To: ${job.payload.to}`);
          if (job.payload?.template) console.log(`  Template: ${job.payload.template}`);
          if (job.error) console.log(`  Error: ${job.error}`);
        });
      } else {
        console.log('\n❌ No table booking SMS jobs found in the last 24 hours!');
      }
    } else {
      console.log(`\n✓ Found ${jobs.length} SMS job(s) for this booking:`);
      jobs.forEach(job => {
        console.log(`\nJob ID: ${job.id}`);
        console.log(`Status: ${job.status}`);
        console.log(`Created: ${format(new Date(job.created_at), 'yyyy-MM-dd HH:mm:ss')}`);
        console.log(`Type: ${job.type}`);
        console.log(`Payload:`, JSON.stringify(job.payload, null, 2));
        if (job.error) {
          console.log(`Error: ${job.error}`);
        }
        if (job.processed_at) {
          console.log(`Processed: ${format(new Date(job.processed_at), 'yyyy-MM-dd HH:mm:ss')}`);
        }
      });
    }
    
    // 3. Check message history
    console.log('\n3. Checking message history...');
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('customer_id', latestBooking.customer_id)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
    } else if (!messages || messages.length === 0) {
      console.log('No messages found for this customer.');
    } else {
      console.log(`\nFound ${messages.length} recent messages for this customer:`);
      messages.forEach(msg => {
        console.log(`\nMessage ID: ${msg.id}`);
        console.log(`Type: ${msg.type}`);
        console.log(`Status: ${msg.status}`);
        console.log(`Created: ${format(new Date(msg.created_at), 'yyyy-MM-dd HH:mm:ss')}`);
        console.log(`Content: ${msg.content ? msg.content.substring(0, 100) + '...' : msg.body ? msg.body.substring(0, 100) + '...' : 'No content'}`);
        if (msg.error_message) {
          console.log(`Error: ${msg.error_message}`);
        }
      });
    }
    
    // 4. Check webhook logs for recent activity
    console.log('\n4. Checking recent webhook logs...');
    const { data: webhookLogs, error: webhookError } = await supabase
      .from('webhook_logs')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (webhookError) {
      console.error('Error fetching webhook logs:', webhookError);
    } else if (webhookLogs && webhookLogs.length > 0) {
      console.log(`\nFound ${webhookLogs.length} webhook logs in the last 24 hours`);
      const twilioWebhooks = webhookLogs.filter(log => log.path?.includes('twilio'));
      if (twilioWebhooks.length > 0) {
        console.log(`\nTwilio webhooks (${twilioWebhooks.length}):`);
        twilioWebhooks.forEach(log => {
          console.log(`- ${format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')} - ${log.path} - Status: ${log.response_status}`);
        });
      }
    }
    
    // 5. Analyze potential issues
    console.log('\n\n=== Analysis Summary ===');
    
    if (!latestBooking.customers?.sms_opt_in) {
      console.log('❌ Customer has not opted in for SMS notifications');
    }
    
    if (!latestBooking.customers?.mobile_number) {
      console.log('❌ Customer has no phone number on file');
    }
    
    if (latestBooking.status !== 'confirmed') {
      console.log(`⚠️  Booking status is "${latestBooking.status}" - SMS might only be sent for confirmed bookings`);
    }
    
    // Check system settings
    console.log('\n\n=== Checking System Settings ===');
    const { data: smsSettings } = await supabase
      .from('system_settings')
      .select('*')
      .eq('key', 'sms_enabled')
      .single();
    
    if (smsSettings) {
      console.log(`SMS Enabled: ${smsSettings.value}`);
    }
    
    // Check SMS templates
    console.log('\n\n=== Checking SMS Templates ===');
    const { data: templates } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .in('template_key', ['booking_confirmation_regular', 'booking_confirmation_sunday_lunch'])
      .eq('is_active', true);
    
    if (!templates || templates.length === 0) {
      console.log('❌ No active booking confirmation templates found!');
      console.log('This is why SMS are not being sent.');
      
      // Check all templates
      const { data: allTemplates } = await supabase
        .from('table_booking_sms_templates')
        .select('template_key, is_active')
        .order('template_key');
      
      console.log('\nAll available templates:');
      allTemplates?.forEach(t => {
        console.log(`- ${t.template_key} (active: ${t.is_active})`);
      });
    } else {
      console.log(`✅ Found ${templates.length} active booking confirmation templates:`);
      templates.forEach(t => {
        console.log(`- ${t.template_key}: "${t.template_text.substring(0, 60)}..."`);
      });
    }
    
  } catch (error) {
    console.error('Error during investigation:', error);
  }
}

// Run the investigation
investigateTableBookingSMS();