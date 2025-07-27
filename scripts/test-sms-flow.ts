import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSMSFlow() {
  console.log('🧪 Testing SMS Flow\n');
  
  // 1. Find a confirmed booking from today
  const { data: bookings, error: bookingError } = await supabase
    .from('table_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1);
    
  if (bookingError) {
    console.error('Error fetching booking:', bookingError);
    return;
  }
  
  if (!bookings || bookings.length === 0) {
    console.log('No confirmed bookings found');
    return;
  }
  
  const booking = bookings[0];
  console.log(`Testing with booking: ${booking.booking_reference} (ID: ${booking.id})`);
  
  // 2. Check if SMS job exists for this booking
  console.log('\n📬 Checking for existing SMS jobs...');
  const { data: existingJobs, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .ilike('payload', `%${booking.id}%`);
    
  if (jobError) {
    console.error('Error checking jobs:', jobError);
  } else {
    console.log(`Found ${existingJobs?.length || 0} existing SMS jobs for this booking`);
  }
  
  // 3. Try to create a test SMS job directly
  console.log('\n🔧 Creating test SMS job...');
  const testPayload = {
    to: '+447990587315', // Your phone number
    template: 'booking_confirmation_regular',
    variables: {
      customer_name: 'Test',
      party_size: '2',
      date: 'Monday, January 27',
      time: '7:00 PM',
      reference: 'TEST-123',
      contact_phone: '01753682707'
    },
    booking_id: booking.id,
    customer_id: booking.customer_id
  };
  
  const { data: newJob, error: createError } = await supabase
    .from('jobs')
    .insert({
      type: 'send_sms',
      payload: testPayload,
      status: 'pending',
      scheduled_for: new Date().toISOString(),
      attempts: 0,
      max_attempts: 3
    })
    .select()
    .single();
    
  if (createError) {
    console.error('❌ Failed to create test job:', createError);
  } else {
    console.log('✅ Test job created successfully!');
    console.log(`   Job ID: ${newJob.id}`);
    console.log(`   Status: ${newJob.status}`);
  }
  
  // 4. Check if we can process the job manually
  if (newJob) {
    console.log('\n🚀 Attempting to process job manually...');
    
    try {
      // Import the job queue and process
      const { jobQueue } = await import('../src/lib/background-jobs.js');
      await jobQueue.processJobs(1);
      
      // Check job status after processing
      const { data: processedJob } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', newJob.id)
        .single();
        
      console.log(`   Job status after processing: ${processedJob?.status}`);
      if (processedJob?.error_message) {
        console.log(`   Error: ${processedJob.error_message}`);
      }
    } catch (err) {
      console.error('Error processing job:', err);
    }
  }
  
  // 5. Check if cron endpoint is accessible
  console.log('\n🌐 Testing cron endpoint...');
  try {
    const response = await fetch('http://localhost:3000/api/jobs/process', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('   Cron endpoint response:', data);
    } else {
      console.log(`   Cron endpoint returned: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.log('   Could not reach cron endpoint (expected in local dev)');
  }
}

testSMSFlow().catch(console.error);