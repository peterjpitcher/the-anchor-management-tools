import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { z } from 'zod';
import { queueBookingConfirmationSMS } from '@/app/actions/table-booking-sms';

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

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
  return withApiAuth(async (req, apiKey) => {
    try {
      // Parse and validate body
      const body = await req.json();
      const validatedData = ConfirmPaymentSchema.parse(body);

      if (validatedData.payment_details.payment_status !== 'COMPLETED') {
        return createErrorResponse(
          'Payment not completed',
          'INVALID_PAYMENT',
          400
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
        return createErrorResponse(
          'Booking not found',
          'NOT_FOUND',
          404
        );
      }

      // Check if already confirmed
      if (booking.status === 'confirmed') {
        return createErrorResponse(
          'Booking already confirmed',
          'INVALID_STATUS',
          400
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
        return createErrorResponse(
          'Failed to record payment',
          'DATABASE_ERROR',
          500
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
        return createErrorResponse(
          'Failed to confirm booking',
          'DATABASE_ERROR',
          500
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

      return createApiResponse({
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        status: 'confirmed',
        payment_confirmed: true,
        confirmation_sent: true,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return createErrorResponse(
          'Validation error',
          'VALIDATION_ERROR',
          400,
          error.errors
        );
      }
      
      console.error('Confirm payment API error:', error);
      return createErrorResponse(
        'Internal server error',
        'INTERNAL_ERROR',
        500
      );
    }
  }, ['write:table_bookings'], request);
}