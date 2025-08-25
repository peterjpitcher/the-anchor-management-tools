#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function diagnoseSMS() {
  console.log('🔍 Diagnosing Table Booking SMS System...\n');
  
  const supabase = await createAdminClient();
  const issues: string[] = [];
  const recommendations: string[] = [];
  
  // 1. Check environment variables
  console.log('1️⃣ Checking Environment Variables:');
  const requiredEnvVars = {
    'TWILIO_ACCOUNT_SID': process.env.TWILIO_ACCOUNT_SID,
    'TWILIO_AUTH_TOKEN': process.env.TWILIO_AUTH_TOKEN,
    'TWILIO_PHONE_NUMBER': process.env.TWILIO_PHONE_NUMBER,
    'NEXT_PUBLIC_CONTACT_PHONE_NUMBER': process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER,
    'CRON_SECRET': process.env.CRON_SECRET
  };
  
  Object.entries(requiredEnvVars).forEach(([key, value]) => {
    if (!value) {
      console.log(`❌ ${key}: Missing`);
      issues.push(`Missing environment variable: ${key}`);
    } else {
      console.log(`✅ ${key}: Set`);
    }
  });
  
  // 2. Check SMS templates
  console.log('\n2️⃣ Checking SMS Templates:');
  const { data: templates, error: templatesError } = await supabase
    .from('table_booking_sms_templates')
    .select('*')
    .eq('is_active', true);
    
  if (templatesError) {
    console.error('❌ Error fetching templates:', templatesError);
    issues.push('Cannot fetch SMS templates from database');
  } else if (!templates || templates.length === 0) {
    console.log('❌ No active SMS templates found');
    issues.push('No active SMS templates in the database');
    recommendations.push('Run the migration: supabase migration run');
  } else {
    console.log(`✅ Found ${templates.length} active templates:`);
    templates.forEach(t => {
      console.log(`   - ${t.template_key} (${t.booking_type || 'all types'})`);
    });
  }
  
  // 3. Check pending SMS jobs
  console.log('\n3️⃣ Checking Pending SMS Jobs:');
  const { data: pendingJobs, error: pendingError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (pendingError) {
    console.error('❌ Error fetching jobs:', pendingError);
    issues.push('Cannot fetch jobs from database');
  } else if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending SMS jobs (queue is empty)');
  } else {
    console.log(`⚠️  Found ${pendingJobs.length} pending SMS jobs:`);
    pendingJobs.forEach(job => {
      const payload = job.payload as any;
      console.log(`   - Job ${job.id}: Created ${new Date(job.created_at).toLocaleString()}`);
      console.log(`     To: ${payload.to}, Template: ${payload.template || 'direct message'}`);
    });
    issues.push(`${pendingJobs.length} SMS jobs are pending and not being processed`);
    recommendations.push('Jobs are queued but not being processed - check cron job configuration');
  }
  
  // 4. Check failed SMS jobs
  console.log('\n4️⃣ Checking Failed SMS Jobs:');
  const { data: failedJobs, error: failedError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (!failedError && failedJobs && failedJobs.length > 0) {
    console.log(`❌ Found ${failedJobs.length} failed SMS jobs:`);
    failedJobs.forEach(job => {
      console.log(`   - Job ${job.id}: ${job.error_message || 'No error message'}`);
    });
    issues.push(`${failedJobs.length} SMS jobs have failed`);
  } else {
    console.log('✅ No failed SMS jobs');
  }
  
  // 5. Check recent table bookings
  console.log('\n5️⃣ Checking Recent Table Bookings:');
  const { data: recentBookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(`
      *,
      customers!inner (
        id,
        first_name,
        last_name,
        mobile_number,
        sms_opt_in
      )
    `)
    .eq('status', 'confirmed')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (!bookingsError && recentBookings && recentBookings.length > 0) {
    console.log(`✅ Found ${recentBookings.length} recent confirmed bookings:`);
    let noOptInCount = 0;
    recentBookings.forEach(booking => {
      const customer = booking.customers;
      console.log(`   - ${customer.first_name} ${customer.last_name} - ${booking.date} ${booking.time}`);
      console.log(`     SMS Opt-in: ${customer.sms_opt_in ? '✅' : '❌'}, Phone: ${customer.mobile_number || 'None'}`);
      if (!customer.sms_opt_in) noOptInCount++;
    });
    
    if (noOptInCount > 0) {
      issues.push(`${noOptInCount} out of ${recentBookings.length} recent customers have SMS opt-in disabled`);
    }
  } else {
    console.log('ℹ️  No recent confirmed bookings found');
  }
  
  // 6. Check cron job configuration
  console.log('\n6️⃣ Checking Cron Job Configuration:');
  console.log('   - Production URL: /api/jobs/process');
  console.log('   - Should run every 5 minutes');
  console.log('   - Requires CRON_SECRET in Authorization header');
  
  if (!process.env.CRON_SECRET) {
    issues.push('CRON_SECRET not set - cron job cannot authenticate');
  }
  
  // 7. Check Twilio webhook logs
  console.log('\n7️⃣ Checking Recent SMS Activity:');
  const { data: recentMessages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .eq('direction', 'outbound')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (!messagesError && recentMessages && recentMessages.length > 0) {
    console.log(`✅ Found ${recentMessages.length} outbound messages in last 24 hours`);
  } else {
    console.log('⚠️  No outbound messages in last 24 hours');
    issues.push('No SMS messages have been sent in the last 24 hours');
  }
  
  // Summary
  console.log('\n📊 DIAGNOSIS SUMMARY:');
  console.log('====================');
  
  if (issues.length === 0) {
    console.log('✅ No issues found! SMS system appears to be configured correctly.');
  } else {
    console.log(`❌ Found ${issues.length} issue(s):\n`);
    issues.forEach((issue, index) => {
      console.log(`${index + 1}. ${issue}`);
    });
  }
  
  if (recommendations.length > 0) {
    console.log('\n💡 RECOMMENDATIONS:');
    recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`);
    });
  }
  
  // Specific recommendation for cron job
  if (pendingJobs && pendingJobs.length > 0) {
    console.log('\n🚀 TO PROCESS PENDING JOBS IMMEDIATELY:');
    console.log('=====================================');
    console.log('Run this command (replace YOUR_CRON_SECRET with actual value):');
    console.log(`\ncurl -X POST https://management.orangejelly.co.uk/api/jobs/process \\
  -H "Authorization: Bearer YOUR_CRON_SECRET"`);
    
    console.log('\nOr for local testing:');
    console.log(`curl -X POST http://localhost:3000/api/jobs/process \\
  -H "Authorization: Bearer YOUR_CRON_SECRET"`);
  }
  
  // Check if migration needs to be run
  if (!templates || templates.length === 0) {
    console.log('\n📝 TO ADD SMS TEMPLATES:');
    console.log('=======================');
    console.log('Run the migration to add default SMS templates:');
    console.log('supabase migration up');
  }
}

// Run the diagnosis
diagnoseSMS().catch(console.error);