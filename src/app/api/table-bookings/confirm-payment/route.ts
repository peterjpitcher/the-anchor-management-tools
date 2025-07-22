import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyApiKey } from '@/lib/api-auth';
import { z } from 'zod';
import { queueBookingConfirmationSMS } from '@/app/actions/table-booking-sms';

// Validation schema
const ConfirmPaymentSchema = z.object({
  booking_id: z.string().uuid(),
  payment_details: z.object({
    transaction_id: z.string(),
    payer_id: z.string(),
    payment_status: z.string(),
  }),
});

export async function POST(request: NextRequest) {
  try {
    // Verify API key
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401 }
      );
    }

    const { valid, error } = await verifyApiKey(apiKey, 'write:table_bookings');
    if (!valid) {
      return NextResponse.json(
        { error: error || 'Invalid API key' },
        { status: 401 }
      );
    }

    // Parse and validate body
    const body = await request.json();
    const validatedData = ConfirmPaymentSchema.parse(body);

    if (validatedData.payment_details.payment_status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Payment not completed' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    
    // Get booking with items
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*)
      `)
      .eq('id', validatedData.booking_id)
      .single();
      
    if (bookingError || !booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Check if already confirmed
    if (booking.status === 'confirmed') {
      return NextResponse.json(
        { error: 'Booking already confirmed' },
        { status: 400 }
      );
    }

    // Calculate total amount
    const totalAmount = booking.table_booking_items?.reduce(
      (sum: number, item: any) => sum + (item.price_at_booking * item.quantity), 
      0
    ) || 0;

    // Create payment record
    const { error: paymentError } = await supabase
      .from('table_booking_payments')
      .insert({
        booking_id: booking.id,
        payment_method: 'paypal',
        transaction_id: validatedData.payment_details.transaction_id,
        amount: totalAmount,
        currency: 'GBP',
        status: 'completed',
        payment_metadata: validatedData.payment_details,
        paid_at: new Date().toISOString(),
      });
      
    if (paymentError) {
      console.error('Payment record error:', paymentError);
      return NextResponse.json(
        { error: 'Failed to record payment' },
        { status: 500 }
      );
    }

    // Update booking status
    const { error: updateError } = await supabase
      .from('table_bookings')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', booking.id);
      
    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to confirm booking' },
        { status: 500 }
      );
    }

    // Log audit event
    await supabase
      .from('audit_logs')
      .insert({
        action: 'payment_confirmed',
        entity_type: 'table_booking',
        entity_id: booking.id,
        metadata: {
          booking_reference: booking.booking_reference,
          transaction_id: validatedData.payment_details.transaction_id,
          amount: totalAmount,
        },
      });

    // Queue confirmation SMS
    if (booking.customer?.sms_opt_in) {
      await queueBookingConfirmationSMS(booking.id);
    }

    // Send confirmation email
    await supabase.from('jobs').insert({
      type: 'send_email',
      payload: {
        to: booking.customer.email,
        template: 'table_booking_confirmation',
        data: {
          booking,
          payment_amount: totalAmount,
        },
      },
      scheduled_for: new Date().toISOString(),
    });

    return NextResponse.json({
      booking_id: booking.id,
      booking_reference: booking.booking_reference,
      status: 'confirmed',
      payment_confirmed: true,
      confirmation_sent: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    console.error('Confirm payment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}