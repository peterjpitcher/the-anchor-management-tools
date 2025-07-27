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

async function testTableBookingSMS() {
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
  
  console.log('=== Testing Table Booking SMS ===\n');
  
  try {
    // Get the most recent confirmed table booking with customer
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(*)
      `)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (bookingError) {
      console.error('Error fetching booking:', bookingError);
      return;
    }
    
    if (!booking) {
      console.log('No confirmed bookings found.');
      return;
    }
    
    console.log(`Testing SMS for booking: ${booking.booking_reference}`);
    console.log(`Booking ID: ${booking.id}`);
    console.log(`Created: ${booking.created_at}`);
    console.log(`Type: ${booking.booking_type || 'regular'}`);
    console.log(`Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
    console.log(`Phone: ${booking.customer?.mobile_number}`);
    console.log(`SMS Opt-in: ${booking.customer?.sms_opt_in}`);
    
    if (!booking.customer?.sms_opt_in) {
      console.log('\n❌ Customer has opted out of SMS');
      return;
    }
    
    // Get appropriate template
    const templateKey = booking.booking_type === 'sunday_lunch'
      ? 'booking_confirmation_sunday_lunch'
      : 'booking_confirmation_regular';
    
    console.log(`\nLooking for template: ${templateKey}`);
    
    const { data: template, error: templateError } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
    
    if (templateError) {
      console.error('Template error:', templateError);
      return;
    }
    
    if (!template) {
      console.log('❌ SMS template not found');
      return;
    }
    
    console.log('✅ Template found:', template.template_key);
    console.log('Template text:', template.template_text);
    
    // Prepare variables
    const variables: Record<string, string> = {
      customer_name: booking.customer.first_name,
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
    
    console.log('\nVariables:', variables);
    
    // Try to queue SMS
    console.log('\nAttempting to create SMS job...');
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: booking.customer.mobile_number,
          template: templateKey,
          variables,
          booking_id: booking.id,
          customer_id: booking.customer.id,
        },
        scheduled_for: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (jobError) {
      console.error('❌ Failed to create job:', jobError);
      return;
    }
    
    console.log('✅ SMS job created successfully!');
    console.log('Job ID:', job.id);
    console.log('Job details:', JSON.stringify(job, null, 2));
    
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the test
testTableBookingSMS();