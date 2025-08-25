import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigateSMS() {
  console.log('🔍 SMS Investigation Report\n');
  
  // 1. Check recent jobs
  console.log('📬 Recent SMS Jobs (last 24 hours):');
  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (jobsError) {
    console.error('Error fetching jobs:', jobsError);
  } else {
    console.log(`Found ${jobs?.length || 0} SMS jobs`);
    jobs?.forEach(job => {
      console.log(`  - ID: ${job.id}, Status: ${job.status}, Created: ${job.created_at}`);
      if (job.error) console.log(`    Error: ${job.error}`);
    });
  }
  
  // 2. Check recent messages
  console.log('\n📱 Recent Messages (last 24 hours):');
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (messagesError) {
    console.error('Error fetching messages:', messagesError);
  } else {
    console.log(`Found ${messages?.length || 0} messages`);
    messages?.forEach(msg => {
      console.log(`  - ID: ${msg.id}, Status: ${msg.status}, Type: ${msg.message_type}`);
      console.log(`    Phone: ${msg.phone_number}, Created: ${msg.created_at}`);
      if (msg.error_message) console.log(`    Error: ${msg.error_message}`);
    });
  }
  
  // 3. Check today's table bookings
  console.log('\n📅 Today\'s Table Bookings:');
  const today = new Date().toISOString().split('T')[0];
  const { data: bookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(`
      *,
      customers (
        id,
        name,
        phone_number,
        sms_opt_in
      )
    `)
    .gte('created_at', today + 'T00:00:00')
    .order('created_at', { ascending: false });
    
  if (bookingsError) {
    console.error('Error fetching bookings:', bookingsError);
  } else {
    console.log(`Found ${bookings?.length || 0} bookings today`);
    bookings?.forEach(booking => {
      console.log(`  - Booking ID: ${booking.id}, Customer: ${booking.customers?.name}`);
      console.log(`    Phone: ${booking.customers?.phone_number}, SMS Opt-in: ${booking.customers?.sms_opt_in}`);
      console.log(`    Created: ${booking.created_at}`);
    });
  }
  
  // 4. Check cron job configuration
  console.log('\n⏰ Cron Job Configuration:');
  console.log('  - Job processing endpoint: /api/jobs/process');
  console.log('  - Schedule: Every 5 minutes');
  console.log('  - Defined in: vercel.json');
  
  // 5. Check environment variables
  console.log('\n🔐 Environment Check:');
  console.log(`  - TWILIO_ACCOUNT_SID: ${process.env.TWILIO_ACCOUNT_SID ? '✅ Set' : '❌ Missing'}`);
  console.log(`  - TWILIO_AUTH_TOKEN: ${process.env.TWILIO_AUTH_TOKEN ? '✅ Set (hidden)' : '❌ Missing'}`);
  console.log(`  - TWILIO_PHONE_NUMBER: ${process.env.TWILIO_PHONE_NUMBER || '❌ Missing'}`);
  console.log(`  - NEXT_PUBLIC_ENABLE_SMS: ${process.env.NEXT_PUBLIC_ENABLE_SMS === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
  
  // 6. Check customer messaging health
  console.log('\n💚 Customer Messaging Health (issues only):');
  const { data: healthIssues, error: healthError } = await supabase
    .from('customer_messaging_health')
    .select('*')
    .or('sms_suspended.eq.true,sms_undelivered_count.gt.0');
    
  if (healthError) {
    console.error('Error fetching health:', healthError);
  } else {
    console.log(`Found ${healthIssues?.length || 0} customers with issues`);
    healthIssues?.forEach(health => {
      console.log(`  - Customer ID: ${health.customer_id}`);
      console.log(`    Suspended: ${health.sms_suspended}, Undelivered: ${health.sms_undelivered_count}`);
    });
  }
  
  // 7. Summary
  console.log('\n📊 Summary:');
  console.log('SMS Feature Status:', process.env.NEXT_PUBLIC_ENABLE_SMS === 'true' ? '✅ Enabled' : '❌ Disabled');
  if (process.env.NEXT_PUBLIC_ENABLE_SMS !== 'true') {
    console.log('\n⚠️  SMS is DISABLED. Set NEXT_PUBLIC_ENABLE_SMS=true to enable SMS sending.');
  }
}

investigateSMS().catch(console.error);