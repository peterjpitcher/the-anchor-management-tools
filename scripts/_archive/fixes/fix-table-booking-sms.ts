#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

async function fixTableBookingSMS() {
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
  
  console.log('=== Fixing Table Booking SMS Issue ===\n');
  
  // Check if the issue is with the queueBookingConfirmationSMS function
  // by examining recent bookings that should have SMS but don't
  
  const { data: recentBookings } = await supabase
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
    .eq('status', 'confirmed')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });
  
  if (!recentBookings || recentBookings.length === 0) {
    console.log('No recent confirmed bookings found');
    return;
  }
  
  console.log(`Found ${recentBookings.length} recent confirmed bookings\n`);
  
  // Check each booking for SMS jobs
  for (const booking of recentBookings) {
    console.log(`Checking booking ${booking.booking_reference} (${booking.id})`);
    console.log(`Customer: ${booking.customers?.first_name} ${booking.customers?.last_name}`);
    console.log(`SMS Opt-in: ${booking.customers?.sms_opt_in}`);
    
    // Check if SMS job exists
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .or(`payload->booking_id.eq.${booking.id},payload->table_booking_id.eq.${booking.id}`)
      .limit(1);
    
    if (!jobs || jobs.length === 0) {
      console.log('❌ No SMS job found for this booking');
      
      if (booking.customers?.sms_opt_in && booking.customers?.mobile_number) {
        console.log('   Customer has opted in and has phone number - SMS should have been sent!');
      }
    } else {
      console.log('✅ SMS job exists');
      console.log(`   Job status: ${jobs[0].status}`);
    }
    
    console.log('---');
  }
  
  // Look for any errors in recent jobs
  console.log('\n=== Checking Recent Failed SMS Jobs ===');
  const { data: failedJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'failed')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (failedJobs && failedJobs.length > 0) {
    console.log(`\nFound ${failedJobs.length} failed SMS jobs:`);
    failedJobs.forEach(job => {
      console.log(`\nJob ID: ${job.id}`);
      console.log(`Error: ${job.error_message}`);
      console.log(`Payload: ${JSON.stringify(job.payload, null, 2)}`);
    });
  } else {
    console.log('No failed SMS jobs found');
  }
  
  // Check if it's a permission issue
  console.log('\n=== Checking Permissions ===');
  // Try to create a test SMS job directly
  const testPayload = {
    type: 'send_sms',
    payload: {
      to: '+447700900123',
      body: 'Test message',
      is_test: true
    },
    scheduled_for: new Date().toISOString()
  };
  
  const { error: testError } = await supabase
    .from('jobs')
    .insert(testPayload);
  
  if (testError) {
    console.error('❌ Cannot create jobs - permission issue:', testError);
  } else {
    console.log('✅ Can create jobs - no permission issue');
    
    // Clean up test job
    await supabase
      .from('jobs')
      .delete()
      .match(testPayload);
  }
}

// Run the fix
fixTableBookingSMS().catch(console.error);