#!/usr/bin/env tsx

import { enrollLoyaltyMember } from '../src/app/actions/loyalty-members';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function simulateEnrollment() {
  console.log('🧪 Simulating complete loyalty enrollment flow...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Create a test customer
  const testPhone = '+447' + Math.floor(Math.random() * 900000000 + 100000000);
  const testFirstName = 'Test';
  const testLastName = 'Customer' + new Date().getTime();
  
  console.log('📱 Creating test customer:');
  console.log(`   Name: ${testFirstName} ${testLastName}`);
  console.log(`   Phone: ${testPhone}`);
  
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .insert({
      first_name: testFirstName,
      last_name: testLastName,
      mobile_number: testPhone,
      sms_opt_in: true
    })
    .select()
    .single();
    
  if (customerError || !customer) {
    console.error('❌ Failed to create customer:', customerError);
    return;
  }
  
  console.log('✅ Customer created:', customer.id);
  
  // Call the actual enrollment function  
  console.log('\n🎯 Enrolling customer in loyalty program...');
  const result = await enrollLoyaltyMember({
    customer_id: customer.id,
    status: 'active'
  });
  
  if (result.error) {
    console.error('❌ Enrollment failed:', result.error);
    return;
  }
  
  console.log('✅ Member enrolled successfully!');
  console.log('   Member ID:', result.data?.id);
  
  // Wait a moment for job to be queued
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check for SMS jobs
  console.log('\n📱 Checking for SMS jobs...');
  const { data: smsJobs } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .ilike('payload', `%${customer.id}%`)
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (smsJobs && smsJobs.length > 0) {
    console.log(`✅ Found ${smsJobs.length} SMS job(s):`);
    smsJobs.forEach((job, index) => {
      console.log(`\n   Job ${index + 1}:`);
      console.log(`   - ID: ${job.id}`);
      console.log(`   - Status: ${job.status}`);
      console.log(`   - Created: ${new Date(job.created_at).toLocaleString()}`);
      const payload = job.payload as any;
      console.log(`   - To: ${payload.to}`);
      console.log(`   - Message: ${payload.message?.substring(0, 80)}...`);
      console.log(`   - Type: ${payload.type}`);
    });
  } else {
    console.log('❌ No SMS jobs found for this customer');
  }
  
  // Process the job to actually send it
  console.log('\n🚀 Processing the SMS job...');
  const { JobQueue } = await import('../src/lib/background-jobs');
  const jobQueue = JobQueue.getInstance();
  await jobQueue.processJobs(5);
  
  console.log('✅ Job processing completed');
  
  // Check message table
  console.log('\n📨 Checking messages table...');
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (messages && messages.length > 0) {
    console.log(`✅ Found ${messages.length} message(s):`);
    messages.forEach((msg, index) => {
      console.log(`\n   Message ${index + 1}:`);
      console.log(`   - Status: ${msg.status}`);
      console.log(`   - To: ${msg.to_number}`);
      console.log(`   - Body: ${msg.body?.substring(0, 80)}...`);
    });
  } else {
    console.log('⚠️  No messages found in messages table');
  }
  
  // Clean up test data
  console.log('\n🧹 Cleaning up test data...');
  
  // Delete member
  if (result.data?.id) {
    await supabase
      .from('loyalty_members')
      .delete()
      .eq('id', result.data.id);
  }
    
  // Delete customer
  await supabase
    .from('customers')
    .delete()
    .eq('id', customer.id);
    
  console.log('✅ Test data cleaned up');
}

simulateEnrollment()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });