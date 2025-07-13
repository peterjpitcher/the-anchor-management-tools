#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function processPendingSMS() {
  console.log('🔍 Checking pending SMS jobs...\n');
  
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
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error('❌ Error fetching jobs:', error);
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending SMS jobs found');
    return;
  }
  
  console.log(`📱 Found ${pendingJobs.length} pending jobs:\n`);
  
  for (const job of pendingJobs) {
    console.log(`\n📨 Job ID: ${job.id}`);
    console.log(`   Type: ${job.type}`);
    console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
    console.log(`   Payload:`, JSON.stringify(job.payload, null, 2));
    
    // Check if this is a loyalty welcome message
    if (job.payload.message && job.payload.message.includes('Welcome to The Anchor VIP Club')) {
      console.log('   ✨ This is a loyalty welcome message!');
    }
    
    // Get customer info if available
    if (job.payload.customerId) {
      const { data: customer } = await supabase
        .from('customers')
        .select('name, phone_number')
        .eq('id', job.payload.customerId)
        .single();
        
      if (customer) {
        console.log(`   Customer: ${customer.name}`);
        console.log(`   Phone: ${customer.phone_number}`);
      }
    }
  }
  
  console.log('\n\n💡 To process these jobs:');
  console.log('1. In development: Run the job processor manually');
  console.log('   - Visit http://localhost:3000/api/jobs/process');
  console.log('   - Or run: curl http://localhost:3000/api/jobs/process');
  console.log('\n2. In production: Jobs are processed automatically every 5 minutes via cron');
  console.log('\n3. Make sure Twilio is configured in your .env.local:');
  console.log('   - TWILIO_ACCOUNT_SID');
  console.log('   - TWILIO_AUTH_TOKEN');
  console.log('   - TWILIO_PHONE_NUMBER');
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