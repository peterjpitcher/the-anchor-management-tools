import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { z } from 'zod';
import { ukPhoneRegex } from '@/lib/validation';
import { generatePhoneVariants } from '@/lib/utils';
import { scheduleAndProcessBookingReminders } from '@/app/actions/event-sms-scheduler';

const createBookingSchema = z.object({
  event_id: z.string().uuid(),
  customer: z.object({
    first_name: z.string().min(1).max(100),
    last_name: z.string().min(1).max(100),
    mobile_number: z.string().regex(ukPhoneRegex, 'Invalid UK phone number'),
    sms_opt_in: z.boolean().default(false),
  }),
  seats: z.number().min(1).max(10),
  notes: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  return withApiAuth(async (_req, apiKey) => {
    const body = await request.json();
    
    // Validate input
    const validation = createBookingSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        validation.error.errors[0].message,
        'VALIDATION_ERROR',
        400
      );
    }

    const { event_id, customer, seats, notes } = validation.data;
    const supabase = createAdminClient();
    
    // Start transaction
    // Check event availability
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        capacity,
        event_status,
        bookings(seats)
      `)
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return createErrorResponse('Event not found', 'NOT_FOUND', 404);
    }

    // Validate event status
    if (event.event_status !== 'scheduled') {
      return createErrorResponse(
        'Event is not available for booking',
        'EVENT_NOT_AVAILABLE',
        400
      );
    }

    // Check capacity
    const bookedSeats = event.bookings?.reduce((sum: number, booking: any) => sum + (booking.seats || 0), 0) || 0;
    const capacity = event.capacity || 100;
    const availableSeats = capacity - bookedSeats;

    if (availableSeats < seats) {
      return createErrorResponse(
        'Not enough tickets available',
        'INSUFFICIENT_CAPACITY',
        400,
        {
          requested_seats: seats,
          available_seats: availableSeats,
        }
      );
    }

    // Standardize phone number
    const standardizedPhone = customer.mobile_number.replace(/\D/g, '');
    const phoneVariants = generatePhoneVariants(standardizedPhone);

    // Check if customer exists
    let customerId: string;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, sms_opt_in')
      .or(phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(','))
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      
      // Update SMS opt-in if changed
      if (customer.sms_opt_in && !existingCustomer.sms_opt_in) {
        await supabase
          .from('customers')
          .update({ sms_opt_in: true })
          .eq('id', customerId);
      }
    } else {
      // Create new customer
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          first_name: customer.first_name,
          last_name: customer.last_name,
          mobile_number: standardizedPhone.startsWith('44') ? `+${standardizedPhone}` : `+44${standardizedPhone}`,
          sms_opt_in: customer.sms_opt_in,
        })
        .select('id')
        .single();

      if (customerError || !newCustomer) {
        return createErrorResponse('Failed to create customer', 'DATABASE_ERROR', 500);
      }

      customerId = newCustomer.id;
    }

    // Create booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        event_id,
        customer_id: customerId,
        seats,
        notes,
      })
      .select('id')
      .single();

    if (bookingError || !booking) {
      return createErrorResponse('Failed to create booking', 'DATABASE_ERROR', 500);
    }

    // Generate confirmation number
    const confirmationNumber = `ANH-${new Date().getFullYear()}-${booking.id.slice(0, 8).toUpperCase()}`;

    // Schedule SMS reminders/confirmation
    try {
      await scheduleAndProcessBookingReminders(booking.id);
    } catch (err) {
      console.error('Failed to schedule booking reminders for API booking', err);
    }

    // Log API event
    await supabase.from('audit_logs').insert({
      user_id: apiKey.id,
      action: 'booking.created',
      entity_type: 'booking',
      entity_id: booking.id,
      metadata: {
        api_key: apiKey.name,
        event_id,
        customer_id: customerId,
        seats,
      },
    });

    return createApiResponse({
      booking_id: booking.id,
      confirmation_number: confirmationNumber,
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        time: event.time,
      },
      customer: {
        first_name: customer.first_name,
        last_name: customer.last_name,
      },
      seats,
      sms_opt_in: customer.sms_opt_in,
    }, 201);
  }, ['write:bookings'], request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
