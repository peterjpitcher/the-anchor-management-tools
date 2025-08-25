#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function showPendingBulkSMS() {
  console.log('📋 PENDING BULK SMS ANALYSIS\n');
  console.log('=' .repeat(80));
  
  const supabase = await createAdminClient();
  
  // 1. Check pending send_sms jobs that look like they're from bulk operations
  console.log('🔍 Checking for pending SMS jobs that might be from bulk operations...\n');
  
  const { data: pendingJobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error('Error fetching jobs:', error);
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending SMS jobs found');
    return;
  }
  
  // Group jobs by creation time to identify bulk batches
  const jobsByMinute: { [key: string]: any[] } = {};
  
  pendingJobs.forEach(job => {
    const createdAt = new Date(job.created_at);
    const minuteKey = `${createdAt.toISOString().substring(0, 16)}`; // YYYY-MM-DDTHH:MM
    
    if (!jobsByMinute[minuteKey]) {
      jobsByMinute[minuteKey] = [];
    }
    jobsByMinute[minuteKey].push(job);
  });
  
  // Identify potential bulk operations (multiple jobs created in same minute)
  const bulkOperations = Object.entries(jobsByMinute).filter(([_, jobs]) => jobs.length > 1);
  
  if (bulkOperations.length > 0) {
    console.log(`⚠️  Found ${bulkOperations.length} potential bulk SMS operations:\n`);
    
    bulkOperations.forEach(([minute, jobs]) => {
      console.log(`📅 Batch created at: ${new Date(minute).toLocaleString()}`);
      console.log(`   Contains ${jobs.length} messages`);
      
      // Get customer IDs from the jobs
      const customerIds = jobs.map(job => (job.payload as any).customer_id || (job.payload as any).customerId).filter(Boolean);
      
      if (customerIds.length > 0) {
        // Get customer names
        supabase
          .from('customers')
          .select('id, first_name, last_name, mobile_number')
          .in('id', customerIds.slice(0, 5)) // Show first 5
          .then(({ data: customers }) => {
            if (customers) {
              console.log('   Recipients:');
              customers.forEach(c => {
                console.log(`     - ${c.first_name} ${c.last_name} (${c.mobile_number})`);
              });
              if (customerIds.length > 5) {
                console.log(`     ... and ${customerIds.length - 5} more`);
              }
            }
          });
      }
      
      // Show message preview
      const firstJob = jobs[0];
      const payload = firstJob.payload as any;
      if (payload.message) {
        console.log(`   Message: "${payload.message.substring(0, 80)}..."`);
      }
      
      console.log('');
    });
  }
  
  // Show all pending messages
  console.log(`\n📱 All ${pendingJobs.length} pending SMS messages:\n`);
  
  for (const job of pendingJobs) {
    const payload = job.payload as any;
    console.log(`Job ID: ${job.id}`);
    console.log(`Created: ${new Date(job.created_at).toLocaleString()}`);
    console.log(`To: ${payload.to}`);
    
    if (payload.template) {
      console.log(`Template: ${payload.template}`);
    } else if (payload.message) {
      console.log(`Message: "${payload.message.substring(0, 100)}..."`);
    }
    
    console.log('-'.repeat(40));
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n💡 DIAGNOSIS:');
  console.log('The bulk SMS feature is queuing individual send_sms jobs instead of');
  console.log('sending them directly. This is why messages appear to not be sent -');
  console.log('they\'re waiting in the job queue for the cron job to process them.');
  
  console.log('\n🚀 TO SEND THESE MESSAGES NOW:');
  console.log('Run: tsx scripts/process-sms-jobs.ts');
  
  console.log('\n🔧 TO FIX THE ISSUE:');
  console.log('The bulk SMS page needs to be updated to send messages directly');
  console.log('for small batches instead of always queuing them.');
}

// Run the check
showPendingBulkSMS().catch(console.error);