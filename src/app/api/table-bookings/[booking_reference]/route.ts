import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyApiKey } from '@/lib/api-auth';
import { z } from 'zod';

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
  
  try {
    // Verify API key
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401 }
      );
    }

    const { valid, error } = await verifyApiKey(apiKey, 'read:table_bookings');
    if (!valid) {
      return NextResponse.json(
        { error: error || 'Invalid API key' },
        { status: 401 }
      );
    }

    // Verify customer email
    const customerEmail = request.headers.get('x-customer-email');
    if (!customerEmail) {
      return NextResponse.json(
        { error: 'Customer email required for verification' },
        { status: 401 }
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
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Verify customer email matches
    if (booking.customer?.email !== customerEmail) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
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

    return NextResponse.json(response);
  } catch (error) {
    console.error('Get booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// UPDATE booking
export async function PUT(
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

    // Check if booking can be modified
    if (booking.status !== 'confirmed' && booking.status !== 'pending_payment') {
      return NextResponse.json(
        { error: 'Booking cannot be modified' },
        { status: 400 }
      );
    }

    // Check policy
    const { data: policy } = await supabase
      .from('booking_policies')
      .select('*')
      .eq('booking_type', booking.booking_type)
      .single();
      
    if (!policy?.modification_allowed) {
      return NextResponse.json(
        { error: 'Modifications not allowed for this booking type' },
        { status: 400 }
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
        return NextResponse.json(
          { error: 'No availability for the requested changes' },
          { status: 400 }
        );
      }
    }

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('table_bookings')
      .update({
        ...validatedData.updates,
        modification_badge: booking.modification_count + 1,
      })
      .eq('id', booking.id)
      .select()
      .single();
      
    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update booking' },
        { status: 500 }
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

    return NextResponse.json({
      booking: {
        reference: updatedBooking.booking_reference,
        status: updatedBooking.status,
        updates_applied: true,
        payment_adjustment: paymentAdjustment,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    console.error('Update booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}