#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function fixTemplateKeys() {
  console.log('🔧 Fixing SMS Template Keys in Pending Jobs...\n');
  
  const supabase = await createAdminClient();
  
  // 1. Find pending jobs with old template key
  console.log('1️⃣ Finding jobs with old template keys...');
  const { data: oldJobs, error: fetchError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending');
    
  if (fetchError) {
    console.error('❌ Error fetching jobs:', fetchError);
    return;
  }
  
  if (!oldJobs || oldJobs.length === 0) {
    console.log('✅ No pending SMS jobs found');
    return;
  }
  
  console.log(`Found ${oldJobs.length} pending SMS jobs`);
  
  let fixedCount = 0;
  
  for (const job of oldJobs) {
    const payload = job.payload as any;
    
    // Check if using old template key
    if (payload.template === 'table_booking_confirmation') {
      console.log(`\n🔍 Fixing job ${job.id}...`);
      
      // Determine the correct template based on other fields
      // Default to regular booking unless we have evidence it's Sunday lunch
      const newTemplate = 'booking_confirmation_regular';
      
      // Update the payload
      const updatedPayload = {
        ...payload,
        template: newTemplate
      };
      
      // Update the job
      const { error: updateError } = await supabase
        .from('jobs')
        .update({ 
          payload: updatedPayload,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
        
      if (updateError) {
        console.error(`❌ Failed to update job ${job.id}:`, updateError);
      } else {
        console.log(`✅ Updated job ${job.id} template: ${payload.template} → ${newTemplate}`);
        fixedCount++;
      }
    }
  }
  
  console.log(`\n✅ Fixed ${fixedCount} jobs with old template keys`);
  
  // 2. Show summary of all pending jobs
  console.log('\n2️⃣ Current pending SMS jobs:');
  const { data: currentJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
    
  if (currentJobs && currentJobs.length > 0) {
    console.log(`\nFound ${currentJobs.length} pending jobs ready to process:`);
    currentJobs.forEach(job => {
      const payload = job.payload as any;
      console.log(`   - Job ${job.id}: Template "${payload.template}", To: ${payload.to}`);
    });
    
    console.log('\n💡 To process these jobs, run:');
    console.log('   tsx scripts/process-sms-jobs.ts');
  }
}

// Run the fix
fixTemplateKeys().catch(console.error);