#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function testLoyaltyEnrollment() {
  console.log('🧪 Testing loyalty enrollment SMS flow...\n');
  
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
  
  console.log('✅ Found loyalty program:', program.id);
  
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
  
  console.log('✅ Default tier:', defaultTier.name);
  
  // Create loyalty member
  console.log('\n🎯 Creating loyalty member...');
  const { data: member, error: memberError } = await supabase
    .from('loyalty_members')
    .insert({
      customer_id: customer.id,
      program_id: program.id,
      tier_id: defaultTier.id,
      status: 'active',
      join_date: new Date().toISOString().split('T')[0],
      available_points: 50,
      total_points: 50,
      lifetime_points: 50
    })
    .select()
    .single();
    
  if (memberError || !member) {
    console.error('❌ Failed to create member:', memberError);
    return;
  }
  
  console.log('✅ Member created:', member.id);
  
  // Check if welcome series was started
  console.log('\n📧 Checking welcome series...');
  const { data: welcomeSeries } = await supabase
    .from('loyalty_welcome_series')
    .select('*')
    .eq('member_id', member.id)
    .single();
    
  if (welcomeSeries) {
    console.log('✅ Welcome series started:', welcomeSeries.id);
  } else {
    console.log('⚠️  No welcome series found');
  }
  
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
      console.log(`   - Message: ${payload.message?.substring(0, 50)}...`);
      console.log(`   - Type: ${payload.type}`);
    });
  } else {
    console.log('❌ No SMS jobs found for this customer');
  }
  
  // Clean up test data
  console.log('\n🧹 Cleaning up test data...');
  
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

testLoyaltyEnrollment()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });