import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { withIncrementedModificationCount } from '@/lib/table-bookings/modification';
import { z } from 'zod';

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Customer-Email',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Update schema
const UpdateBookingSchema = z.object({
  customer_email: z.string().email(),
  updates: z.object({
    party_size: z.number().min(1).max(20).optional(),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    special_requirements: z.string().optional(),
  }),
});

// GET booking details
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ booking_reference: string }> }
) {
  const params = await props.params;
  
  return withApiAuth(async (req, apiKey) => {
    try {
      // Verify customer email
      const customerEmail = request.headers.get('x-customer-email');
      if (!customerEmail) {
        return createErrorResponse(
          'Customer email required for verification',
          'UNAUTHORIZED',
          401
        );
      }

      const supabase = await createClient();
      
      // Get booking with customer
      const { data: booking, error: bookingError } = await supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(*),
          table_booking_items(*),
          table_booking_payments(*)
        `)
        .eq('booking_reference', params.booking_reference)
        .single();
        
      if (bookingError || !booking) {
        return createErrorResponse(
          'Booking not found',
          'NOT_FOUND',
          404
        );
      }

      // Verify customer email matches
      if (booking.customer?.email !== customerEmail) {
        return createErrorResponse(
          'Unauthorized',
          'FORBIDDEN',
          403
        );
      }

      // Calculate cancellation policy
      const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`);
      const hoursUntilBooking = (bookingDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      
      // Get policy
      const { data: policy } = await supabase
        .from('booking_policies')
        .select('*')
        .eq('booking_type', booking.booking_type)
        .single();
        
      let cancellationPolicy;
      if (policy) {
        const fullRefundUntil = new Date(bookingDateTime);
        fullRefundUntil.setHours(fullRefundUntil.getHours() - policy.full_refund_hours);
        
        const partialRefundUntil = new Date(bookingDateTime);
        partialRefundUntil.setHours(partialRefundUntil.getHours() - policy.partial_refund_hours);
        
        cancellationPolicy = {
          full_refund_until: fullRefundUntil.toISOString(),
          partial_refund_until: partialRefundUntil.toISOString(),
          refund_percentage: policy.partial_refund_percentage,
        };
      }

      // Prepare response
      const response = {
        booking: {
          id: booking.id,
          reference: booking.booking_reference,
          status: booking.status,
          date: booking.booking_date,
          time: booking.booking_time,
          party_size: booking.party_size,
          customer_name: `${booking.customer.first_name} ${booking.customer.last_name}`,
          special_requirements: booking.special_requirements,
          dietary_requirements: booking.dietary_requirements,
          allergies: booking.allergies,
          menu_selections: booking.table_booking_items,
          payment_status: booking.table_booking_payments?.[0]?.status || 'none',
          can_cancel: booking.status === 'confirmed' && hoursUntilBooking > 0,
          cancellation_policy: cancellationPolicy,
        },
      };

      return createApiResponse(response);
    } catch (error) {
      console.error('Get booking API error:', error);
      return createErrorResponse(
        'Internal server error',
        'INTERNAL_ERROR',
        500
      );
    }
  }, ['read:table_bookings'], request);
}

// UPDATE booking
export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ booking_reference: string }> }
) {
  const params = await props.params;
  
  return withApiAuth(async (req, apiKey) => {
    try {
      // Parse and validate body
      const body = await req.json();
      const validatedData = UpdateBookingSchema.parse(body);

      const supabase = await createClient();
      
      // Get booking with customer
      const { data: booking, error: bookingError } = await supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(*)
        `)
        .eq('booking_reference', params.booking_reference)
        .single();
        
      if (bookingError || !booking) {
        return createErrorResponse(
          'Booking not found',
          'NOT_FOUND',
          404
        );
      }

      // Verify customer email
      if (booking.customer?.email !== validatedData.customer_email) {
        return createErrorResponse(
          'Unauthorized',
          'FORBIDDEN',
          403
        );
      }

      // Check if booking can be modified
      if (booking.status !== 'confirmed' && booking.status !== 'pending_payment') {
        return createErrorResponse(
          'Booking cannot be modified',
          'INVALID_STATUS',
          400
        );
      }

    // Check policy
    const { data: policy } = await supabase
      .from('booking_policies')
      .select('*')
      .eq('booking_type', booking.booking_type)
      .single();
      
    if (!policy?.modification_allowed) {
      return createErrorResponse(
        'Modifications not allowed for this booking type',
        'MODIFICATION_NOT_ALLOWED',
        400
      );
    }

    // Check availability if changing party size or time
    if (validatedData.updates.party_size || validatedData.updates.time) {
      const { data: availabilityCheck } = await supabase.rpc('check_table_availability', {
        p_date: booking.booking_date,
        p_time: validatedData.updates.time || booking.booking_time,
        p_party_size: validatedData.updates.party_size || booking.party_size,
        p_exclude_booking_id: booking.id,
      });
      
      if (!availabilityCheck?.[0]?.is_available) {
        return createErrorResponse(
          'No availability for the requested changes',
          'NO_AVAILABILITY',
          400
        );
      }
    }

    // Update booking
    const updatePayload = withIncrementedModificationCount(
      {
        ...validatedData.updates,
      },
      (booking as { modification_count?: number }).modification_count,
    );

    const { data: updatedBooking, error: updateError } = await supabase
      .from('table_bookings')
      .update(updatePayload)
      .eq('id', booking.id)
      .select()
      .single();
      
    if (updateError) {
      return createErrorResponse(
        'Failed to update booking',
        'DATABASE_ERROR',
        500
      );
    }

    // Log modification
    await supabase
      .from('table_booking_modifications')
      .insert({
        booking_id: booking.id,
        modification_type: 'customer_update',
        old_values: {
          party_size: booking.party_size,
          time: booking.booking_time,
          special_requirements: booking.special_requirements,
        },
        new_values: validatedData.updates,
      });

    // Calculate payment adjustment if Sunday lunch
    let paymentAdjustment;
    if (booking.booking_type === 'sunday_lunch' && validatedData.updates.party_size) {
      // This would need more complex logic to recalculate based on menu selections
      paymentAdjustment = {
        required: true,
        additional_amount: 0, // Placeholder
        payment_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/table-bookings/payment/adjust?booking_id=${booking.id}`,
      };
    }

    return createApiResponse({
      booking: {
        reference: updatedBooking.booking_reference,
        status: updatedBooking.status,
        updates_applied: true,
        payment_adjustment: paymentAdjustment,
      },
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
    
    console.error('Update booking API error:', error);
    return createErrorResponse(
      'Internal server error',
      'INTERNAL_ERROR',
      500
    );
  }
  }, ['write:table_bookings'], request);
}
