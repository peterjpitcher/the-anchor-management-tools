#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import { JobQueue } from '../src/lib/background-jobs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function testEnrollmentWithSMS() {
  console.log('🧪 Testing loyalty enrollment with SMS...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Create a test customer with a real UK phone number format
  const testPhone = '07' + Math.floor(Math.random() * 900000000 + 100000000);
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
  
  // Get the loyalty program
  const { data: program } = await supabase
    .from('loyalty_programs')
    .select('id, settings')
    .eq('active', true)
    .single();
    
  if (!program) {
    console.error('❌ No active loyalty program found');
    return;
  }
  
  // Get the default tier
  const { data: defaultTier } = await supabase
    .from('loyalty_tiers')
    .select('id, name')
    .eq('program_id', program.id)
    .eq('level', 1)
    .single();
    
  if (!defaultTier) {
    console.error('❌ No default tier found');
    return;
  }
  
  // Create loyalty member
  console.log('\n🎯 Creating loyalty member...');
  const welcomeBonus = 50;
  const { data: member, error: memberError } = await supabase
    .from('loyalty_members')
    .insert({
      customer_id: customer.id,
      program_id: program.id,
      tier_id: defaultTier.id,
      status: 'active',
      join_date: new Date().toISOString().split('T')[0],
      available_points: welcomeBonus,
      total_points: welcomeBonus,
      lifetime_points: welcomeBonus
    })
    .select()
    .single();
    
  if (memberError || !member) {
    console.error('❌ Failed to create member:', memberError);
    return;
  }
  
  console.log('✅ Member created:', member.id);
  
  // Create welcome bonus transaction
  await supabase.from('loyalty_point_transactions').insert({
    member_id: member.id,
    points: welcomeBonus,
    balance_after: welcomeBonus,
    transaction_type: 'bonus',
    description: 'Welcome bonus',
    reference_type: 'enrollment',
    reference_id: member.id
  });
  
  console.log('✅ Welcome bonus transaction created');
  
  // Queue the welcome SMS
  console.log('\n📱 Queueing welcome SMS...');
  try {
    const jobQueue = JobQueue.getInstance();
    
    // Format phone number
    let phoneNumber = customer.mobile_number;
    if (phoneNumber.startsWith('0')) {
      phoneNumber = '+44' + phoneNumber.substring(1);
    }
    
    const customerName = `${customer.first_name} ${customer.last_name}`;
    const message = `Welcome to The Anchor VIP Club, ${customerName}! You've earned ${welcomeBonus} points. Start earning rewards at every visit!`;
    
    const jobId = await jobQueue.enqueue('send_sms', {
      to: phoneNumber,
      message: message,
      customerId: customer.id,
      type: 'custom'
    });
    
    console.log('✅ SMS job queued:', jobId);
    
    // Check the job was created
    const { data: job } = await supabase
      .from('background_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
      
    if (job) {
      console.log('\n📋 Job details:');
      console.log(`   Status: ${job.status}`);
      console.log(`   Type: ${job.type}`);
      const payload = job.payload as any;
      console.log(`   To: ${payload.to}`);
      console.log(`   Message: ${payload.message}`);
      console.log(`   SMS Type: ${payload.type}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to queue SMS:', error);
  }
  
  // Process the job
  console.log('\n🚀 Processing the SMS job...');
  try {
    const jobQueue = JobQueue.getInstance();
    await jobQueue.processJobs(5);
    console.log('✅ Job processing completed');
  } catch (error) {
    console.error('❌ Error processing jobs:', error);
  }
  
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
      console.log(`   - Twilio SID: ${msg.twilio_message_sid || 'N/A'}`);
    });
  } else {
    console.log('⚠️  No messages found in messages table');
  }
  
  // Clean up test data
  console.log('\n🧹 Cleaning up test data...');
  
  // Delete transactions
  await supabase
    .from('loyalty_point_transactions')
    .delete()
    .eq('member_id', member.id);
    
  // Delete member
  await supabase
    .from('loyalty_members')
    .delete()
    .eq('id', member.id);
    
  // Delete customer
  await supabase
    .from('customers')
    .delete()
    .eq('id', customer.id);
    
  console.log('✅ Test data cleaned up');
}

testEnrollmentWithSMS()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });