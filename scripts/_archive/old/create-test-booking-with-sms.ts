#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

// Helper function to format time
function formatTime12Hour(time24: string): string {
  const timeWithoutSeconds = time24.split(':').slice(0, 2).join(':');
  const [hours, minutes] = timeWithoutSeconds.split(':').map(Number);
  
  const period = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  
  if (minutes === 0) {
    return `${hours12}${period}`;
  } else {
    return `${hours12}:${minutes.toString().padStart(2, '0')}${period}`;
  }
}

async function createTestBookingWithSMS() {
  // Create admin client with service role key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  
  console.log('=== Creating Test Booking with SMS ===\n');
  
  try {
    // Get a test customer
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('sms_opt_in', true)
      .not('mobile_number', 'is', null)
      .limit(1)
      .single();
    
    if (!customer) {
      console.log('No suitable customer found');
      return;
    }
    
    console.log(`Using customer: ${customer.first_name} ${customer.last_name}`);
    console.log(`Phone: ${customer.mobile_number}`);
    
    // Create a test booking for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const bookingDate = tomorrow.toISOString().split('T')[0];
    
    console.log('\nCreating booking...');
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .insert({
        customer_id: customer.id,
        booking_date: bookingDate,
        booking_time: '19:00:00',
        party_size: 2,
        booking_type: 'regular',
        status: 'confirmed',
        source: 'test_script',
        special_requirements: 'Test booking created by script'
      })
      .select()
      .single();
    
    if (bookingError) {
      console.error('Failed to create booking:', bookingError);
      return;
    }
    
    console.log('✅ Booking created successfully!');
    console.log(`Booking ID: ${booking.id}`);
    console.log(`Reference: ${booking.booking_reference}`);
    
    // Now try to create the SMS job directly
    console.log('\nCreating SMS job...');
    
    // Get the template
    const templateKey = 'booking_confirmation_regular';
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
    
    if (!template) {
      console.log('❌ Template not found');
      return;
    }
    
    // Prepare variables
    const variables = {
      customer_name: customer.first_name,
      party_size: booking.party_size.toString(),
      date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      time: formatTime12Hour(booking.booking_time),
      reference: booking.booking_reference,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
    };
    
    // Create SMS job
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: customer.mobile_number,
          template: templateKey,
          variables,
          booking_id: booking.id,
          customer_id: customer.id,
        },
        scheduled_for: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (jobError) {
      console.error('❌ Failed to create SMS job:', jobError);
      return;
    }
    
    console.log('✅ SMS job created successfully!');
    console.log(`Job ID: ${job.id}`);
    
    // Check if any jobs exist for this booking
    console.log('\nVerifying jobs for this booking...');
    const { data: allJobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .filter('payload->booking_id', 'eq', booking.id);
    
    console.log(`Found ${allJobs?.length || 0} SMS jobs for this booking`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the test
createTestBookingWithSMS();