#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function checkPendingJobs() {
  console.log('🔍 Checking pending jobs in background_jobs table...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Get all pending jobs
  const { data: pendingJobs, error } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error('❌ Error fetching jobs:', error);
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending jobs found');
    return;
  }
  
  console.log(`📋 Found ${pendingJobs.length} pending jobs:\n`);
  
  pendingJobs.forEach((job, index) => {
    console.log(`\n${index + 1}. Job ID: ${job.id}`);
    console.log(`   Type: ${job.type}`);
    console.log(`   Status: ${job.status}`);
    console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
    console.log(`   Scheduled for: ${new Date(job.scheduled_for).toLocaleString()}`);
    console.log(`   Attempts: ${job.attempts}/${job.max_attempts}`);
    console.log(`   Priority: ${job.priority}`);
    console.log(`   Payload:`);
    console.log(JSON.stringify(job.payload, null, 4));
    
    if (job.error) {
      console.log(`   ❌ Last error: ${job.error}`);
    }
  });
  
  // Check if any are SMS jobs
  const smsJobs = pendingJobs.filter(job => job.type === 'send_sms');
  if (smsJobs.length > 0) {
    console.log(`\n\n📱 SMS Jobs Summary: ${smsJobs.length} pending SMS messages`);
  }
  
  // Check if any are welcome email jobs
  const welcomeJobs = pendingJobs.filter(job => job.type === 'send_welcome_email');
  if (welcomeJobs.length > 0) {
    console.log(`\n📧 Welcome Email Jobs Summary: ${welcomeJobs.length} pending welcome emails`);
  }
}

checkPendingJobs()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });