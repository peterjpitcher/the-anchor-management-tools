#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import { JobQueue } from '../src/lib/background-jobs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function debugJobProcessing() {
  console.log('🔍 Debugging job processing...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Get the specific job
  const { data: job, error } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('id', 'fec2f819-7381-4a9c-b550-57ceba466e06')
    .single();
    
  if (error || !job) {
    console.error('❌ No pending SMS jobs found');
    return;
  }
  
  console.log('📋 Found job to process:');
  console.log(`   ID: ${job.id}`);
  console.log(`   Type: ${job.type}`);
  console.log(`   Status: ${job.status}`);
  console.log(`   Payload:`, JSON.stringify(job.payload, null, 2));
  
  // Try to process just this one job
  console.log('\n🚀 Attempting to process job...');
  
  try {
    const jobQueue = JobQueue.getInstance();
    
    // Mark job as processing to prevent race conditions
    await supabase
      .from('background_jobs')
      .update({ 
        status: 'processing',
        processed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    
    console.log('✅ Job marked as processing');
    
    // Process the job manually
    const payload = job.payload as any;
    console.log('\n📱 Sending SMS with Twilio...');
    console.log(`   To: ${payload.to}`);
    console.log(`   Message: ${payload.message?.substring(0, 50)}...`);
    
    // Import and call the SMS function
    const { sendSMS } = await import('../src/lib/twilio');
    const result = await sendSMS(payload.to, payload.message);
    
    if (result.success) {
      console.log('✅ SMS sent successfully!');
      console.log(`   Message SID: ${result.sid}`);
      
      // Mark job as completed
      await supabase
        .from('background_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result: { success: true, sid: result.sid }
        })
        .eq('id', job.id);
        
      // Log message to database
      if (payload.customerId) {
        const messageResult = await supabase
          .from('messages')
          .insert({
            customer_id: payload.customerId,
            direction: 'outbound',
            message_sid: result.sid,
            twilio_message_sid: result.sid,
            body: payload.message,
            status: 'sent',
            twilio_status: 'queued',
            from_number: process.env.TWILIO_PHONE_NUMBER,
            to_number: payload.to,
            message_type: 'sms'
          })
          .select();
          
        if (messageResult.error) {
          console.error('❌ Failed to log message:', messageResult.error);
        } else {
          console.log('✅ Message logged to database');
        }
      }
    } else {
      console.error('❌ SMS failed:', result.error);
      
      // Mark job as failed
      await supabase
        .from('background_jobs')
        .update({
          status: 'failed',
          error: result.error
        })
        .eq('id', job.id);
    }
    
  } catch (error) {
    console.error('❌ Error processing job:', error);
    
    // Mark job as failed
    await supabase
      .from('background_jobs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', job.id);
  }
}

debugJobProcessing()
  .then(() => {
    console.log('\n✅ Debug complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });