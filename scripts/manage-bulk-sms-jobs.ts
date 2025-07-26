#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';
import readline from 'readline';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function manageBulkSMSJobs() {
  console.log('🔧 BULK SMS JOB MANAGER\n');
  
  const supabase = await createAdminClient();
  
  // Get all pending send_sms jobs
  const { data: pendingJobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error('Error fetching jobs:', error);
    rl.close();
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending SMS jobs found');
    rl.close();
    return;
  }
  
  // Analyze jobs to find bulk operations
  const jobsByMinute: { [key: string]: any[] } = {};
  
  pendingJobs.forEach(job => {
    const createdAt = new Date(job.created_at);
    const minuteKey = `${createdAt.toISOString().substring(0, 16)}`; // YYYY-MM-DDTHH:MM
    
    if (!jobsByMinute[minuteKey]) {
      jobsByMinute[minuteKey] = [];
    }
    jobsByMinute[minuteKey].push(job);
  });
  
  // Show bulk operations
  const bulkOperations = Object.entries(jobsByMinute).filter(([_, jobs]) => jobs.length > 1);
  
  console.log(`Found ${pendingJobs.length} pending SMS jobs`);
  if (bulkOperations.length > 0) {
    console.log(`Including ${bulkOperations.length} potential bulk operations:\n`);
    
    bulkOperations.forEach(([minute, jobs]) => {
      console.log(`- ${new Date(minute).toLocaleString()}: ${jobs.length} messages`);
    });
  }
  
  console.log('\nOptions:');
  console.log('1. Process all pending jobs now');
  console.log('2. Cancel all pending jobs');
  console.log('3. Cancel only bulk operation jobs');
  console.log('4. Show details of all pending jobs');
  console.log('5. Exit');
  
  const choice = await question('\nYour choice (1-5): ');
  
  switch (choice) {
    case '1':
      console.log('\n🚀 Processing all pending jobs...');
      console.log('Run: tsx scripts/process-sms-jobs.ts');
      break;
      
    case '2':
      const confirm2 = await question(`\n⚠️  Cancel ALL ${pendingJobs.length} pending SMS? (yes/no): `);
      if (confirm2.toLowerCase() === 'yes') {
        const { error: cancelError } = await supabase
          .from('jobs')
          .update({ 
            status: 'cancelled',
            error_message: 'Manually cancelled - bulk SMS fix',
            failed_at: new Date().toISOString()
          })
          .eq('type', 'send_sms')
          .eq('status', 'pending');
          
        if (cancelError) {
          console.error('Error cancelling jobs:', cancelError);
        } else {
          console.log(`✅ Cancelled ${pendingJobs.length} SMS jobs`);
        }
      }
      break;
      
    case '3':
      if (bulkOperations.length === 0) {
        console.log('No bulk operations found');
        break;
      }
      
      const bulkJobIds = bulkOperations.flatMap(([_, jobs]) => jobs.map(j => j.id));
      const confirm3 = await question(`\n⚠️  Cancel ${bulkJobIds.length} bulk SMS jobs? (yes/no): `);
      
      if (confirm3.toLowerCase() === 'yes') {
        const { error: cancelError } = await supabase
          .from('jobs')
          .update({ 
            status: 'cancelled',
            error_message: 'Manually cancelled - bulk SMS fix',
            failed_at: new Date().toISOString()
          })
          .in('id', bulkJobIds);
          
        if (cancelError) {
          console.error('Error cancelling jobs:', cancelError);
        } else {
          console.log(`✅ Cancelled ${bulkJobIds.length} bulk SMS jobs`);
        }
      }
      break;
      
    case '4':
      console.log('\n📋 All Pending SMS Jobs:\n');
      for (const job of pendingJobs) {
        const payload = job.payload as any;
        console.log(`ID: ${job.id.substring(0, 8)}...`);
        console.log(`Created: ${new Date(job.created_at).toLocaleString()}`);
        console.log(`To: ${payload.to}`);
        if (payload.message) {
          console.log(`Message: "${payload.message.substring(0, 60)}..."`);
        } else if (payload.template) {
          console.log(`Template: ${payload.template}`);
        }
        console.log('-'.repeat(60));
      }
      break;
  }
  
  rl.close();
}

// Run the manager
manageBulkSMSJobs().catch(error => {
  console.error(error);
  rl.close();
});