import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigateBookingSMS() {
  console.log('🔍 Table Booking SMS Investigation\n');
  
  // 1. Check today's bookings
  console.log('📅 Today\'s Table Bookings:');
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  const { data: bookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      booking_date,
      booking_time,
      party_size,
      status,
      created_at,
      customer_id,
      customers!table_bookings_customer_id_fkey (
        id,
        first_name,
        last_name,
        mobile_number,
        sms_opt_in
      )
    `)
    .gte('created_at', todayStr + 'T00:00:00')
    .order('created_at', { ascending: false });
    
  if (bookingsError) {
    console.error('Error fetching bookings:', bookingsError);
  } else {
    console.log(`Found ${bookings?.length || 0} bookings created today`);
    
    for (const booking of bookings || []) {
      console.log(`\n  📝 Booking: ${booking.booking_reference}`);
      console.log(`     Status: ${booking.status}`);
      console.log(`     Customer: ${booking.customers?.first_name} ${booking.customers?.last_name}`);
      console.log(`     Phone: ${booking.customers?.mobile_number || 'No phone'}`);
      console.log(`     SMS Opt-in: ${booking.customers?.sms_opt_in ? '✅' : '❌'}`);
      console.log(`     Created: ${new Date(booking.created_at).toLocaleTimeString()}`);
      
      // Check if SMS job was created for this booking
      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .eq('type', 'send_sms')
        .contains('payload', { booking_id: booking.id })
        .order('created_at', { ascending: false });
        
      if (!jobsError && jobs) {
        console.log(`     SMS Jobs: ${jobs.length} found`);
        for (const job of jobs) {
          console.log(`       - Job ID: ${job.id.substring(0, 8)}...`);
          console.log(`         Status: ${job.status}`);
          console.log(`         Created: ${new Date(job.created_at).toLocaleTimeString()}`);
          if (job.error_message) {
            console.log(`         Error: ${job.error_message}`);
          }
          if (job.completed_at) {
            console.log(`         Completed: ${new Date(job.completed_at).toLocaleTimeString()}`);
          }
        }
      } else {
        console.log(`     SMS Jobs: None found`);
      }
    }
  }
  
  // 2. Check SMS templates
  console.log('\n\n📋 SMS Templates:');
  const { data: templates, error: templatesError } = await supabase
    .from('table_booking_sms_templates')
    .select('*')
    .eq('is_active', true)
    .in('template_key', ['booking_confirmation_regular', 'booking_confirmation_sunday_lunch']);
    
  if (templatesError) {
    console.error('Error fetching templates:', templatesError);
  } else {
    console.log(`Found ${templates?.length || 0} active booking templates`);
    templates?.forEach(template => {
      console.log(`  - ${template.template_key}: "${template.template_text.substring(0, 50)}..."`);
    });
  }
  
  // 3. Check recent SMS jobs (last 2 hours)
  console.log('\n\n📬 Recent SMS Jobs (last 2 hours):');
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  
  const { data: recentJobs, error: recentJobsError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .gte('created_at', twoHoursAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
    
  if (recentJobsError) {
    console.error('Error fetching recent jobs:', recentJobsError);
  } else {
    console.log(`Found ${recentJobs?.length || 0} SMS jobs`);
    
    // Group by status
    const statusCounts: Record<string, number> = {};
    recentJobs?.forEach(job => {
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    });
    
    console.log('\nStatus breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`);
    });
    
    // Show failed jobs
    const failedJobs = recentJobs?.filter(job => job.status === 'failed');
    if (failedJobs && failedJobs.length > 0) {
      console.log('\n❌ Failed Jobs:');
      failedJobs.forEach(job => {
        console.log(`  - Job ID: ${job.id.substring(0, 8)}...`);
        console.log(`    Error: ${job.error_message}`);
        console.log(`    Payload: ${JSON.stringify(job.payload).substring(0, 100)}...`);
      });
    }
  }
  
  // 4. Check if cron is actually running
  console.log('\n\n⏰ Cron Job Activity:');
  const { data: completedJobs, error: completedError } = await supabase
    .from('jobs')
    .select('completed_at')
    .eq('status', 'completed')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(5);
    
  if (!completedError && completedJobs?.length > 0) {
    const lastProcessed = new Date(completedJobs[0].completed_at);
    const minutesAgo = Math.floor((Date.now() - lastProcessed.getTime()) / 60000);
    console.log(`  Last job processed: ${minutesAgo} minutes ago at ${lastProcessed.toLocaleTimeString()}`);
    
    if (minutesAgo > 10) {
      console.log('  ⚠️  WARNING: Jobs haven\'t been processed in over 10 minutes!');
      console.log('  The cron job might not be running properly.');
    } else {
      console.log('  ✅ Jobs are being processed regularly');
    }
  } else {
    console.log('  ❌ No completed jobs found - cron might not be running!');
  }
  
  // 5. Check Twilio sending capability
  console.log('\n\n🔐 SMS Configuration:');
  console.log(`  Twilio configured: ${process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER ? '✅' : '❌'}`);
  console.log(`  From number: ${process.env.TWILIO_PHONE_NUMBER || 'Not set'}`);
  
  // Import isSmsEnabled from env
  try {
    const { isSmsEnabled } = await import('../src/lib/env');
    console.log(`  SMS enabled (by env.ts): ${isSmsEnabled() ? '✅' : '❌'}`);
  } catch (err) {
    console.log('  Could not check isSmsEnabled function');
  }
  
  // Summary
  console.log('\n\n📊 Summary:');
  console.log('1. Check that customers have SMS opt-in enabled');
  console.log('2. Verify phone numbers are in correct format');
  console.log('3. Ensure cron job is running (check Vercel dashboard)');
  console.log('4. Check for any failed jobs with error messages');
  console.log('5. Verify SMS templates are active');
}

investigateBookingSMS().catch(console.error);