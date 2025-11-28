import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { queueBookingReminderSMS, queueBookingReviewRequestSMS } from '@/app/actions/table-booking-sms';
import { sendBookingReminderEmail } from '@/app/actions/table-booking-email';
import { addDays, startOfDay, endOfDay, subDays } from 'date-fns';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { authorizeCronRequest } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authResult = authorizeCronRequest(request);

    if (!authResult.authorized) {
      console.log('Unauthorized table booking reminder request', authResult.reason);
      return new NextResponse('Unauthorized', { status: 401 });
    }

    console.log('Starting table booking reminder and review check...');

    const supabase = await createAdminClient();
    
    // --- 1. REMINDERS ---
    
    // Get booking policy for reminder hours
    const { data: reminderPolicy } = await supabase
      .from('table_booking_policies')
      .select('policy_value')
      .eq('policy_name', 'reminder_hours')
      .single();
      
    const reminderHours = parseInt(reminderPolicy?.policy_value || '24');
    
    // Calculate the target time window for reminders
    const now = new Date();
    const reminderTime = addDays(now, 0);
    reminderTime.setHours(now.getHours() + reminderHours);
    
    // Find bookings that need reminders
    const { data: bookings, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*)
      `)
      .eq('status', 'confirmed')
      .eq('reminder_sent', false)
      .gte('booking_date', toLocalIsoDate(startOfDay(reminderTime)))
      .lte('booking_date', toLocalIsoDate(endOfDay(reminderTime)));
      
    if (error) {
      console.error('Error fetching bookings for reminders:', error);
    }
    
    let remindersSent = 0;
    let errors = 0;
    
    // Process each booking for reminders
    for (const booking of bookings || []) {
      // Check if booking time is within the reminder window
      const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`);
      const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilBooking > 0 && hoursUntilBooking <= reminderHours) {
        // Skip if customer has opted out
        if (!booking.customer?.sms_opt_in) {
          console.log(`Skipping reminder for booking ${booking.booking_reference} - customer opted out`);
          continue;
        }
        
        try {
          // Queue reminder SMS
          const smsResult = await queueBookingReminderSMS(booking.id, { requirePermission: false });
          
          // Send reminder email
          let emailSent = false;
          if (booking.customer?.email) {
            const emailResult = await sendBookingReminderEmail(booking.id);
            emailSent = emailResult.success || false;
          }
          
          if (smsResult.success || emailSent) {
            // Mark reminder as sent
            await supabase
              .from('table_bookings')
              .update({ reminder_sent: true })
              .eq('id', booking.id);
              
            remindersSent++;
            console.log(`Reminder sent for booking ${booking.booking_reference} (SMS: ${smsResult.success}, Email: ${emailSent})`);
          } else {
            errors++;
            console.error(`Failed to send reminder for booking ${booking.booking_reference}`);
          }
        } catch (err) {
          errors++;
          console.error(`Error processing booking ${booking.booking_reference}:`, err);
        }
      }
    }

    // --- 2. REVIEW REQUESTS ---
    
    console.log('Checking for review requests...');
    let reviewRequestsSent = 0;

    // Look for bookings from today and yesterday (to catch late night bookings)
    // that are confirmed or completed
    const reviewCheckStart = subDays(startOfDay(now), 1);
    const reviewCheckEnd = endOfDay(now);

    const { data: recentBookings, error: reviewError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*)
      `)
      .in('status', ['confirmed', 'completed'])
      .gte('booking_date', toLocalIsoDate(reviewCheckStart))
      .lte('booking_date', toLocalIsoDate(reviewCheckEnd));

    if (reviewError) {
      console.error('Error fetching bookings for reviews:', reviewError);
    } else {
      for (const booking of recentBookings || []) {
        const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`);
        const hoursSinceBooking = (now.getTime() - bookingDateTime.getTime()) / (1000 * 60 * 60);

        // Check if it's been at least 4 hours since the booking time
        if (hoursSinceBooking >= 4 && hoursSinceBooking < 28) { // 24h + 4h buffer to avoid re-sending too old ones
           if (!booking.customer?.sms_opt_in) continue;

           // Check if we already sent a review request
           // Using the jobs table as a log since we might not have a flag on the booking table
           const { data: existingJobs } = await supabase
             .from('jobs')
             .select('id')
             .eq('type', 'send_sms')
             .contains('payload', { 
               booking_id: booking.id,
               template: 'review_request'
             })
             .limit(1);

           if (!existingJobs || existingJobs.length === 0) {
             try {
               const result = await queueBookingReviewRequestSMS(booking.id, { requirePermission: false });
               if (result.success) {
                 reviewRequestsSent++;
                 console.log(`Review request queued for booking ${booking.booking_reference}`);
               } else {
                 console.error(`Failed to queue review request for ${booking.booking_reference}: ${result.error}`);
               }
             } catch (err) {
               console.error(`Error processing review request for ${booking.booking_reference}:`, err);
             }
           }
        }
      }
    }
    
    console.log(`Table booking check completed. Reminders: ${remindersSent}, Reviews: ${reviewRequestsSent}, Errors: ${errors}`);
    
    return new NextResponse(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
        review_requests_sent: reviewRequestsSent,
        errors: errors,
        total_bookings_checked: bookings?.length || 0,
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error processing table booking reminders:', error);
    return new NextResponse(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
}
