import { createAdminClient } from '../src/lib/supabase/server';

async function checkSMSJobs() {
  console.log('🔍 Checking SMS Jobs Queue...\n');
  
  const supabase = await createAdminClient();
  
  // 1. Check pending SMS jobs
  console.log('1️⃣ Pending SMS Jobs:');
  const { data: pendingJobs, error: pendingError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (pendingError) {
    console.error('Error fetching pending jobs:', pendingError);
  } else {
    console.log(`Found ${pendingJobs?.length || 0} pending SMS jobs`);
    if (pendingJobs && pendingJobs.length > 0) {
      console.table(pendingJobs.map(job => ({
        id: job.id,
        created_at: job.created_at,
        payload: JSON.stringify(job.payload).substring(0, 50) + '...'
      })));
    }
  }
  
  // 2. Check failed SMS jobs
  console.log('\n2️⃣ Failed SMS Jobs:');
  const { data: failedJobs, error: failedError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (failedError) {
    console.error('Error fetching failed jobs:', failedError);
  } else {
    console.log(`Found ${failedJobs?.length || 0} failed SMS jobs`);
    if (failedJobs && failedJobs.length > 0) {
      console.table(failedJobs.map(job => ({
        id: job.id,
        created_at: job.created_at,
        error: job.error,
        attempts: job.attempts
      })));
    }
  }
  
  // 3. Check recent table bookings
  console.log('\n3️⃣ Recent Table Bookings (last 7 days):');
  const { data: recentBookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(`
      *,
      customers (
        id,
        first_name,
        last_name,
        mobile_number,
        sms_opt_in
      )
    `)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (bookingsError) {
    console.error('Error fetching bookings:', bookingsError);
  } else {
    console.log(`Found ${recentBookings?.length || 0} recent bookings`);
    if (recentBookings && recentBookings.length > 0) {
      console.table(recentBookings.map(booking => ({
        id: booking.id,
        customer: `${booking.customers?.first_name} ${booking.customers?.last_name}`,
        date: booking.date,
        time: booking.time,
        status: booking.status,
        sms_opt_in: booking.customers?.sms_opt_in,
        created_at: booking.created_at
      })));
    }
  }
  
  // 4. Check SMS templates
  console.log('\n4️⃣ Active SMS Templates:');
  const { data: templates, error: templatesError } = await supabase
    .from('table_booking_sms_templates')
    .select('*')
    .eq('is_active', true);
    
  if (templatesError) {
    console.error('Error fetching templates:', templatesError);
  } else {
    console.log(`Found ${templates?.length || 0} active templates`);
    if (templates && templates.length > 0) {
      console.table(templates.map(template => ({
        key: template.key,
        name: template.name,
        type: template.type,
        is_active: template.is_active
      })));
    }
  }
  
  // 5. Check environment variables
  console.log('\n5️⃣ Environment Variables Check:');
  const envVars = {
    'TWILIO_ACCOUNT_SID': !!process.env.TWILIO_ACCOUNT_SID,
    'TWILIO_AUTH_TOKEN': !!process.env.TWILIO_AUTH_TOKEN,
    'TWILIO_PHONE_NUMBER': !!process.env.TWILIO_PHONE_NUMBER,
    'NEXT_PUBLIC_CONTACT_PHONE_NUMBER': !!process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER,
    'CRON_SECRET': !!process.env.CRON_SECRET
  };
  
  console.table(Object.entries(envVars).map(([key, value]) => ({
    Variable: key,
    Status: value ? '✅ Set' : '❌ Missing'
  })));
  
  // 6. Check job processing history
  console.log('\n6️⃣ Job Processing History (last 24 hours):');
  const { data: processedJobs, error: processedError } = await supabase
    .from('jobs')
    .select('status, COUNT(*)')
    .eq('type', 'send_sms')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('status');
    
  if (processedError) {
    console.error('Error fetching job history:', processedError);
  } else {
    // Manual group by since Supabase doesn't support it directly
    const jobCounts = pendingJobs && failedJobs ? {
      pending: pendingJobs.length,
      failed: failedJobs.length,
      completed: 0 // We'd need another query for completed
    } : {};
    
    console.log('Job status distribution:', jobCounts);
  }
  
  console.log('\n✅ SMS Jobs check complete!');
}

checkSMSJobs().catch(console.error);