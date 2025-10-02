import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { capturePayPalPayment } from '@/lib/paypal';
import { sendBookingConfirmationEmail } from '@/app/actions/table-booking-email';
import { sendManagerOrderNotification } from '@/app/actions/table-booking-manager-email';
import { ensureReplyInstruction } from '@/lib/sms/support';

export async function GET(request: NextRequest) {
  console.log('[Payment Journey] PayPal return handler called');
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const bookingId = searchParams.get('booking_id');
    const paypalToken = searchParams.get('token');
    const payerId = searchParams.get('PayerID');
    
    console.log('[Payment Journey] Return parameters:', {
      bookingId,
      token: paypalToken?.substring(0, 10) + '...',
      payerId
    });
    
    if (!bookingId || !paypalToken || !payerId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${bookingId}/payment?error=missing_parameters`
      );
    }
    
    const supabase = createAdminClient();
    
    // Get booking
    console.log('[Payment Journey] Fetching booking with ID:', bookingId);
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (bookingError || !booking) {
      console.error('[Payment Journey] Booking fetch failed:', {
        bookingId,
        error: bookingError,
        message: bookingError?.message,
        code: bookingError?.code,
        details: bookingError?.details
      });
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/table-bookings?error=booking_not_found&booking_id=${bookingId}`
      );
    }
    
    console.log('[Payment Journey] Booking found:', {
      reference: booking.booking_reference,
      status: booking.status
    });
    
    // Get payment record
    const { data: payment } = await supabase
      .from('table_booking_payments')
      .select('*')
      .eq('booking_id', bookingId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
      
    if (!payment) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${booking.booking_reference}/payment?error=payment_not_found`
      );
    }
    
    try {
      // Capture payment
      console.log('[Payment Journey] Capturing PayPal payment...');
      const captureResult = await capturePayPalPayment(paypalToken);
      console.log('[Payment Journey] Payment captured successfully:', captureResult.transactionId);
      
      // Update payment record
      await supabase
        .from('table_booking_payments')
        .update({
          status: 'completed',
          transaction_id: captureResult.transactionId,
          payment_metadata: {
            ...payment.payment_metadata,
            payer_id: captureResult.payerId,
            capture_id: captureResult.transactionId,
          },
          paid_at: new Date().toISOString(),
        })
        .eq('id', payment.id);
      
      // Update booking status
      await supabase
        .from('table_bookings')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', bookingId);
      
      // Log audit event
      await supabase
        .from('audit_logs')
        .insert({
          action: 'payment_confirmed',
          entity_type: 'table_booking',
          entity_id: bookingId,
          metadata: {
            booking_reference: booking.booking_reference,
            transaction_id: captureResult.transactionId,
            amount: payment.amount,
            source: 'paypal_return',
          },
        });
      
      // Send confirmation SMS immediately (we're in unauthenticated context)
      if (booking.customer?.sms_opt_in && booking.customer?.mobile_number) {
        try {
          // Get appropriate template
          const templateKey = booking.booking_type === 'sunday_lunch'
            ? 'booking_confirmation_sunday_lunch'
            : 'booking_confirmation_regular';
            
          const { data: template } = await supabase
            .from('table_booking_sms_templates')
            .select('*')
            .eq('template_key', templateKey)
            .eq('is_active', true)
            .single();
            
          if (template) {
            // Format time for SMS
            const formatTime12Hour = (time24: string): string => {
              const [hours, minutes] = time24.split(':').slice(0, 2).map(Number);
              const period = hours >= 12 ? 'pm' : 'am';
              const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
              return minutes === 0 ? `${hours12}${period}` : `${hours12}:${minutes.toString().padStart(2, '0')}${period}`;
            };
            
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
            
            // Add deposit information for Sunday lunch
            if (booking.booking_type === 'sunday_lunch' && payment) {
              const depositAmount = payment.payment_metadata?.deposit_amount || payment.amount;
              const totalAmount = payment.payment_metadata?.total_amount || 0;
              const outstandingAmount = payment.payment_metadata?.outstanding_amount || (totalAmount - depositAmount);
              
              variables.deposit_amount = depositAmount.toFixed(2);
              variables.outstanding_amount = outstandingAmount.toFixed(2);
            }
            
            // Build message from template
            let messageText = template.template_text;
            Object.entries(variables).forEach(([key, value]) => {
              messageText = messageText.replace(new RegExp(`{{${key}}}`, 'g'), value);
            });
            
            // Send SMS immediately
            const { sendSMS } = await import('@/lib/twilio');
            const messageWithSupport = ensureReplyInstruction(
              messageText,
              process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
            );
            const smsResult = await sendSMS(booking.customer.mobile_number, messageWithSupport);
            
            if (smsResult.success && smsResult.sid) {
              console.log('[Payment Journey] SMS confirmation sent immediately:', smsResult.sid);
              
              // Log message in database
              await supabase
                .from('messages')
                .insert({
                  customer_id: booking.customer.id,
                  direction: 'outbound',
                  message_sid: smsResult.sid,
                  twilio_message_sid: smsResult.sid,
                  body: messageWithSupport,
                  status: 'sent',
                  twilio_status: 'queued',
                  from_number: process.env.TWILIO_PHONE_NUMBER,
                  to_number: booking.customer.mobile_number,
                  message_type: 'sms',
                  metadata: { 
                    booking_id: bookingId, 
                    template_key: templateKey,
                    source: 'payment_confirmation'
                  }
                });
            } else {
              console.error('[Payment Journey] Failed to send SMS confirmation:', smsResult.error);
            }
          } else {
            console.error('[Payment Journey] SMS template not found:', templateKey);
          }
        } catch (smsError) {
          // Log error but don't block the redirect
          console.error('[Payment Journey] SMS error (non-blocking):', smsError);
        }
      }
      
      // Send confirmation email (keep existing functionality)
      if (booking.customer?.email) {
        try {
          await sendBookingConfirmationEmail(bookingId, true);
        } catch (emailError) {
          // Log error but don't block the redirect
          console.error('[Payment Journey] Email error (non-blocking):', emailError);
        }
      }
      
      // Send manager notification email (check if this needs admin client too)
      await sendManagerOrderNotification(bookingId);
      
      // Redirect to success page
      console.log('[Payment Journey] Payment completed successfully, redirecting to success page');
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/success?reference=${booking.booking_reference}`
      );
    } catch (captureError) {
      console.error('PayPal capture error:', captureError);
      
      // Update payment as failed
      await supabase
        .from('table_booking_payments')
        .update({
          status: 'failed',
          payment_metadata: {
            ...payment.payment_metadata,
            error: 'capture_failed',
          },
        })
        .eq('id', payment.id);
      
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${booking.booking_reference}/payment?error=payment_failed&message=${encodeURIComponent('Payment could not be processed. Please try again.')}`
      );
    }
  } catch (error) {
    console.error('Payment return error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/table-bookings?error=internal_error&message=${encodeURIComponent('An error occurred processing your payment.')}`
    );
  }
}
