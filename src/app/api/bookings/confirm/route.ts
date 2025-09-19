import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { formatPhoneForStorage } from '@/lib/validation';
import { scheduleAndProcessBookingReminders } from '@/app/actions/event-sms-scheduler';
import { logAuditEvent } from '@/app/actions/audit';

const confirmBookingSchema = z.object({
  token: z.string().uuid(),
  seats: z.number().min(1).max(10),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate input
    const validation = confirmBookingSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.errors[0].message },
        { status: 400 }
      );
    }

    const { token, seats, first_name, last_name } = validation.data;
    const supabase = createAdminClient();
    
    // Get pending booking with metadata
    const { data: pendingBooking, error: pendingError } = await supabase
      .from('pending_bookings')
      .select(`
        *,
        event:events(
          id,
          name,
          date,
          time,
          capacity,
          event_status
        )
      `)
      .eq('token', token)
      .single();

    if (pendingError || !pendingBooking) {
      return NextResponse.json(
        { error: 'Invalid booking token' },
        { status: 404 }
      );
    }

    // Check if already confirmed
    if (pendingBooking.confirmed_at) {
      return NextResponse.json(
        { error: 'This booking has already been confirmed' },
        { status: 400 }
      );
    }

    // Check if expired
    if (new Date(pendingBooking.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This booking link has expired' },
        { status: 400 }
      );
    }

    // Validate event status
    if (pendingBooking.event.event_status !== 'scheduled') {
      return NextResponse.json(
        { error: 'Event is no longer available for booking' },
        { status: 400 }
      );
    }

    // Check capacity
    const { count: currentBookings } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', pendingBooking.event_id);

    const availableSeats = (pendingBooking.event.capacity || 100) - (currentBookings || 0);
    
    if (availableSeats < seats) {
      return NextResponse.json(
        { error: `Only ${availableSeats} seats available` },
        { status: 400 }
      );
    }

    // Start transaction-like operations
    let customerId = pendingBooking.customer_id;
    
    // Record the initial SMS for existing customers if not already recorded
    if (customerId && pendingBooking.metadata?.initial_sms) {
      const smsData = pendingBooking.metadata.initial_sms;
      
      // Check if this SMS was already recorded
      const { data: existingMessage } = await supabase
        .from('messages')
        .select('id')
        .eq('message_sid', smsData.message_sid)
        .single();
      
      if (!existingMessage) {
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            customer_id: customerId,
            direction: 'outbound',
            message_sid: smsData.message_sid,
            twilio_message_sid: smsData.message_sid,
            body: smsData.body,
            status: 'delivered',
            twilio_status: 'delivered',
            from_number: smsData.from_number,
            to_number: smsData.to_number,
            message_type: 'sms',
            segments: smsData.segments,
            cost_usd: smsData.cost_usd,
            created_at: smsData.sent_at,
            read_at: new Date().toISOString(),
          });

        if (messageError) {
          console.error('Failed to record initial SMS message for existing customer:', messageError);
        }
      }
    }
    
    // Create customer if needed
    if (!customerId && first_name && last_name) {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          first_name,
          last_name,
          mobile_number: pendingBooking.mobile_number,
          sms_opt_in: true, // They confirmed via SMS
        })
        .select('id')
        .single();

      if (customerError) {
        console.error('Failed to create customer:', customerError);
        return NextResponse.json(
          { error: 'Failed to create customer record' },
          { status: 500 }
        );
      }

      customerId = newCustomer.id;

      // Record the initial SMS that was sent during booking initiation
      if (pendingBooking.metadata?.initial_sms) {
        const smsData = pendingBooking.metadata.initial_sms;
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            customer_id: customerId,
            direction: 'outbound',
            message_sid: smsData.message_sid,
            twilio_message_sid: smsData.message_sid,
            body: smsData.body,
            status: 'delivered', // Assume delivered since they clicked the link
            twilio_status: 'delivered',
            from_number: smsData.from_number,
            to_number: smsData.to_number,
            message_type: 'sms',
            segments: smsData.segments,
            cost_usd: smsData.cost_usd,
            created_at: smsData.sent_at,
            read_at: new Date().toISOString(), // Mark as read since it's outbound
          });

        if (messageError) {
          console.error('Failed to record initial SMS message:', messageError);
          // Don't fail the booking if we can't record the message
        }
      }
    }

    if (!customerId) {
      return NextResponse.json(
        { error: 'Customer information required' },
        { status: 400 }
      );
    }

    // Check if customer already has a booking for this event
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('customer_id', customerId)
      .eq('event_id', pendingBooking.event_id)
      .single();

    let booking;
    
    if (existingBooking) {
      // Update existing booking with new seat count
      const { data: updatedBooking, error: updateError } = await supabase
        .from('bookings')
        .update({
          seats,
          notes: 'Booking updated via SMS link',
        })
        .eq('id', existingBooking.id)
        .select('id')
        .single();

      if (updateError) {
        console.error('Failed to update booking:', updateError);
        return NextResponse.json(
          { error: 'Failed to update booking. Please try again or contact support.' },
          { status: 500 }
        );
      }
      
      booking = updatedBooking;
    } else {
      // Create new booking
      const { data: newBooking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          event_id: pendingBooking.event_id,
          customer_id: customerId,
          seats,
          notes: 'Booking confirmed via SMS link',
        })
        .select('id')
        .single();

      if (bookingError) {
        console.error('Failed to create booking:', bookingError);
        return NextResponse.json(
          { error: 'Failed to create booking. Please try again or contact support.' },
          { status: 500 }
        );
      }
      
      booking = newBooking;
    }

    // Update pending booking as confirmed
    const { error: updateError } = await supabase
      .from('pending_bookings')
      .update({
        confirmed_at: new Date().toISOString(),
        booking_id: booking.id,
        seats,
        customer_id: customerId,
      })
      .eq('token', token);

    if (updateError) {
      console.error('Failed to update pending booking:', updateError);
    }

    // Send confirmation SMS
    try {
      await scheduleAndProcessBookingReminders(booking.id);
    } catch (smsError) {
      console.error('Failed to send confirmation SMS:', smsError);
      // Don't fail the request if SMS fails
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: {
        method: 'sms_confirmation',
        event_id: pendingBooking.event_id,
        customer_id: customerId,
        seats,
      },
    });

    // Generate confirmation number
    const confirmationNumber = `ANH-${new Date().getFullYear()}-${booking.id.slice(0, 8).toUpperCase()}`;

    return NextResponse.json({
      success: true,
      booking_id: booking.id,
      confirmation_number: confirmationNumber,
      event: {
        name: pendingBooking.event.name,
        date: pendingBooking.event.date,
        time: pendingBooking.event.time,
      },
      seats,
    });
  } catch (error) {
    console.error('Error confirming booking:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { status: 200 });
}
