import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function sendBookingSMSNow() {
  console.log('📱 Sending booking confirmation SMS...\n');
  
  // Get the booking
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select(`
      *,
      customers!table_bookings_customer_id_fkey (*)
    `)
    .eq('booking_reference', 'TB-2025-7271')
    .single();
    
  if (error || !booking) {
    console.error('Could not find booking');
    return;
  }
  
  console.log(`Booking: ${booking.booking_reference}`);
  console.log(`Customer: ${booking.customers.first_name} ${booking.customers.last_name}`);
  console.log(`Phone: ${booking.customers.mobile_number}`);
  
  // Create SMS job
  const payload = {
    to: booking.customers.mobile_number,
    template: 'booking_confirmation_regular',
    variables: {
      customer_name: booking.customers.first_name,
      party_size: booking.party_size.toString(),
      date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      time: formatTime(booking.booking_time),
      reference: booking.booking_reference,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
    },
    booking_id: booking.id,
    customer_id: booking.customer_id
  };
  
  // Insert job
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .insert({
      type: 'send_sms',
      payload,
      status: 'pending',
      scheduled_for: new Date().toISOString(),
      attempts: 0,
      max_attempts: 3
    })
    .select()
    .single();
    
  if (jobError) {
    console.error('Failed to create SMS job:', jobError);
    return;
  }
  
  console.log(`\n✅ SMS job created: ${job.id}`);
  
  // Process it immediately
  console.log('\n🚀 Processing SMS job...');
  
  try {
    const { jobQueue } = await import('../src/lib/background-jobs.js');
    await jobQueue.processJobs(1);
    
    // Check result
    const { data: processedJob } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', job.id)
      .single();
      
    if (processedJob?.status === 'completed') {
      console.log('✅ SMS sent successfully!');
    } else if (processedJob?.status === 'failed') {
      console.error('❌ SMS failed:', processedJob.error_message);
    } else {
      console.log(`Job status: ${processedJob?.status}`);
    }
  } catch (err) {
    console.error('Error processing job:', err);
  }
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${minutes} ${ampm}`;
}

sendBookingSMSNow().catch(console.error);