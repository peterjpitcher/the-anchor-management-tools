#!/usr/bin/env tsx

import { JobQueue } from '../src/lib/background-jobs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function processPendingSMS() {
  console.log('🚀 Processing pending SMS jobs...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // First check what jobs we have
  const { data: pendingJobs, error: checkError } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'pending')
    .eq('type', 'send_sms')
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(10);
    
  if (checkError) {
    console.error('❌ Error fetching jobs:', checkError);
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending SMS jobs found');
    return;
  }
  
  console.log(`📱 Found ${pendingJobs.length} pending SMS jobs to process:\n`);
  
  for (const job of pendingJobs) {
    console.log(`\n📨 Job ID: ${job.id}`);
    console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
    
    // Check if this is a loyalty welcome message
    if (job.payload.message && job.payload.message.includes('Welcome to The Anchor VIP Club')) {
      console.log('   ✨ This is a loyalty welcome message!');
      console.log(`   To: ${job.payload.to}`);
      console.log(`   Message: ${job.payload.message.substring(0, 60)}...`);
    }
  }
  
  console.log('\n\n⚙️  Processing jobs...\n');
  
  try {
    const jobQueue = JobQueue.getInstance();
    
    // Process the jobs
    await jobQueue.processJobs(10);
    
    console.log('\n✅ Job processing complete');
    
    // Check results
    const { data: results } = await supabase
      .from('background_jobs')
      .select('id, status, error')
      .in('id', pendingJobs.map(j => j.id));
      
    if (results) {
      console.log('\n📊 Results:');
      results.forEach(job => {
        if (job.status === 'completed') {
          console.log(`   ✅ ${job.id}: Completed`);
        } else if (job.status === 'failed') {
          console.log(`   ❌ ${job.id}: Failed - ${job.error}`);
        } else {
          console.log(`   ⏳ ${job.id}: ${job.status}`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error processing jobs:', error);
  }
}

processPendingSMS()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });