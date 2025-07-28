import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testSMSFlow() {
  console.log('🔍 Testing SMS Flow for Table Bookings...\n');

  try {
    // 1. Check if SMS jobs are being created
    console.log('1️⃣ Checking recent SMS jobs:');
    const { data: recentJobs, error: jobsError } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .order('created_at', { ascending: false })
      .limit(5);

    if (jobsError) {
      console.error('❌ Error fetching jobs:', jobsError);
      return;
    }

    if (!recentJobs || recentJobs.length === 0) {
      console.log('⚠️  No SMS jobs found in queue');
    } else {
      console.log(`✅ Found ${recentJobs.length} recent SMS jobs:\n`);
      recentJobs.forEach((job, index) => {
        console.log(`Job ${index + 1}:`);
        console.log(`  ID: ${job.id}`);
        console.log(`  Status: ${job.status}`);
        console.log(`  Created: ${new Date(job.created_at).toLocaleString()}`);
        console.log(`  Scheduled for: ${new Date(job.scheduled_for).toLocaleString()}`);
        if (job.payload?.template) {
          console.log(`  Template: ${job.payload.template}`);
        }
        if (job.payload?.to) {
          console.log(`  To: ${job.payload.to}`);
        }
        if (job.error) {
          console.log(`  Error: ${job.error}`);
        }
        console.log('');
      });
    }

    // 2. Check actual SMS messages sent
    console.log('\n2️⃣ Checking recent SMS messages:');
    const { data: recentMessages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(5);

    if (messagesError) {
      console.error('❌ Error fetching messages:', messagesError);
      return;
    }

    if (!recentMessages || recentMessages.length === 0) {
      console.log('⚠️  No outbound messages found');
    } else {
      console.log(`✅ Found ${recentMessages.length} recent outbound messages:\n`);
      recentMessages.forEach((msg, index) => {
        console.log(`Message ${index + 1}:`);
        console.log(`  ID: ${msg.id}`);
        console.log(`  To: ${msg.to_number}`);
        console.log(`  Status: ${msg.twilio_status || msg.status}`);
        console.log(`  Created: ${new Date(msg.created_at).toLocaleString()}`);
        console.log(`  Body preview: ${msg.body.substring(0, 50)}...`);
        if (msg.error_message) {
          console.log(`  Error: ${msg.error_message}`);
        }
        console.log('');
      });
    }

    // 3. Check Twilio configuration
    console.log('\n3️⃣ Checking Twilio Configuration:');
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    
    console.log(`  Twilio Phone: ${twilioPhone ? '✅ Set' : '❌ Not set'}`);
    console.log(`  Twilio SID: ${twilioSid ? '✅ Set' : '❌ Not set'}`);
    console.log(`  Twilio Token: ${process.env.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Not set'}`);

    // 4. Check recent table bookings
    console.log('\n4️⃣ Checking recent confirmed table bookings:');
    const { data: recentBookings } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        status,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(3);

    if (recentBookings && recentBookings.length > 0) {
      console.log(`✅ Found ${recentBookings.length} recent confirmed bookings:`);
      recentBookings.forEach((booking, index) => {
        console.log(`\nBooking ${index + 1}: ${booking.booking_reference}`);
        console.log(`  Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
        console.log(`  Phone: ${booking.customer?.mobile_number}`);
        console.log(`  SMS Opt-in: ${booking.customer?.sms_opt_in ? 'Yes' : 'No'}`);
        console.log(`  Created: ${new Date(booking.created_at).toLocaleString()}`);
      });
    }

    // 5. Summary
    console.log('\n📊 SMS Flow Summary:');
    console.log('===================');
    
    const pendingJobs = recentJobs?.filter(j => j.status === 'pending').length || 0;
    const completedJobs = recentJobs?.filter(j => j.status === 'completed').length || 0;
    const failedJobs = recentJobs?.filter(j => j.status === 'failed').length || 0;
    
    console.log(`  Pending SMS jobs: ${pendingJobs}`);
    console.log(`  Completed SMS jobs: ${completedJobs}`);
    console.log(`  Failed SMS jobs: ${failedJobs}`);
    
    if (pendingJobs > 0) {
      console.log('\n⚠️  There are pending SMS jobs waiting to be processed');
      console.log('  These should be processed by the GitHub Action every 5 minutes');
    }
    
    if (failedJobs > 0) {
      console.log('\n❌ There are failed SMS jobs - check error messages above');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the test
testSMSFlow();