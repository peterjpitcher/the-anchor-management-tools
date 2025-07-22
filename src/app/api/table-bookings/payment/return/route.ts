import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { capturePayPalPayment } from '@/lib/paypal';
import { queueBookingConfirmationSMS } from '@/app/actions/table-booking-sms';
import { sendBookingConfirmationEmail } from '@/app/actions/table-booking-email';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const bookingId = searchParams.get('booking_id');
    const paypalToken = searchParams.get('token');
    const payerId = searchParams.get('PayerID');
    
    if (!bookingId || !paypalToken || !payerId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/booking-error?error=missing_parameters`
      );
    }
    
    const supabase = await createClient();
    
    // Get booking
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
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/booking-error?error=booking_not_found`
      );
    }
    
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
        `${process.env.NEXT_PUBLIC_APP_URL}/booking-error?error=payment_not_found`
      );
    }
    
    try {
      // Capture payment
      const captureResult = await capturePayPalPayment(paypalToken);
      
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
      
      // Redirect to success page
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/booking-success?reference=${booking.booking_reference}`
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
        `${process.env.NEXT_PUBLIC_APP_URL}/booking-error?error=payment_failed`
      );
    }
  } catch (error) {
    console.error('Payment return error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/booking-error?error=internal_error`
    );
  }
}