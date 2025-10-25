import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { queueBookingReminderSMS } from '@/app/actions/table-booking-sms';
import { sendBookingReminderEmail } from '@/app/actions/table-booking-email';
import { addDays, startOfDay, endOfDay } from 'date-fns';
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

    console.log('Starting table booking reminder check...');

    const supabase = await createAdminClient();
    
    // Get booking policy for reminder hours
    const { data: reminderPolicy } = await supabase
      .from('table_booking_policies')
      .select('policy_value')
      .eq('policy_name', 'reminder_hours')
      .single();
      
    const reminderHours = parseInt(reminderPolicy?.policy_value || '24');
    
    // Calculate the target time window
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
      console.error('Error fetching bookings:', error);
      return new NextResponse(`Error: ${error.message}`, { status: 500 });
    }
    
    let remindersSent = 0;
    let errors = 0;
    
    // Process each booking
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
    
    console.log(`Table booking reminder check completed. Sent: ${remindersSent}, Errors: ${errors}`);
    
    return new NextResponse(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
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
