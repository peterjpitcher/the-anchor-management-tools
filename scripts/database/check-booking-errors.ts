import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBookingErrors() {
  console.log('🔍 Checking booking TB-2025-7271 in detail\n');
  
  // Find the booking
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select(`
      *,
      customers!table_bookings_customer_id_fkey (*)
    `)
    .eq('booking_reference', 'TB-2025-7271')
    .single();
    
  if (error || !booking) {
    console.error('Could not find booking:', error);
    return;
  }
  
  console.log('📝 Booking Details:');
  console.log(`  ID: ${booking.id}`);
  console.log(`  Status: ${booking.status}`);
  console.log(`  Type: ${booking.booking_type}`);
  console.log(`  Created: ${booking.created_at}`);
  console.log(`  Customer ID: ${booking.customer_id}`);
  console.log(`  Customer Name: ${booking.customers?.first_name} ${booking.customers?.last_name}`);
  console.log(`  Phone: ${booking.customers?.mobile_number}`);
  console.log(`  SMS Opt-in: ${booking.customers?.sms_opt_in}`);
  
  // Check audit logs for this booking
  console.log('\n📋 Audit Logs:');
  const { data: auditLogs } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('resource_id', booking.id)
    .eq('resource_type', 'table_booking')
    .order('created_at', { ascending: false });
    
  if (auditLogs?.length) {
    auditLogs.forEach(log => {
      console.log(`  - ${log.operation_type} at ${new Date(log.created_at).toLocaleTimeString()}`);
      if (log.additional_info) {
        console.log(`    Info: ${JSON.stringify(log.additional_info)}`);
      }
    });
  } else {
    console.log('  No audit logs found');
  }
  
  // Check if there's any job with this booking ID
  console.log('\n🔍 Searching for any jobs with this booking:');
  const { data: allJobs } = await supabase
    .from('jobs')
    .select('*')
    .or(`payload.cs.booking_id.${booking.id},payload.cs.bookingId.${booking.id}`)
    .order('created_at', { ascending: false });
    
  if (allJobs?.length) {
    console.log(`Found ${allJobs.length} related jobs`);
    allJobs.forEach(job => {
      console.log(`  - Job ${job.id.substring(0, 8)}... Type: ${job.type}, Status: ${job.status}`);
    });
  } else {
    console.log('  No jobs found with this booking ID');
  }
  
  // Try to manually create an SMS job for this booking
  console.log('\n🔧 Attempting to manually queue SMS for this booking...');
  
  // Import the function and try to queue
  try {
    const module = await import('../src/app/actions/table-booking-sms.js');
    const result = await module.queueBookingConfirmationSMS(booking.id);
    console.log('Result:', result);
  } catch (err) {
    console.error('Error importing/running queueBookingConfirmationSMS:', err);
  }
}