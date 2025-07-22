import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyApiKey } from '@/lib/api-auth';
import { z } from 'zod';
import { queueCancellationSMS } from '@/app/actions/table-booking-sms';

// Validation schema
const CancelBookingSchema = z.object({
  customer_email: z.string().email(),
  reason: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ booking_reference: string }> }
) {
  const params = await props.params;
  
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
    const validatedData = CancelBookingSchema.parse(body);

    const supabase = await createClient();
    
    // Get booking with customer and payments
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_payments(*)
      `)
      .eq('booking_reference', params.booking_reference)
      .single();
      
    if (bookingError || !booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Verify customer email
    if (booking.customer?.email !== validatedData.customer_email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Check if already cancelled
    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Booking is already cancelled' },
        { status: 400 }
      );
    }

    // Check if booking has started
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`);
    if (bookingDateTime < new Date()) {
      return NextResponse.json(
        { error: 'Cannot cancel past bookings' },
        { status: 400 }
      );
    }

    // Calculate refund if payment exists
    let refundDetails = {
      eligible: false,
      amount: 0,
      processing_time: '3-5 business days',
    };

    if (booking.table_booking_payments?.length > 0) {
      const payment = booking.table_booking_payments.find((p: any) => p.status === 'completed');
      
      if (payment) {
        const { data: refundCalc } = await supabase.rpc('calculate_refund_amount', {
          p_booking_id: booking.id,
        });
        
        if (refundCalc?.[0]?.refund_amount > 0) {
          refundDetails = {
            eligible: true,
            amount: refundCalc[0].refund_amount,
            processing_time: '3-5 business days',
          };
          
          // Update payment record to indicate refund pending
          await supabase
            .from('table_booking_payments')
            .update({
              status: 'refunded',
              refund_amount: refundDetails.amount,
              refunded_at: new Date().toISOString(),
            })
            .eq('id', payment.id);
        }
      }
    }

    // Update booking status
    const { error: updateError } = await supabase
      .from('table_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: validatedData.reason,
      })
      .eq('id', booking.id);
      
    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to cancel booking' },
        { status: 500 }
      );
    }

    // Log audit event
    await supabase
      .from('audit_logs')
      .insert({
        action: 'cancel',
        entity_type: 'table_booking',
        entity_id: booking.id,
        metadata: {
          booking_reference: booking.booking_reference,
          reason: validatedData.reason,
          refund_amount: refundDetails.amount,
          source: 'customer_api',
        },
      });

    // Queue cancellation SMS
    if (booking.customer?.sms_opt_in) {
      const refundMessage = refundDetails.eligible 
        ? `A refund of £${refundDetails.amount.toFixed(2)} will be processed.`
        : 'No refund is due for this cancellation.';
        
      await queueCancellationSMS(booking.id, refundMessage);
    }

    return NextResponse.json({
      booking_id: booking.id,
      status: 'cancelled',
      refund_details: refundDetails,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    console.error('Cancel booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}