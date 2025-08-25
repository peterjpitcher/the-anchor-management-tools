#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function checkBulkSMSJobs() {
  console.log('🔍 Checking Bulk SMS Jobs...\n');
  
  const supabase = await createAdminClient();
  
  // 1. Check all bulk SMS jobs
  console.log('1️⃣ All Bulk SMS Jobs (last 7 days):');
  const { data: allBulkJobs, error: allError } = await supabase
    .from('jobs')
    .select('*')
    .or('type.eq.send_bulk_sms,type.eq.send_sms')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });
    
  if (allError) {
    console.error('Error fetching jobs:', allError);
  } else {
    const bulkJobs = allBulkJobs?.filter(j => j.type === 'send_bulk_sms') || [];
    const smsJobs = allBulkJobs?.filter(j => j.type === 'send_sms') || [];
    
    console.log(`Found ${bulkJobs.length} bulk SMS jobs and ${smsJobs.length} individual SMS jobs`);
    
    // Group by status
    const statusGroups = {
      pending: bulkJobs.filter(j => j.status === 'pending'),
      processing: bulkJobs.filter(j => j.status === 'processing'),
      completed: bulkJobs.filter(j => j.status === 'completed'),
      failed: bulkJobs.filter(j => j.status === 'failed')
    };
    
    console.log('\nBulk SMS Job Status Summary:');
    console.table([
      { Status: 'Pending', Count: statusGroups.pending.length },
      { Status: 'Processing', Count: statusGroups.processing.length },
      { Status: 'Completed', Count: statusGroups.completed.length },
      { Status: 'Failed', Count: statusGroups.failed.length }
    ]);
    
    // Show pending bulk jobs in detail
    if (statusGroups.pending.length > 0) {
      console.log('\n⚠️  Pending Bulk SMS Jobs:');
      statusGroups.pending.forEach(job => {
        const payload = job.payload as any;
        console.log(`\nJob ID: ${job.id}`);
        console.log(`Created: ${new Date(job.created_at).toLocaleString()}`);
        console.log(`Recipients: ${payload.customerIds?.length || 0} customers`);
        console.log(`Message preview: "${(payload.message || '').substring(0, 50)}..."`);
      });
    }
    
    // Show failed bulk jobs
    if (statusGroups.failed.length > 0) {
      console.log('\n❌ Failed Bulk SMS Jobs:');
      statusGroups.failed.forEach(job => {
        const payload = job.payload as any;
        console.log(`\nJob ID: ${job.id}`);
        console.log(`Failed at: ${new Date(job.failed_at || job.updated_at).toLocaleString()}`);
        console.log(`Error: ${job.error_message || 'No error message'}`);
        console.log(`Recipients: ${payload.customerIds?.length || 0} customers`);
      });
    }
  }
  
  // 2. Check individual SMS jobs that might be from bulk operations
  console.log('\n2️⃣ Individual SMS Jobs (might be from small bulk operations):');
  const { data: recentSmsJobs, error: smsError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (!smsError && recentSmsJobs) {
    const pendingSms = recentSmsJobs.filter(j => j.status === 'pending');
    const failedSms = recentSmsJobs.filter(j => j.status === 'failed');
    
    console.log(`Found ${pendingSms.length} pending and ${failedSms.length} failed SMS jobs in last 24 hours`);
    
    if (pendingSms.length > 0) {
      console.log('\nPending SMS messages (first 5):');
      pendingSms.slice(0, 5).forEach(job => {
        const payload = job.payload as any;
        console.log(`- To: ${payload.to}, Template: ${payload.template || 'direct message'}`);
      });
    }
  }
  
  // 3. Check messages sent in last 24 hours
  console.log('\n3️⃣ Successfully Sent Messages (last 24 hours):');
  const { data: sentMessages, error: messagesError } = await supabase
    .from('messages')
    .select('COUNT(*)')
    .eq('direction', 'outbound')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    
  if (!messagesError && sentMessages) {
    console.log(`✅ ${sentMessages[0].count} outbound messages sent successfully`);
  }
  
  // 4. Critical Issue Detection
  console.log('\n4️⃣ CRITICAL ISSUE FOUND:');
  console.log('=====================================');
  console.log('❌ The bulk SMS page is calling the wrong function!');
  console.log('\nFor small batches (≤50 customers), the code on line 341 calls:');
  console.log('  await sendBulkSMS([customer.id], personalizedContent)');
  console.log('\nBut sendBulkSMS ALWAYS queues jobs, even for single customers!');
  console.log('This means ALL bulk SMS messages go to the job queue.');
  console.log('\nThe correct approach would be to:');
  console.log('1. Call a direct send function for small batches');
  console.log('2. Only queue jobs for large batches (>50)');
  
  // 5. Check if cron job is processing
  console.log('\n5️⃣ Job Processing Status:');
  const pendingJobsCount = (await supabase
    .from('jobs')
    .select('COUNT(*)')
    .eq('status', 'pending')).data?.[0]?.count || 0;
    
  if (pendingJobsCount > 0) {
    console.log(`⚠️  ${pendingJobsCount} jobs are pending in the queue`);
    console.log('This suggests the cron job may not be running regularly.');
  } else {
    console.log('✅ No pending jobs - queue is being processed');
  }
}

// Run the check
checkBulkSMSJobs().catch(console.error);