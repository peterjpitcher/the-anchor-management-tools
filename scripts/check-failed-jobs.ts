#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function checkFailedJobs() {
  console.log('🔍 Checking failed jobs in background_jobs table...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Get all failed jobs
  const { data: failedJobs, error } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(20);
    
  if (error) {
    console.error('❌ Error fetching jobs:', error);
    return;
  }
  
  if (!failedJobs || failedJobs.length === 0) {
    console.log('✅ No failed jobs found');
  } else {
    console.log(`📋 Found ${failedJobs.length} failed job(s):\n`);
    
    failedJobs.forEach((job, index) => {
      console.log(`\n${index + 1}. Job ID: ${job.id}`);
      console.log(`   Type: ${job.type}`);
      console.log(`   Status: ${job.status}`);
      console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
      console.log(`   Attempts: ${job.attempts}/${job.max_attempts}`);
      console.log(`   ❌ Error: ${job.error}`);
      console.log(`   Payload:`);
      console.log(JSON.stringify(job.payload, null, 4));
    });
  }
  
  // Also check for jobs that were attempted but still pending
  console.log('\n\n📋 Checking jobs with attempts but still pending:');
  const { data: attemptedJobs } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'pending')
    .gt('attempts', 0)
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (attemptedJobs && attemptedJobs.length > 0) {
    console.log(`Found ${attemptedJobs.length} job(s) with failed attempts:\n`);
    attemptedJobs.forEach((job, index) => {
      console.log(`\n${index + 1}. Job ID: ${job.id}`);
      console.log(`   Type: ${job.type}`);
      console.log(`   Attempts: ${job.attempts}/${job.max_attempts}`);
      console.log(`   Last error: ${job.error || 'No error message'}`);
    });
  } else {
    console.log('No pending jobs with failed attempts');
  }
  
  // Check environment variables
  console.log('\n\n🔧 Environment check:');
  console.log(`   TWILIO_ACCOUNT_SID: ${process.env.TWILIO_ACCOUNT_SID ? 'Set (' + process.env.TWILIO_ACCOUNT_SID.substring(0, 6) + '...)' : 'NOT SET'}`);
  console.log(`   TWILIO_AUTH_TOKEN: ${process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'NOT SET'}`);
  console.log(`   TWILIO_PHONE_NUMBER: ${process.env.TWILIO_PHONE_NUMBER || 'NOT SET'}`);
}

checkFailedJobs()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });