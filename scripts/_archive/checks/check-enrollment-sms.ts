#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function checkEnrollmentSMS() {
  console.log('🔍 Checking loyalty enrollment SMS issues...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Check recent loyalty members
  console.log('📊 Recent loyalty enrollments (last 24 hours):');
  const { data: recentMembers, error: memberError } = await supabase
    .from('loyalty_members')
    .select(`
      id,
      created_at,
      customer_id
    `)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });
    
  if (memberError) {
    console.error('❌ Error checking members:', memberError);
    return;
  }
  
  if (recentMembers && recentMembers.length > 0) {
    for (const member of recentMembers) {
      // Get customer details separately
      const { data: customer } = await supabase
        .from('customers')
        .select('id, name, phone_number')
        .eq('id', member.customer_id)
        .single();
        
      console.log(`\n✅ Member enrolled:`);
      console.log(`   ID: ${member.id}`);
      console.log(`   Customer: ${customer?.name || 'Unknown'}`);
      console.log(`   Phone: ${customer?.phone_number || 'No phone'}`);
      console.log(`   Enrolled: ${new Date(member.created_at).toLocaleString()}`);
    }
  } else {
    console.log('⚠️  No recent enrollments found');
  }
  
  // Check recent SMS jobs
  console.log('\n\n📱 Recent SMS jobs (last 24 hours):');
  const { data: smsJobs, error: jobError } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('type', 'send_sms')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (jobError) {
    console.error('❌ Error checking jobs:', jobError);
    return;
  }
  
  if (smsJobs && smsJobs.length > 0) {
    smsJobs.forEach(job => {
      console.log(`\n📨 SMS Job:`);
      console.log(`   ID: ${job.id}`);
      console.log(`   Status: ${job.status}`);
      console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
      console.log(`   Payload:`, JSON.stringify(job.payload, null, 2));
      if (job.error) {
        console.log(`   ❌ Error: ${job.error}`);
      }
    });
  } else {
    console.log('⚠️  No recent SMS jobs found');
  }
  
  // Check loyalty notifications table
  console.log('\n\n📋 Recent loyalty notifications:');
  const { data: notifications, error: notifError } = await supabase
    .from('loyalty_notifications')
    .select('*')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (notifError) {
    console.error('❌ Error checking notifications:', notifError);
    // Table might not exist yet
    console.log('   (This table might not exist yet)');
  } else if (notifications && notifications.length > 0) {
    notifications.forEach(notif => {
      console.log(`\n📬 Notification:`);
      console.log(`   Type: ${notif.notification_type}`);
      console.log(`   Channel: ${notif.channel}`);
      console.log(`   Created: ${new Date(notif.created_at).toLocaleString()}`);
      console.log(`   Content: ${notif.content}`);
    });
  } else {
    console.log('⚠️  No recent loyalty notifications found');
  }
  
  // Check messaging health
  if (recentMembers && recentMembers.length > 0) {
    console.log('\n\n🏥 Customer messaging health:');
    for (const member of recentMembers) {
      if (member.customer_id) {
        const { data: customer } = await supabase
          .from('customers')
          .select('name')
          .eq('id', member.customer_id)
          .single();
          
        const { data: health } = await supabase
          .from('customer_messaging_health')
          .select('*')
          .eq('customer_id', member.customer_id)
          .single();
          
        console.log(`\n👤 ${customer?.name || 'Unknown'}:`);
        if (health) {
          console.log(`   SMS Suspended: ${health.sms_suspended ? '❌ Yes' : '✅ No'}`);
          console.log(`   Total SMS Sent: ${health.total_sms_sent || 0}`);
          console.log(`   Failed SMS: ${health.failed_sms_count || 0}`);
        } else {
          console.log('   No messaging health record found');
        }
      }
    }
  }
  
  // Check if loyalty program is active
  console.log('\n\n⚙️  Loyalty program status:');
  const { data: program } = await supabase
    .from('loyalty_programs')
    .select('*')
    .eq('active', true)
    .single();
    
  if (program) {
    console.log('✅ Loyalty program is active');
    console.log(`   Welcome bonus: ${program.settings?.welcome_bonus || 'Not set'} points`);
  } else {
    console.log('❌ No active loyalty program found!');
  }
}

checkEnrollmentSMS()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });