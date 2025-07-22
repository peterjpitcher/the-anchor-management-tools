'use server';

import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/emailService';
import { 
  generateBookingConfirmationEmail, 
  generateBookingCancellationEmail,
  generateBookingReminderEmail 
} from '@/lib/email/templates/table-booking-confirmation';
import { logAuditEvent } from './audit';

// Send booking confirmation email
export async function sendBookingConfirmationEmail(bookingId: string) {
  try {
    const supabase = await createClient();
    
    // Get booking with customer and items
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(amount, status)
      `)
      .eq('id', bookingId)
      .single();
      
    if (error || !booking) {
      console.error('Booking not found:', error);
      return { error: 'Booking not found' };
    }
    
    if (!booking.customer?.email) {
      return { message: 'Customer has no email address' };
    }
    
    // Get payment amount if any
    const payment = booking.table_booking_payments?.find((p: any) => p.status === 'completed');
    const paymentAmount = payment?.amount;
    
    // Generate email content
    const { subject, html } = generateBookingConfirmationEmail({
      booking,
      payment_amount: paymentAmount
    });
    
    // Send email
    const result = await sendEmail({
      to: booking.customer.email,
      subject,
      html,
      cc: process.env.BOOKING_CC_EMAIL ? [process.env.BOOKING_CC_EMAIL] : undefined
    });
    
    if (result.success) {
      // Log email sent
      await logAuditEvent({
        operation_type: 'email_sent',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          email_type: 'confirmation',
          recipient: booking.customer.email,
          booking_reference: booking.booking_reference
        }
      });
      
      return { success: true };
    } else {
      console.error('Failed to send email:', result.error);
      return { error: result.error || 'Failed to send email' };
    }
  } catch (error) {
    console.error('Send confirmation email error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Send booking cancellation email
export async function sendBookingCancellationEmail(
  bookingId: string,
  refundMessage: string
) {
  try {
    const supabase = await createClient();
    
    // Get booking with customer
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (error || !booking) {
      console.error('Booking not found:', error);
      return { error: 'Booking not found' };
    }
    
    if (!booking.customer?.email) {
      return { message: 'Customer has no email address' };
    }
    
    // Generate email content
    const { subject, html } = generateBookingCancellationEmail(booking, refundMessage);
    
    // Send email
    const result = await sendEmail({
      to: booking.customer.email,
      subject,
      html,
      cc: process.env.BOOKING_CC_EMAIL ? [process.env.BOOKING_CC_EMAIL] : undefined
    });
    
    if (result.success) {
      // Log email sent
      await logAuditEvent({
        operation_type: 'email_sent',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          email_type: 'cancellation',
          recipient: booking.customer.email,
          booking_reference: booking.booking_reference
        }
      });
      
      return { success: true };
    } else {
      console.error('Failed to send email:', result.error);
      return { error: result.error || 'Failed to send email' };
    }
  } catch (error) {
    console.error('Send cancellation email error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Send booking reminder email
export async function sendBookingReminderEmail(bookingId: string) {
  try {
    const supabase = await createClient();
    
    // Get booking with customer and items
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (error || !booking) {
      console.error('Booking not found:', error);
      return { error: 'Booking not found' };
    }
    
    if (!booking.customer?.email) {
      return { message: 'Customer has no email address' };
    }
    
    // Generate email content
    const { subject, html } = generateBookingReminderEmail({ booking });
    
    // Send email
    const result = await sendEmail({
      to: booking.customer.email,
      subject,
      html
    });
    
    if (result.success) {
      // Log email sent
      await logAuditEvent({
        operation_type: 'email_sent',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          email_type: 'reminder',
          recipient: booking.customer.email,
          booking_reference: booking.booking_reference
        }
      });
      
      // Mark email reminder as sent
      await supabase
        .from('table_bookings')
        .update({ email_reminder_sent: true })
        .eq('id', bookingId);
      
      return { success: true };
    } else {
      console.error('Failed to send email:', result.error);
      return { error: result.error || 'Failed to send email' };
    }
  } catch (error) {
    console.error('Send reminder email error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Queue all booking emails (for use in jobs system)
export async function processBookingEmailQueue() {
  try {
    const supabase = await createClient();
    
    // Get pending email jobs for table bookings
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_email')
      .eq('status', 'pending')
      .like('payload->template', 'table_booking%')
      .order('created_at')
      .limit(10);
      
    if (error) {
      console.error('Failed to fetch email jobs:', error);
      return { error: 'Failed to fetch email queue' };
    }
    
    let processed = 0;
    let errors = 0;
    
    for (const job of jobs || []) {
      try {
        const payload = job.payload as any;
        let result;
        
        // Process based on template type
        switch (payload.template) {
          case 'table_booking_confirmation':
          case 'table_booking_confirmation_sunday_lunch':
            result = await sendBookingConfirmationEmail(payload.booking_id);
            break;
            
          case 'table_booking_cancellation':
            result = await sendBookingCancellationEmail(
              payload.booking_id,
              payload.refund_message || 'No payment was taken for this booking.'
            );
            break;
            
          case 'table_booking_reminder':
            result = await sendBookingReminderEmail(payload.booking_id);
            break;
            
          default:
            console.error('Unknown template:', payload.template);
            result = { error: 'Unknown email template' };
        }
        
        // Update job status
        if (result.success || result.message) {
          await supabase
            .from('jobs')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              result: result
            })
            .eq('id', job.id);
          processed++;
        } else {
          await supabase
            .from('jobs')
            .update({
              status: 'failed',
              error: result.error,
              attempts: (job.attempts || 0) + 1
            })
            .eq('id', job.id);
          errors++;
        }
      } catch (err) {
        console.error('Error processing job:', job.id, err);
        errors++;
        
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            error: 'Processing error',
            attempts: (job.attempts || 0) + 1
          })
          .eq('id', job.id);
      }
    }
    
    return {
      success: true,
      processed,
      errors,
      total: jobs?.length || 0
    };
  } catch (error) {
    console.error('Process email queue error:', error);
    return { error: 'An unexpected error occurred' };
  }
}