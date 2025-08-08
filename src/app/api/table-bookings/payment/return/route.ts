import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { capturePayPalPayment } from '@/lib/paypal';
import { queueBookingConfirmationSMS } from '@/app/actions/table-booking-sms';
import { sendBookingConfirmationEmail } from '@/app/actions/table-booking-email';
import { sendManagerOrderNotification } from '@/app/actions/table-booking-manager-email';

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
      
      // Queue confirmation SMS
      if (booking.customer?.sms_opt_in) {
        await queueBookingConfirmationSMS(bookingId);
      }
      
      // Send confirmation email
      if (booking.customer?.email) {
        await sendBookingConfirmationEmail(bookingId);
      }
      
      // Send manager notification email
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