# Event SMS Reminder System - Full Code Reference (Trimmed)

This report documents how event reminders are scheduled and sent via SMS in the current codebase. It includes the exact code and SQL snippets in use so an external consultant can review the implementation without repository access.

High-level flow:
1) Booking creation or updates schedule reminders in `booking_reminders`.
2) Cron endpoint triggers processing (or reminders can be processed directly after scheduling).
3) The pipeline validates, de-dupes, and sends reminders.
4) SMS is delivered via Twilio and logged in `messages`.
5) Twilio webhooks update delivery status and handle inbound opt-outs.

Key runtime controls and environment flags:
- `SUSPEND_EVENT_SMS` and `SUSPEND_ALL_SMS` can pause event reminders.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` and/or `TWILIO_MESSAGING_SERVICE_SID` must be configured to send.
- `CRON_SECRET` and `x-vercel-cron` headers gate the reminder cron endpoint.
- `NEXT_PUBLIC_CONTACT_PHONE_NUMBER` is appended to outbound SMS instructions.

Below, code is grouped by concern. Every snippet is copied verbatim from the repo at the time of this report.

## Scheduling and Trigger Points

### File: src/services/bookings.ts
```ts
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEventAvailableCapacity, invalidateEventCache } from '@/lib/events';
import { formatPhoneForStorage } from '@/lib/validation';
import { withRetry } from '@/lib/supabase-retry';
import { scheduleAndProcessBookingReminders, cancelBookingReminders } from '@/app/actions/event-sms-scheduler';

export type CreateBookingInput = {
  eventId: string;
  customerId?: string;
  seats: number;
  notes?: string;
  isReminderOnly?: boolean;
  overwrite?: boolean;
  createCustomer?: {
    firstName: string;
    lastName?: string;
    email?: string;
    mobileNumber: string;
  };
  userId: string;
  userEmail?: string;
};

export type UpdateBookingInput = {
  id: string;
  seats: number;
  notes?: string;
  userId: string;
  userEmail?: string;
};

export class BookingService {
  static async createBooking(input: CreateBookingInput) {
    const supabase = await createClient();

    // 1. Handle Customer
    let customerId = input.customerId;
    if (input.createCustomer) {
      const { firstName, lastName, email, mobileNumber } = input.createCustomer;

      let formattedPhone: string;
      try {
        formattedPhone = formatPhoneForStorage(mobileNumber);
      } catch (error) {
        throw new Error('Invalid phone number format');
      }

      // Check existence
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id, email, last_name')
        .eq('mobile_number', formattedPhone)
        .single();

      if (existingCustomer) {
        customerId = existingCustomer.id;

        // Update customer details if provided (always update names if explicitly provided)
        const updatePayload: any = {};

        if (email && email.toLowerCase() !== existingCustomer.email) {
          updatePayload.email = email.toLowerCase();
        }

        if (firstName) {
          updatePayload.first_name = firstName;
        }

        // Only update last name if it's provided (not undefined)
        if (lastName !== undefined && lastName !== null) {
          updatePayload.last_name = lastName;
        }

        if (Object.keys(updatePayload).length > 0) {
          await supabase.from('customers').update(updatePayload).eq('id', customerId);
        }
      } else {
        const { data: newCustomer, error } = await supabase
          .from('customers')
          .insert({
            first_name: firstName,
            last_name: lastName || null,
            mobile_number: formattedPhone,
            email: email ? email.toLowerCase() : null,
            sms_opt_in: true
          })
          .select()
          .single();

        if (error) throw new Error('Failed to create customer');
        customerId = newCustomer.id;
      }
    }

    if (!customerId) throw new Error('Customer ID required');

    // 2. Validate Event & Capacity
    const { data: event } = await supabase
      .from('events')
      .select('id, name, capacity')
      .eq('id', input.eventId)
      .single();

    if (!event) throw new Error('Event not found');

    // Check existing booking
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id, seats, is_reminder_only')
      .eq('event_id', input.eventId)
      .eq('customer_id', customerId)
      .single();

    if (existingBooking && !input.overwrite) {
      const error: any = new Error('Duplicate booking');
      error.code = 'duplicate_booking';
      error.existingBooking = existingBooking;
      throw error;
    }

    if (event.capacity && input.seats > 0) {
      let available = await getEventAvailableCapacity(input.eventId);
      if (existingBooking && input.overwrite) {
        available = (available ?? 0) + (existingBooking.seats ?? 0);
      }
      if (available !== null && input.seats > available) {
        throw new Error(`Only ${available} tickets available`);
      }
    }

    // 3. Create/Update Booking
    let booking;
    const isReminderOnly = input.isReminderOnly ?? (input.seats === 0);

    if (existingBooking && input.overwrite) {
      const { data: updated, error } = await supabase
        .from('bookings')
        .update({
          seats: input.seats,
          notes: input.notes || null,
          is_reminder_only: isReminderOnly
        })
        .eq('id', existingBooking.id)
        .select()
        .single();

      if (error) throw new Error('Failed to update booking');
      booking = updated;
    } else {
      const { data: created, error } = await supabase
        .from('bookings')
        .insert({
          event_id: input.eventId,
          customer_id: customerId,
          seats: input.seats,
          notes: input.notes || null,
          booking_source: 'direct_booking',
          is_reminder_only: isReminderOnly
        })
        .select()
        .single();

      if (error) throw new Error('Failed to create booking');
      booking = created;
    }

    // 4. Side Effects
    // SMS Reminders (await to ensure scheduling isn't cancelled on serverless)
    await scheduleAndProcessBookingReminders(booking.id).catch(console.error);

    // Invalidate Cache
    await invalidateEventCache(input.eventId);

    return { booking, event, operation: existingBooking ? 'update' : 'create' };
  }

  static async updateBooking(input: UpdateBookingInput) {
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from('bookings')
      .select('event_id, customer_id, seats')
      .eq('id', input.id)
      .single();

    if (!booking) throw new Error('Booking not found');

    // Capacity check
    const { data: event } = await supabase
      .from('events')
      .select('capacity, name')
      .eq('id', booking.event_id)
      .single();

    if (event?.capacity && input.seats > booking.seats!) {
      const available = await getEventAvailableCapacity(booking.event_id);
      if (available !== null && (input.seats - booking.seats!) > available) {
        throw new Error(`Insufficient capacity. Available: ${available}`);
      }
    }

    const { error } = await supabase
      .from('bookings')
      .update({
        seats: input.seats,
        notes: input.notes || null
      })
      .eq('id', input.id);

    if (error) throw new Error('Failed to update booking');

    return { event };
  }

  static async deleteBooking(id: string) {
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from('bookings')
      .select('event_id, customer_id, seats, events(name), customers(first_name, last_name)')
      .eq('id', id)
      .single();

    if (booking) {
      await cancelBookingReminders(id);
    }

    const { error } = await supabase.from('bookings').delete().eq('id', id);
    if (error) throw new Error('Failed to delete booking');

    if (booking?.event_id) {
      await invalidateEventCache(booking.event_id);
    }

    return booking;
  }
}

```

### File: src/app/api/bookings/route.ts
```ts
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
        booking_totals:bookings(sum:seats)
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
    const bookedSeats = (event.booking_totals?.[0]?.sum as number | null) ?? 0;
    const capacity = event.capacity; // null means uncapped
    const availableSeats = capacity === null ? null : (capacity || 0) - bookedSeats;

    if (availableSeats !== null && availableSeats < seats) {
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

```

### File: src/app/api/bookings/confirm/route.ts
```ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import { scheduleAndProcessBookingReminders } from '@/app/actions/event-sms-scheduler';
import { logAuditEvent } from '@/app/actions/audit';
import { getEventAvailableCapacity } from '@/lib/events';

const confirmBookingSchema = z.object({
  token: z.string().uuid(),
  seats: z.number().min(1).max(10),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  customer: z
    .object({
      first_name: z.string().min(1).max(100).optional(),
      last_name: z.string().min(1).max(100).optional(),
    })
    .optional(),
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

    const {
      token,
      seats,
      first_name: topLevelFirstName,
      last_name: topLevelLastName,
      customer,
    } = validation.data;

    const rawFirstName = topLevelFirstName ?? customer?.first_name;
    const rawLastName = topLevelLastName ?? customer?.last_name;
    const firstName = rawFirstName?.trim();
    const lastName = rawLastName?.trim();
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
    const availableSeats = await getEventAvailableCapacity(pendingBooking.event_id);

    // If availableSeats is null, capacity is unlimited. 
    // If it's a number, check if we have enough seats.
    if (availableSeats !== null) {
      if (availableSeats < seats) {
        // Ensure we don't show negative numbers to the user
        const displaySeats = Math.max(0, availableSeats);
        return NextResponse.json(
          { error: `Only ${displaySeats} tickets available` },
          { status: 400 }
        );
      }
    }

    // Start transaction-like operations
    let customerId = pendingBooking.customer_id;

    // Create customer if needed
    if (!customerId && firstName && lastName) {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          first_name: firstName,
          last_name: lastName,
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
    }

    if (!customerId) {
      return NextResponse.json(
        { error: 'Customer information required' },
        { status: 400 }
      );
    }

    // If customer exists (from pending or just created), ensure name is up to date
    // This handles the case where initiate created a placeholder "Unknown" customer
    if (customerId && firstName && lastName) {
      const { data: currentCustomer } = await supabase
        .from('customers')
        .select('first_name, last_name')
        .eq('id', customerId)
        .single();

      if (currentCustomer) {
        const isPlaceholder = currentCustomer.first_name === 'Unknown' ||
          currentCustomer.last_name === 'Contact' ||
          (currentCustomer.last_name && /^\d+$/.test(currentCustomer.last_name));

        if (isPlaceholder) {
          await supabase
            .from('customers')
            .update({ first_name: firstName, last_name: lastName })
            .eq('id', customerId);
        }
      }
    }

    // Record the initial SMS for existing customers if not already recorded
    // This handles updating the message to 'delivered' and linking it properly
    if (customerId && pendingBooking.metadata?.initial_sms) {
      const smsData = pendingBooking.metadata.initial_sms;

      // Check if this SMS was already recorded
      const { data: existingMessage } = await supabase
        .from('messages')
        .select('id')
        .eq('message_sid', smsData.message_sid)
        .single();

      if (existingMessage) {
        const { error: updateError } = await supabase
          .from('messages')
          .update({
            customer_id: customerId, // Ensure linked to correct customer
            status: 'delivered',
            twilio_status: 'delivered',
            read_at: new Date().toISOString(),
            sent_at: smsData.sent_at,
            delivered_at: new Date().toISOString(),
            cost_usd: smsData.cost_usd,
            segments: smsData.segments
          })
          .eq('id', existingMessage.id);

        if (updateError) {
          console.error('Failed to update initial SMS message:', updateError);
        }
      } else {
        // Fallback if message wasn't logged during initiate (should be rare now)
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
          console.error('Failed to record initial SMS message:', messageError);
        }
      }
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
          is_reminder_only: false,
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
          is_reminder_only: false,
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
```

### File: src/app/actions/update-booking-seats.ts
```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { cancelBookingReminders, scheduleAndProcessBookingReminders } from './event-sms-scheduler'
import { logger } from '@/lib/logger'

const updateSeatsSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
  seats: z.number().min(0, 'Tickets cannot be negative').max(100, 'Cannot book more than 100 tickets')
})

/**
 * Update booking seats and handle reminder changes
 */
export async function updateBookingSeats(bookingId: string, newSeats: number) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }
    
    // Validate input
    const validatedData = updateSeatsSchema.parse({
      bookingId,
      seats: newSeats
    })
    
    // Get current booking details
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        event:events(id, name, date, time),
        customer:customers(id, first_name, last_name, mobile_number, sms_opt_in)
      `)
      .eq('id', validatedData.bookingId)
      .single()
    
    if (bookingError || !booking) {
      return { error: 'Booking not found' }
    }
    
    const oldSeats = booking.seats || 0
    const wasReminderOnly = booking.is_reminder_only === true
    const willBeReminderOnly = validatedData.seats === 0
    
    // Update the booking
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        seats: validatedData.seats,
        updated_at: new Date().toISOString(),
        is_reminder_only: willBeReminderOnly
      })
      .eq('id', validatedData.bookingId)
    
    if (updateError) {
      logger.error('Failed to update booking seats', {
        error: updateError,
        metadata: { bookingId: validatedData.bookingId, newSeats: validatedData.seats }
      })
      return { error: 'Failed to update booking' }
    }
    
    // Rebuild reminder schedule to reflect the latest seat count
    await cancelBookingReminders(validatedData.bookingId)

    const reminderResult = await scheduleAndProcessBookingReminders(validatedData.bookingId)

    if (!reminderResult.success) {
      logger.error('Failed to reschedule booking reminders', {
        error: new Error(reminderResult.error),
        metadata: { bookingId: validatedData.bookingId }
      })
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'update',
      resource_type: 'booking',
      resource_id: validatedData.bookingId,
      operation_status: 'success',
      additional_info: {
        eventId: booking.event.id,
        eventName: booking.event.name,
        customerId: booking.customer.id,
        customerName: `${booking.customer.first_name} ${booking.customer.last_name}`,
        oldSeats,
        newSeats: validatedData.seats,
        flowChange: wasReminderOnly !== willBeReminderOnly
          ? `${wasReminderOnly ? 'reminder_only' : 'seated'} -> ${willBeReminderOnly ? 'reminder_only' : 'seated'}`
          : 'none'
      }
    })
    
    // Revalidate the event page
    revalidatePath(`/events/${booking.event.id}`)
    
    return { 
      success: true, 
      oldSeats,
      newSeats: validatedData.seats,
      flowChanged: wasReminderOnly !== willBeReminderOnly
    }
  } catch (error) {
    logger.error('Error updating booking seats', {
      error: error as Error,
      metadata: { bookingId, newSeats }
    })
    return { error: 'Failed to update tickets for this booking' }
  }
}

/**
 * Convert a reminder-only booking to a confirmed booking with seats
 */
export async function convertReminderToBooking(bookingId: string, seats: number) {
  return updateBookingSeats(bookingId, seats)
}

/**
 * Cancel a booking (set seats to 0)
 */
export async function cancelBookingSeats(bookingId: string) {
  return updateBookingSeats(bookingId, 0)
}

```

### File: src/app/actions/event-sms-scheduler.ts
```ts
'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logger } from '@/lib/logger'
import { formatPhoneForStorage } from '@/lib/validation'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { subMonths, subWeeks, subDays, isAfter } from 'date-fns'
import { processScheduledEventReminders } from './sms-event-reminders'

const LONDON_TZ = 'Europe/London'
const DEFAULT_SEND_HOUR = 10

export type ReminderType =
  | 'booking_confirmation'
  | 'booked_1_month'
  | 'booked_1_week'
  | 'booked_1_day'
  | 'reminder_invite_1_month'
  | 'reminder_invite_1_week'
  | 'reminder_invite_1_day'
  | 'no_seats_2_weeks'
  | 'no_seats_1_week'
  | 'no_seats_day_before'

export interface BookingReminderContext {
  bookingId: string
  event: {
    id: string
    name: string
    date: string
    time: string
  }
  customer: {
    id: string
    first_name: string
    last_name: string | null
    mobile_number: string | null
    sms_opt_in: boolean | null
  }
  seats: number | null
  is_reminder_only: boolean
}

interface ScheduleCandidate {
  reminder_type: ReminderType
  scheduled_for: Date
}

interface ScheduleResult {
  success: true
  scheduled: number
  createdReminderIds: string[]
  dueNowReminderIds: string[]
  skippedTypes: ReminderType[]
}

interface ScheduleFailure {
  success: false
  error: string
}

type ScheduleBookingRemindersResult = ScheduleResult | ScheduleFailure

function toUtc(date: Date): Date {
  return fromZonedTime(date, LONDON_TZ)
}

function buildEventDate(context: BookingReminderContext): Date {
  // Interpret the stored event date/time in the London timezone
  const eventDateTimeString = `${context.event.date}T${context.event.time}`
  return fromZonedTime(eventDateTimeString, LONDON_TZ)
}

function buildReminderSchedule(
  context: BookingReminderContext,
  now: Date
): ScheduleCandidate[] {
  const isReminderOnly = context.is_reminder_only ?? ((context.seats || 0) === 0)
  const hasSeats = !isReminderOnly && (context.seats || 0) > 0
  const candidates: ScheduleCandidate[] = []
  const eventUtc = buildEventDate(context)
  const eventLocal = toZonedTime(eventUtc, LONDON_TZ)

  const seedLocal = (date: Date) => {
    const clone = new Date(date)
    clone.setHours(DEFAULT_SEND_HOUR, 0, 0, 0)
    return clone
  }

  const pushIfFuture = (type: ReminderType, localDate: Date) => {
    const scheduledUtc = toUtc(localDate)
    if (isAfter(scheduledUtc, now)) {
      candidates.push({ reminder_type: type, scheduled_for: scheduledUtc })
    }
  }

  if (hasSeats) {
    // Immediate confirmation is always queued even if event is same day
    candidates.push({ reminder_type: 'booking_confirmation', scheduled_for: now })

    const monthLocal = seedLocal(subMonths(eventLocal, 1))
    pushIfFuture('booked_1_month', monthLocal)

    const weekLocal = seedLocal(subWeeks(eventLocal, 1))
    pushIfFuture('booked_1_week', weekLocal)

    const dayLocal = seedLocal(subDays(eventLocal, 1))
    pushIfFuture('booked_1_day', dayLocal)
  } else {
    const twoWeekLocal = seedLocal(subWeeks(eventLocal, 2))
    pushIfFuture('no_seats_2_weeks', twoWeekLocal)

    const weekLocal = seedLocal(subWeeks(eventLocal, 1))
    pushIfFuture('no_seats_1_week', weekLocal)

    const dayLocal = seedLocal(subDays(eventLocal, 1))
    pushIfFuture('no_seats_day_before', dayLocal)
  }

  return candidates
}

async function fetchBookingReminderContext(bookingId: string): Promise<BookingReminderContext | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id,
      is_reminder_only,
      seats,
      event:events(id, name, date, time),
      customer:customers(id, first_name, last_name, mobile_number, sms_opt_in)
    `)
    .eq('id', bookingId)
    .single()

  if (error) {
    logger.error('Failed to load booking context for reminders', {
      error: error as Error,
      metadata: { bookingId }
    })
    return null
  }

  const eventRecord = Array.isArray(data?.event) ? data.event[0] : data?.event
  const customerRecord = Array.isArray(data?.customer) ? data.customer[0] : data?.customer

  if (!eventRecord || !customerRecord) {
    logger.warn('Incomplete booking context for reminders', {
      metadata: { bookingId }
    })
    return null
  }

  return {
    bookingId,
    event: {
      id: eventRecord.id,
      name: eventRecord.name,
      date: eventRecord.date,
      time: eventRecord.time
    },
    customer: {
      id: customerRecord.id,
      first_name: customerRecord.first_name,
      last_name: customerRecord.last_name,
      mobile_number: customerRecord.mobile_number,
      sms_opt_in: customerRecord.sms_opt_in
    },
    seats: data.seats,
    is_reminder_only: data.is_reminder_only ?? ((data.seats ?? 0) === 0)
  }
}

export async function scheduleBookingReminders(
  bookingId: string,
  options?: { context?: BookingReminderContext; now?: Date }
): Promise<ScheduleBookingRemindersResult> {
  const now = options?.now ?? new Date()
  const context = options?.context ?? await fetchBookingReminderContext(bookingId)

  if (!context) {
    return { success: false, error: 'Missing booking context for reminders' }
  }

  if (!context.customer.mobile_number) {
    return { success: false, error: 'Customer has no mobile number' }
  }

  if (context.customer.sms_opt_in === false) {
    return { success: false, error: 'Customer opted out of SMS reminders' }
  }

  let normalizedPhone: string
  try {
    normalizedPhone = formatPhoneForStorage(context.customer.mobile_number)
  } catch (error) {
    logger.error('Failed to normalize phone number for reminder scheduling', {
      error: error as Error,
      metadata: { bookingId, mobile_number: context.customer.mobile_number }
    })
    return { success: false, error: 'Invalid mobile number for reminders' }
  }

  const supabase = createAdminClient()
  const candidates = buildReminderSchedule(context, now)

  if (candidates.length === 0) {
    logger.info('No reminders to schedule (all cadence points are in the past)', {
      metadata: { bookingId }
    })
    return {
      success: true,
      scheduled: 0,
      createdReminderIds: [],
      dueNowReminderIds: [],
      skippedTypes: []
    }
  }

  const { data: existingRows } = await supabase
    .from('booking_reminders')
    .select('id, reminder_type, status, scheduled_for')
    .eq('booking_id', bookingId)

  const existingMap = new Map<string, { id: string; status: string; scheduled_for: string }>()
  existingRows?.forEach(row => existingMap.set(row.reminder_type, row))

  const toInsert: Array<{ reminder_type: ReminderType; scheduled_for: string }> = []
  const toUpdate: Array<{ id: string; scheduled_for: string }> = []
  const skippedTypes: ReminderType[] = []

  for (const candidate of candidates) {
    const existing = existingMap.get(candidate.reminder_type)
    const iso = candidate.scheduled_for.toISOString()

    if (!existing) {
      toInsert.push({ reminder_type: candidate.reminder_type, scheduled_for: iso })
      continue
    }

    if (existing.status === 'sent') {
      skippedTypes.push(candidate.reminder_type)
      continue
    }

    if (existing.status === 'pending' && existing.scheduled_for !== iso) {
      toUpdate.push({ id: existing.id, scheduled_for: iso })
      continue
    }

    skippedTypes.push(candidate.reminder_type)
  }

  const createdReminderIds: string[] = []
  const dueNowReminderIds: string[] = []

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('booking_reminders')
      .insert(
        toInsert.map(item => ({
          booking_id: bookingId,
          event_id: context.event.id,
          target_phone: normalizedPhone,
          reminder_type: item.reminder_type,
          scheduled_for: item.scheduled_for,
          status: 'pending'
        }))
      )
      .select('id, scheduled_for')

    if (error) {
      logger.error('Failed to insert booking reminders', {
        error: error as Error,
        metadata: { bookingId, inserts: toInsert }
      })
      return { success: false, error: 'Failed to insert reminders' }
    }

    for (const row of data || []) {
      createdReminderIds.push(row.id)
      if (new Date(row.scheduled_for) <= now) {
        dueNowReminderIds.push(row.id)
      }
    }
  }

  if (toUpdate.length > 0) {
    for (const item of toUpdate) {
      const { data, error } = await supabase
        .from('booking_reminders')
        .update({
          scheduled_for: item.scheduled_for,
          status: 'pending',
          event_id: context.event.id,
          target_phone: normalizedPhone
        })
        .eq('id', item.id)
        .select('id, scheduled_for')
        .single()

      if (error) {
        logger.error('Failed to update booking reminder', {
          error: error as Error,
          metadata: { bookingId, updateId: item.id, scheduled_for: item.scheduled_for }
        })
        return { success: false, error: 'Failed to update reminders' }
      }

      if (data && new Date(data.scheduled_for) <= now) {
        dueNowReminderIds.push(data.id)
      }
    }
  }

  const scheduledCount = createdReminderIds.length + toUpdate.length

  logger.info('Booking reminders scheduled', {
    metadata: {
      bookingId,
      created: createdReminderIds.length,
      updated: toUpdate.length,
      skippedTypes
    }
  })

  return {
    success: true,
    scheduled: scheduledCount,
    createdReminderIds,
    dueNowReminderIds,
    skippedTypes
  }
}

export async function scheduleAndProcessBookingReminders(
  bookingId: string,
  options?: { context?: BookingReminderContext; now?: Date }
) {
  const scheduleResult = await scheduleBookingReminders(bookingId, options)

  if (!scheduleResult.success) {
    return scheduleResult
  }

  if (scheduleResult.dueNowReminderIds.length > 0) {
    await processScheduledEventReminders({ reminderIds: scheduleResult.dueNowReminderIds })
  }

  return scheduleResult
}

export async function cancelBookingReminders(
  bookingId: string,
  reminderTypes?: ReminderType[]
) {
  const supabase = createAdminClient()

  try {
    let query = supabase
      .from('booking_reminders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('status', 'pending')

    if (reminderTypes && reminderTypes.length > 0) {
      query = query.in('reminder_type', reminderTypes)
    }

    const { error, count } = await query.select('id')

    if (error) {
      logger.error('Failed to cancel reminders', {
        error: error as Error,
        metadata: { bookingId, reminderTypes }
      })
      return { error: 'Failed to cancel reminders' }
    }

    logger.info('Reminders cancelled', {
      metadata: { bookingId, cancelled: count }
    })

    return { success: true, cancelled: count || 0 }
  } catch (error) {
    logger.error('Error cancelling reminders', {
      error: error as Error,
      metadata: { bookingId }
    })
    return { error: 'Failed to cancel reminders' }
  }
}

export async function addAttendeesWithScheduledSMS(
  eventId: string,
  customerIds: string[]
) {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'Insufficient permissions to add attendees' }
    }

    const supabase = createAdminClient()

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, date, time')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      return { error: 'Event not found' }
    }

    const uniqueCustomerIds = Array.from(new Set(customerIds))

    const { data: existingBookings, error: checkError } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('event_id', eventId)

    if (checkError) {
      return { error: 'Failed to check existing bookings' }
    }

    const existingCustomerIds = new Set(existingBookings?.map(b => b.customer_id) || [])
    const customersToAdd = uniqueCustomerIds.filter(id => !existingCustomerIds.has(id))

    if (customersToAdd.length === 0) {
      return {
        success: false,
        error: 'All selected customers already have bookings for this event'
      }
    }

    const newBookings = customersToAdd.map(customerId => ({
      event_id: eventId,
      customer_id: customerId,
      seats: 0,
      is_reminder_only: true,
      booking_source: 'bulk_add',
      notes: 'Added via bulk add'
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('bookings')
      .insert(newBookings)
      .select('id')

    if (insertError || !inserted) {
      return { error: 'Failed to create bookings' }
    }

    let scheduledCount = 0
    const allDueNowReminderIds: string[] = []

    // Process scheduling in batches to improve performance while preventing connection pool exhaustion
    const BATCH_SIZE = 5
    for (let i = 0; i < inserted.length; i += BATCH_SIZE) {
      const batch = inserted.slice(i, i + BATCH_SIZE)
      const results = await Promise.all(
        batch.map(booking => scheduleBookingReminders(booking.id))
      )

      for (const result of results) {
        if (result.success) {
          scheduledCount += result.scheduled
          if (result.dueNowReminderIds.length > 0) {
            allDueNowReminderIds.push(...result.dueNowReminderIds)
          }
        }
      }
    }

    // Process all due reminders in a single batch at the end
    if (allDueNowReminderIds.length > 0) {
      // Process in chunks of 50 (default limit of processScheduledEventReminders logic usually matches this)
      const PROCESS_CHUNK_SIZE = 50
      for (let i = 0; i < allDueNowReminderIds.length; i += PROCESS_CHUNK_SIZE) {
        const chunk = allDueNowReminderIds.slice(i, i + PROCESS_CHUNK_SIZE)
        await processScheduledEventReminders({ reminderIds: chunk })
      }
    }

    const addedCount = inserted.length
    const skippedCount = uniqueCustomerIds.length - inserted.length

    const userInfo = await getCurrentUser()
    await logAuditEvent({
      user_id: userInfo.user_id ?? undefined,
      user_email: userInfo.user_email ?? undefined,
      operation_type: 'create',
      resource_type: 'event_attendees_bulk_add',
      resource_id: event.id,
      operation_status: 'success',
      additional_info: {
        eventId: event.id,
        added: addedCount,
        skipped: skippedCount,
        remindersScheduled: scheduledCount
      }
    })

    return {
      success: true,
      added: addedCount,
      remindersScheduled: scheduledCount,
      skipped: skippedCount
    }
  } catch (error) {
    logger.error('Error in addAttendeesWithScheduledSMS', {
      error: error as Error,
      metadata: { eventId, customerCount: customerIds.length }
    })
    return { error: 'Failed to add attendees' }
  }
}

```

## Reminder Processing Pipeline

### File: src/app/actions/sms-event-reminders.ts
```ts
'use server'

import { logger } from '@/lib/logger'
import { queueDueEventReminders } from '@/lib/reminders/event-reminder-pipeline'

const eventSmsPaused = () =>
  process.env.SUSPEND_EVENT_SMS === 'true' || process.env.SUSPEND_ALL_SMS === 'true'

interface ProcessOptions {
  reminderIds?: string[]
  limit?: number
  now?: Date
}

export async function processScheduledEventReminders(options: ProcessOptions = {}) {
  try {
    const now = options.now ?? new Date()

    if (eventSmsPaused()) {
      logger.warn('Event SMS paused, skipping reminder processing', {
        metadata: {
          reminderIds: options.reminderIds?.length || 0
        }
      })
      return { success: true, sent: 0, failed: 0, duplicates: 0, cancelled: 0, skipped: 0, message: 'Event SMS paused' }
    }

    const result = await queueDueEventReminders({
      reminderIds: options.reminderIds,
      limit: options.limit,
      now
    })

    if (!result.success) {
      return { error: result.error }
    }

    logger.info('Reminder enqueue complete', {
      metadata: {
        sent: result.sent,
        cancelled: result.cancelled,
        failed: result.failed,
        duplicates: result.duplicates,
        skipped: result.skipped
      }
    })

    return result
  } catch (error) {
    logger.error('Error processing scheduled reminders', {
      error: error as Error
    })
    return { error: 'Failed to process reminders' }
  }
}

```

### File: src/lib/reminders/event-reminder-pipeline.ts
```ts
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { differenceInHours, isAfter } from 'date-fns'
import { ReminderRow, normalizeReminderRow } from './reminder-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { formatPhoneForStorage } from '@/lib/validation'
import { sendEventReminderById } from './send-event-reminder'

const LONDON_TZ = 'Europe/London'
const PAST_EVENT_GRACE_HOURS = 12 // Do not send reminders for events more than 12h in the past

type QueueOptions = {
  reminderIds?: string[]
  limit?: number
  now?: Date
}

export type QueueResult = {
  success: true
  sent: number
  cancelled: number
  failed: number
  duplicates: number
  skipped: number
  queued: number
  message: string
} | { success: false; error: string }

function buildEventDate(reminder: ReminderRow): Date | null {
  const event = reminder.booking?.event
  if (!event?.date) return null

  const time = event.time || '23:59:59'
  const zoned = fromZonedTime(`${event.date}T${time}`, LONDON_TZ)
  return toZonedTime(zoned, LONDON_TZ)
}

function buildKey(reminder: ReminderRow, phone: string) {
  return `${reminder.event_id}|${phone}|${reminder.reminder_type}`
}

async function cancelReminder(
  supabase: ReturnType<typeof createAdminClient>,
  reminderId: string,
  error_message: string
) {
  await supabase
    .from('booking_reminders')
    .update({ status: 'cancelled', error_message, updated_at: new Date().toISOString() })
    .eq('id', reminderId)
}

async function failReminder(
  supabase: ReturnType<typeof createAdminClient>,
  reminderId: string,
  error_message: string
) {
  await supabase
    .from('booking_reminders')
    .update({ status: 'failed', error_message, updated_at: new Date().toISOString() })
    .eq('id', reminderId)
}

export async function queueDueEventReminders(options: QueueOptions = {}): Promise<QueueResult> {
  try {
    const now = options.now ?? new Date()
    const nowIso = now.toISOString()
    const supabase = createAdminClient()
    const batchSize = options.limit ?? 50
    const drainFully = !options.reminderIds?.length

    const totals = {
      sent: 0,
      cancelled: 0,
      failed: 0,
      duplicates: 0,
      skipped: 0
    }

    const seenKeys = new Set<string>()
    let batchCount = 0

    while (true) {
      batchCount += 1

      let query = supabase
        .from('booking_reminders')
        .select(`
          id,
          reminder_type,
          scheduled_for,
          status,
          target_phone,
          event_id,
          booking:bookings(
            id,
            seats,
            customer:customers(
              id,
              first_name,
              last_name,
              mobile_number,
              sms_opt_in
            ),
            event:events(
              id,
              name,
              date,
              time
            )
          )
        `)
        .in('status', ['pending', 'queued'])
        .lte('scheduled_for', nowIso)

      if (options.reminderIds?.length) {
        query = query.in('id', options.reminderIds)
      } else {
        query = query
          .order('scheduled_for', { ascending: true })
          .limit(batchSize)
      }

      const { data, error } = await query

      if (error) {
        logger.error('Failed to fetch due reminders', { error, metadata: { time: nowIso } })
        return { success: false, error: 'Failed to fetch reminders' }
      }

      if (!data || data.length === 0) {
        if (batchCount === 1) {
          return {
            success: true,
            queued: 0,
            cancelled: 0,
            failed: 0,
            duplicates: 0,
            skipped: 0,
            sent: 0,
            message: 'No reminders due'
          }
        }
        break
      }

      const reminders: ReminderRow[] = data.map(normalizeReminderRow)
      const validReminders: Array<{ reminder: ReminderRow; phone: string }> = []
      const duplicateIds: string[] = []
      const cancelIds: Array<{ id: string; reason: string }> = []

      // Local dedupe and validation pass
      for (const reminder of reminders) {
        const booking = reminder.booking
        const event = booking?.event
        const customer = booking?.customer

        if (!booking || !event || !customer) {
          cancelIds.push({ id: reminder.id, reason: 'Incomplete booking context' })
          continue
        }

        if (customer.sms_opt_in === false) {
          cancelIds.push({ id: reminder.id, reason: 'Customer opted out' })
          continue
        }

        const phoneCandidate = reminder.target_phone || customer.mobile_number
        if (!phoneCandidate) {
          cancelIds.push({ id: reminder.id, reason: 'Missing phone number' })
          continue
        }

        let normalizedPhone: string
        try {
          normalizedPhone = formatPhoneForStorage(phoneCandidate)
        } catch (err) {
          cancelIds.push({ id: reminder.id, reason: 'Invalid phone number' })
          continue
        }

        const eventDate = buildEventDate(reminder)
        if (!eventDate) {
          cancelIds.push({ id: reminder.id, reason: 'Missing event date' })
          continue
        }

        if (!isAfter(eventDate, now) && differenceInHours(now, eventDate) > PAST_EVENT_GRACE_HOURS) {
          cancelIds.push({ id: reminder.id, reason: 'Event already passed' })
          continue
        }

        const key = buildKey(reminder, normalizedPhone)
        if (seenKeys.has(key)) {
          duplicateIds.push(reminder.id)
          continue
        }

        seenKeys.add(key)
        validReminders.push({ reminder, phone: normalizedPhone })
      }

      // Persist cancellations
      if (cancelIds.length > 0) {
        const { error: cancelError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Suppressed by new reminder pipeline',
            updated_at: nowIso
          })
          .in('id', cancelIds.map(item => item.id))

        if (cancelError) {
          logger.error('Failed to cancel invalid reminders', { error: cancelError })
        }
      }

      // Persist duplicate suppression
      if (duplicateIds.length > 0) {
        const { error: dupError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Duplicate reminder suppressed',
            updated_at: nowIso
          })
          .in('id', duplicateIds)

        if (dupError) {
          logger.error('Failed to cancel duplicate reminders', { error: dupError })
        }
      }

      totals.cancelled += cancelIds.length + duplicateIds.length
      totals.duplicates += duplicateIds.length
      totals.skipped += cancelIds.length

      if (validReminders.length === 0) {
        if (!drainFully) break
        continue
      }

      // Check already sent/queued in DB to enforce idempotency across runs
      const eventIds = Array.from(new Set(validReminders.map(item => item.reminder.event_id).filter(Boolean)))
      const phones = Array.from(new Set(validReminders.map(item => item.phone)))
      const reminderTypes = Array.from(new Set(validReminders.map(item => item.reminder.reminder_type)))

      let existingKeys = new Set<string>()
      if (eventIds.length && phones.length && reminderTypes.length) {
        const { data: existingRows, error: existingError } = await supabase
          .from('booking_reminders')
          .select('event_id, target_phone, reminder_type, status')
          .in('event_id', eventIds)
          .in('target_phone', phones)
          .in('reminder_type', reminderTypes)
          .in('status', ['sent', 'queued', 'sending'])

        if (!existingError && existingRows) {
          existingKeys = new Set(
            existingRows.map(row => `${row.event_id}|${row.target_phone}|${row.reminder_type}`)
          )
        }
      }

      let suppressed = 0
      let cancelledBySend = 0

      for (const { reminder, phone } of validReminders) {
        const key = buildKey(reminder, phone)
        if (existingKeys.has(key)) {
          suppressed += 1
          await cancelReminder(supabase, reminder.id, 'Duplicate reminder suppressed (already sent/queued)')
          continue
        }

        try {
          const sendResult = await sendEventReminderById(reminder.id)
          if (!sendResult.success) {
            if (sendResult.cancelled) {
              cancelledBySend += 1
              continue
            }
            totals.failed += 1
            await failReminder(supabase, reminder.id, sendResult.error || 'Failed to send reminder')
            continue
          }

          totals.sent += 1
          existingKeys.add(key)
        } catch (err) {
          totals.failed += 1
          await failReminder(supabase, reminder.id, err instanceof Error ? err.message : 'Failed to enqueue reminder job')
        }
      }

      totals.cancelled += suppressed + cancelledBySend
      totals.duplicates += suppressed

      // Carry over dedupe keys so later batches remain idempotent within this run
      existingKeys.forEach(key => seenKeys.add(key))

      const drainedBatch = !drainFully || data.length < batchSize
      if (drainedBatch) {
        break
      }

      // Safety to prevent unbounded loops
      if (batchCount > 50) {
        logger.warn('Stopping reminder drain after 50 batches to avoid runaway loop', {
          metadata: { sent: totals.sent, failed: totals.failed, cancelled: totals.cancelled }
        })
        break
      }
    }

    return {
      success: true,
      sent: totals.sent,
      cancelled: totals.cancelled,
      failed: totals.failed,
      duplicates: totals.duplicates,
      skipped: totals.skipped,
      queued: 0,
      message: `Sent ${totals.sent}, cancelled ${totals.cancelled}, failed ${totals.failed}, duplicates ${totals.duplicates}`
    }
  } catch (error) {
    logger.error('queueDueEventReminders error', { error: error as Error })
    return { success: false, error: 'Failed to queue reminders' }
  }
}

```

### File: src/lib/reminders/send-event-reminder.ts
```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getMessageTemplate } from '@/lib/smsTemplates'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { formatDateInLondon } from '@/lib/dateUtils'
import { normalizeReminderRow, buildReminderTemplate } from './reminder-utils'
import { sendSMS } from '@/lib/twilio'
import { formatPhoneForStorage } from '@/lib/validation'
import { fromZonedTime } from 'date-fns-tz'
import { differenceInHours, isAfter, subDays } from 'date-fns'

const eventSmsPaused = () =>
  process.env.SUSPEND_EVENT_SMS === 'true' || process.env.SUSPEND_ALL_SMS === 'true'

const LONDON_TZ = 'Europe/London'
const PAST_EVENT_GRACE_HOURS = 12
const MAX_FAILURES = 3
const FAILURE_LOOKBACK_DAYS = 30

type ReminderSendResult =
  | { success: true; reminderId: string; twilioSid: string | null }
  | { success: false; reminderId: string; error: string; cancelled?: boolean }

async function loadReminder(reminderId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('booking_reminders')
    .select(`
      id,
      reminder_type,
      scheduled_for,
      status,
      target_phone,
      event_id,
      booking:bookings(
        id,
        seats,
        customer:customers(
          id,
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        ),
        event:events(
          id,
          name,
          date,
          time
        )
      )
    `)
    .eq('id', reminderId)
    .single()

  if (error || !data) {
    return { supabase, reminder: null, error: error?.message ?? 'Reminder not found' }
  }

  return { supabase, reminder: normalizeReminderRow(data) }
}

async function getSmsFailureCount(
  supabase: ReturnType<typeof createAdminClient>,
  phone: string
): Promise<number> {
  const cutoffIso = subDays(new Date(), FAILURE_LOOKBACK_DAYS).toISOString()

  const { count, error } = await supabase
    .from('messages')
    .select('id', { head: true, count: 'exact' })
    .eq('direction', 'outbound')
    .eq('message_type', 'sms')
    .eq('to_number', phone)
    .eq('status', 'failed')
    .gte('created_at', cutoffIso)

  if (error) {
    logger.error('Failed to fetch SMS failure count', {
      error: error as Error,
      metadata: { phone }
    })
    return 0
  }

  return count ?? 0
}

async function disableSmsForCustomer(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  reason: string
) {
  const { error } = await supabase
    .from('customers')
    .update({ sms_opt_in: false })
    .eq('id', customerId)

  if (error) {
    logger.error('Failed to disable SMS for customer', {
      error: error as Error,
      metadata: { customerId, reason }
    })
  }
}

export async function sendEventReminderById(reminderId: string): Promise<ReminderSendResult> {
  const { supabase, reminder, error } = await loadReminder(reminderId)

  if (!reminder) {
    logger.error('Reminder not found for send', { metadata: { reminderId, error } })
    return { success: false, reminderId, error: error ?? 'Reminder not found' }
  }

  if (eventSmsPaused()) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'cancelled', error_message: 'Event SMS paused' })
      .eq('id', reminder.id)

    logger.warn('Event SMS paused, skipping send', {
      metadata: {
        reminderId,
        bookingId: reminder.booking?.id,
        eventId: reminder.booking?.event?.id
      }
    })

    return { success: true, reminderId, twilioSid: null }
  }

  if (reminder.status === 'sent') {
    logger.info('Reminder already sent, skipping duplicate send', {
      metadata: { reminderId: reminder.id }
    })
    return { success: true, reminderId: reminder.id, twilioSid: null }
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'SMS not configured' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'SMS not configured' }
  }

  if (!process.env.TWILIO_MESSAGING_SERVICE_SID && !process.env.TWILIO_PHONE_NUMBER) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'No SMS sender configured' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'SMS sender not configured' }
  }

  if (!reminder.booking || !reminder.booking.customer || !reminder.booking.event) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'Booking context missing' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Booking context missing' }
  }

  if (reminder.booking.customer.sms_opt_in === false) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'cancelled', error_message: 'Customer opted out' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Customer opted out' }
  }

  const targetPhone = reminder.target_phone || reminder.booking.customer.mobile_number

  if (!targetPhone) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'Missing customer phone number' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Missing phone number' }
  }

  const customer = reminder.booking.customer
  const event = reminder.booking.event
  const seats = reminder.booking.seats || 0
  const nowIso = new Date().toISOString()

  let normalizedPhone = targetPhone
  try {
    normalizedPhone = formatPhoneForStorage(targetPhone)
  } catch (normalizeError) {
    logger.warn('Failed to normalize phone for failure tracking', {
      error: normalizeError as Error,
      metadata: { reminderId: reminder.id, targetPhone }
    })
  }

  const failureCount = await getSmsFailureCount(supabase, normalizedPhone)
  if (failureCount >= MAX_FAILURES) {
    await supabase
      .from('booking_reminders')
      .update({
        status: 'cancelled',
        error_message: 'SMS disabled after repeated failures',
        updated_at: nowIso
      })
      .eq('id', reminder.id)

    await disableSmsForCustomer(supabase, customer.id, 'exceeded_sms_failures')

    logger.warn('Skipping reminder send due to failure limit', {
      metadata: { reminderId: reminder.id, phone: normalizedPhone, failureCount }
    })

    return {
      success: false,
      reminderId: reminder.id,
      error: 'SMS disabled after repeated failures',
      cancelled: true
    }
  }

  const eventDateTime = fromZonedTime(
    `${event.date}T${event.time || '23:59:59'}`,
    LONDON_TZ
  )

  if (!isAfter(eventDateTime, new Date()) && differenceInHours(new Date(), eventDateTime) > PAST_EVENT_GRACE_HOURS) {
    await supabase
      .from('booking_reminders')
      .update({
        status: 'cancelled',
        error_message: 'Event already passed',
        updated_at: nowIso
      })
      .eq('id', reminder.id)

    return {
      success: false,
      reminderId: reminder.id,
      error: 'Event already passed',
      cancelled: true
    }
  }

  const templateVariables = {
    customer_name: `${customer.first_name} ${customer.last_name || ''}`.trim(),
    first_name: customer.first_name,
    event_name: event.name,
    event_date: formatDateInLondon(event.date, { month: 'long', day: 'numeric' }),
    event_time: event.time,
    seats: seats.toString(),
    venue_name: 'The Anchor',
    contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
  }

  const messageFromDb = await getMessageTemplate(event.id, reminder.reminder_type, templateVariables)
  const fallbackMessage = buildReminderTemplate(reminder)
  const finalMessage = messageFromDb || fallbackMessage

  if (!finalMessage) {
    await supabase
      .from('booking_reminders')
      .update({ status: 'failed', error_message: 'Missing reminder template' })
      .eq('id', reminder.id)
    return { success: false, reminderId, error: 'Missing reminder template' }
  }

  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const messageWithSupport = ensureReplyInstruction(finalMessage, supportPhone)

  try {
    // Mark as in-flight to prevent duplicate processing; bail if someone else already claimed it
    const { data: claimed, error: claimError } = await supabase
      .from('booking_reminders')
      .update({ status: 'sending', updated_at: nowIso })
      .eq('id', reminder.id)
      .in('status', ['pending', 'queued', 'failed'])
      .select('id')
      .single()

    if (claimError && (claimError as any)?.code !== 'PGRST116') {
      throw claimError
    }

    if (!claimed) {
      logger.info('Reminder already processing or sent, skipping duplicate send', {
        metadata: { reminderId: reminder.id }
      })
      return {
        success: false,
        reminderId: reminder.id,
        error: 'Reminder already processing',
        cancelled: true
      }
    }

    // Use sendSMS which now handles DB logging
    const result = await sendSMS(targetPhone, messageWithSupport, {
      customerId: customer.id,
      metadata: {
        reminder_id: reminder.id,
        reminder_type: reminder.reminder_type,
        booking_id: reminder.booking.id,
        event_id: event.id
      }
    })

    if (!result.success || !result.sid) {
      const errorMessage = result.error || 'Failed to send SMS'

      // Twilio opt-out (21610) should permanently disable and cancel
      if ((result as any).code === 21610) {
        await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Recipient opted out via carrier',
            updated_at: nowIso
          })
          .eq('id', reminder.id)

        await disableSmsForCustomer(supabase, customer.id, 'carrier_opt_out')

        logger.warn('Recipient carrier opt-out, cancelling reminder', {
          metadata: { reminderId: reminder.id, phone: normalizedPhone }
        })

        return {
          success: false,
          reminderId: reminder.id,
          error: errorMessage,
          cancelled: true
        }
      }

      await supabase
        .from('booking_reminders')
        .update({
          status: 'failed',
          error_message: errorMessage,
          target_phone: targetPhone,
          updated_at: nowIso
        })
        .eq('id', reminder.id)

      logger.error('Failed to send reminder', {
        metadata: {
          reminderId: reminder.id,
          bookingId: reminder.booking.id,
          eventId: event.id,
          error: errorMessage
        }
      })

      return { success: false, reminderId: reminder.id, error: errorMessage }
    }

    await supabase
      .from('booking_reminders')
      .update({
        status: 'sent',
        sent_at: nowIso,
        target_phone: targetPhone,
        event_id: event.id,
        message_id: result.messageId, // Use the ID returned from logging
        error_message: null
      })
      .eq('id', reminder.id)

    await supabase
      .from('bookings')
      .update({ last_reminder_sent: nowIso })
      .eq('id', reminder.booking.id)

    logger.info('Reminder sent via job queue', {
      metadata: {
        reminderId: reminder.id,
        bookingId: reminder.booking.id,
        eventId: event.id,
        messageSid: result.sid
      }
    })

    return { success: true, reminderId: reminder.id, twilioSid: result.sid }
  } catch (sendError) {
    const errorMessage = sendError instanceof Error ? sendError.message : 'Failed to send reminder'

    await supabase
      .from('booking_reminders')
      .update({
        status: 'failed',
        error_message: errorMessage,
        target_phone: targetPhone,
        updated_at: new Date().toISOString()
      })
      .eq('id', reminder.id)

    logger.error('Failed to send reminder', {
      error: sendError as Error,
      metadata: { reminderId: reminder.id, bookingId: reminder.booking.id }
    })

    return { success: false, reminderId: reminder.id, error: errorMessage }
  }
}

```

### File: src/lib/reminders/reminder-utils.ts
```ts
import { ReminderType } from '@/app/actions/event-sms-scheduler'
import { formatTime12Hour } from '@/lib/dateUtils'
import { smsTemplates } from '@/lib/smsTemplates';

export type ReminderStatus = 'pending' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'

function isReminderStatus(value: any): value is ReminderStatus {
  return ['pending', 'queued', 'sending', 'sent', 'failed', 'cancelled'].includes(value)
}

export type ReminderRow = {
  id: string
  reminder_type: ReminderType
  status: ReminderStatus
  scheduled_for: string
  target_phone: string | null
  event_id: string | null
  booking: {
    id: string
    seats: number | null
    customer: {
      id: string
      first_name: string
      last_name: string | null
      mobile_number: string | null
      sms_opt_in: boolean | null
    } | null
    event: {
      id: string
      name: string
      date: string
      time: string
    } | null
  } | null
}

export function normalizeReminderRow(raw: any): ReminderRow {
  const bookingRecord = Array.isArray(raw?.booking) ? raw.booking[0] : raw?.booking
  const customerRecord = Array.isArray(bookingRecord?.customer) ? bookingRecord.customer[0] : bookingRecord?.customer
  const eventRecord = Array.isArray(bookingRecord?.event) ? bookingRecord.event[0] : bookingRecord?.event

  const status: ReminderStatus = isReminderStatus(raw?.status) ? raw.status : 'pending'

  return {
    id: raw?.id,
    reminder_type: raw?.reminder_type,
    status,
    scheduled_for: raw?.scheduled_for,
    target_phone: raw?.target_phone ?? null,
    event_id: raw?.event_id ?? null,
    booking: bookingRecord
      ? {
          id: bookingRecord.id,
          seats: bookingRecord.seats ?? null,
          customer: customerRecord
            ? {
                id: customerRecord.id,
                first_name: customerRecord.first_name,
                last_name: customerRecord.last_name ?? null,
                mobile_number: customerRecord.mobile_number ?? null,
                sms_opt_in: customerRecord.sms_opt_in ?? null
              }
            : null,
          event: eventRecord
            ? {
                id: eventRecord.id,
                name: eventRecord.name,
                date: eventRecord.date,
                time: eventRecord.time
              }
            : null
        }
      : null
  }
}

export function buildReminderTemplate(reminder: ReminderRow): string {
  const booking = reminder.booking
  if (!booking?.event || !booking.customer) {
    return ''
  }

  const eventDate = booking.event.date
  const common = {
    firstName: booking.customer.first_name,
    eventName: booking.event.name,
    eventDate,
    eventTime: booking.event.time ? formatTime12Hour(booking.event.time) : 'TBC',
    seats: booking.seats || 0
  }

  switch (reminder.reminder_type) {
    case 'booking_confirmation':
      return smsTemplates.bookingConfirmationNew({
        ...common,
        seats: common.seats || 0
      })
    case 'booked_1_month':
      return smsTemplates.bookedOneMonth(common)
    case 'booked_1_week':
      return smsTemplates.bookedOneWeek(common)
    case 'booked_1_day':
      return smsTemplates.bookedOneDay(common)
    case 'reminder_invite_1_month':
      return smsTemplates.reminderInviteOneMonth(common)
    case 'reminder_invite_1_week':
      return smsTemplates.reminderInviteOneWeek(common)
    case 'reminder_invite_1_day':
      return smsTemplates.reminderInviteOneDay(common)
    case 'no_seats_2_weeks':
      return smsTemplates.noSeats2Weeks(common)
    case 'no_seats_1_week':
      return smsTemplates.noSeats1Week(common)
    case 'no_seats_day_before':
      return smsTemplates.noSeatsDayBefore(common)
    default:
      return ''
  }
}

```

## Template Resolution and Rendering

### File: src/lib/smsTemplates.ts
```ts
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureReplyInstruction } from './sms/support';
import { cache } from './cache';
import { formatDateInLondon } from '@/lib/dateUtils';

export async function getSMSTemplates() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('message_templates')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getSMSTemplate(key: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('message_templates')
    .select('*')
    .eq('template_type', key)
    .single();
  return data;
}

export async function createSMSTemplate(template: any) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('message_templates')
    .insert(template)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export const smsTemplates = {
  bookingConfirmation: (params: {
    firstName: string
    seats: number
    eventName: string
    eventDate: string | Date
    eventTime: string
    qrCodeUrl?: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    const baseMessage = `Hi ${params.firstName}, your booking for ${params.seats} people for our ${params.eventName} on ${formattedDate} at ${params.eventTime} is confirmed!`
    const qrMessage = params.qrCodeUrl ? ` Check-in with QR: ${params.qrCodeUrl}` : ''
    return `${baseMessage}${qrMessage} Save this message as your confirmation. The Anchor`
  },

  bookingConfirmationNew: (params: {
    firstName: string
    seats: number
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    const seatCopy = params.seats > 1
      ? `${params.seats} tickets are reserved for you`
      : 'your ticket is reserved for you'
    return `Hi ${params.firstName}, you're all set for ${params.eventName} on ${formattedDate} at ${params.eventTime} — ${seatCopy}. The Anchor`
  },

  bookedOneMonth: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, one month to go until ${params.eventName} on ${formattedDate}. We can't wait to host you. The Anchor`
  },

  bookedOneWeek: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    const seatsLine = params.seats > 1
      ? `${params.seats} tickets are waiting for you`
      : 'your ticket is waiting for you'
    return `Hi ${params.firstName}, we're a week out from ${params.eventName} on ${formattedDate} at ${params.eventTime} — ${seatsLine}. The Anchor`
  },

  bookedOneDay: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats: number
  }) => {
    const seatsLine = params.seats > 1
      ? `${params.seats} tickets are ready`
      : 'your ticket is ready'
    return `Hi ${params.firstName}, tomorrow's the night! ${params.eventName} starts at ${params.eventTime} and ${seatsLine}. The Anchor`
  },

  reminderInviteOneMonth: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, we'd love to see you at ${params.eventName} on ${formattedDate}. Want us to save you tickets? Reply with how many. The Anchor`
  },

  reminderInviteOneWeek: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, ${params.eventName} is next week on ${formattedDate} at ${params.eventTime}. Fancy joining us? Reply with tickets and we'll look after the rest. The Anchor`
  },

  reminderInviteOneDay: (params: {
    firstName: string
    eventName: string
    eventTime: string
  }) => {
    return `Hi ${params.firstName}, ${params.eventName} is TOMORROW at ${params.eventTime}. Last chance to grab tickets — reply with how many you'd like and we'll keep them aside. The Anchor`
  },

  reminderOnly: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, don't forget, we've got our ${params.eventName} on ${formattedDate} at ${params.eventTime}! Let us know if you want to book tickets. The Anchor`
  },

  noSeats2Weeks: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, we'd love to see you at our ${params.eventName} on ${formattedDate} at ${params.eventTime}! Reply with the number of tickets you'd like to book. The Anchor`
  },

  noSeats1Week: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, just 1 week until our ${params.eventName} on ${formattedDate} at ${params.eventTime}! Still time to book your tickets - just reply with how many you need. The Anchor`
  },

  noSeatsDayBefore: (params: {
    firstName: string
    eventName: string
    eventTime: string
  }) => {
    return `Hi ${params.firstName}, our ${params.eventName} is TOMORROW at ${params.eventTime}! Last chance to book - reply NOW with number of tickets needed or just turn up. The Anchor`
  },

  hasSeats1Week: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, see you next week! You have ${params.seats} tickets booked for our ${params.eventName} on ${formattedDate} at ${params.eventTime}. Want to bring more friends? Reply to add extra tickets. The Anchor`
  },

  hasSeatsDayBefore: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats: number
  }) => {
    return `Hi ${params.firstName}, see you TOMORROW! You have ${params.seats} tickets for our ${params.eventName} at ${params.eventTime}. Need to change numbers? Reply to this message. The Anchor`
  },

  dayBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats?: number
  }) => {
    const seatInfo = params.seats
      ? `and you have ${params.seats} tickets booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is tomorrow at ${params.eventTime} ${seatInfo}. See you tomorrow! The Anchor`
  },

  weekBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats?: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    const seatInfo = params.seats
      ? `and you have ${params.seats} tickets booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is next week on ${formattedDate} at ${params.eventTime} ${seatInfo}. See you here! The Anchor`
  },
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  });
  return result;
}

const TEMPLATE_TYPE_MAP: Record<string, string> = {
  bookingConfirmation: 'booking_confirmation',
  bookingConfirmationNew: 'booking_confirmation',
  weekBeforeReminder: 'reminder_7_day', 
  dayBeforeReminder: 'reminder_24_hour',
  reminderOnly: 'booking_reminder_confirmation',
  noSeats2Weeks: 'no_seats_2_weeks',
  noSeats1Week: 'no_seats_1_week',
  noSeatsDayBefore: 'no_seats_day_before',
  hasSeats1Week: 'has_seats_1_week',
  hasSeatsDayBefore: 'has_seats_day_before',
  bookedOneMonth: 'booked_1_month',
  bookedOneWeek: 'booked_1_week',
  bookedOneDay: 'booked_1_day',
  reminderInviteOneMonth: 'reminder_invite_1_month',
  reminderInviteOneWeek: 'reminder_invite_1_week',
  reminderInviteOneDay: 'reminder_invite_1_day',
  booking_reminder_24_hour: 'booking_reminder_24_hour',
  booking_reminder_7_day: 'booking_reminder_7_day'
};

export async function getMessageTemplatesBatch(
  requests: Array<{ eventId: string; templateType: string }>
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  try {
    const supabase = createAdminClient();

    const uniqueEventIds = Array.from(new Set(requests.map(r => r.eventId)));
    const uniqueTemplateTypes = Array.from(new Set(requests.map(r => TEMPLATE_TYPE_MAP[r.templateType] || r.templateType)));

    const { data: eventTemplates, error: eventError } = await supabase
      .from('event_message_templates')
      .select('event_id, template_type, content')
      .in('event_id', uniqueEventIds)
      .in('template_type', uniqueTemplateTypes)
      .eq('is_active', true);

    if (eventError) {
      console.error('Error fetching event templates batch:', eventError);
    }

    const { data: globalTemplates, error: globalError } = await supabase
      .from('message_templates')
      .select('template_type, content')
      .in('template_type', uniqueTemplateTypes)
      .eq('is_default', true)
      .eq('is_active', true);

    for (const request of requests) {
      const mappedType = TEMPLATE_TYPE_MAP[request.templateType] || request.templateType;
      const key = `${request.eventId}-${request.templateType}`;
      
      const eventTemplate = eventTemplates?.find(
        t => t.event_id === request.eventId && t.template_type === mappedType
      );
      
      if (eventTemplate?.content) {
        results.set(key, eventTemplate.content);
      } else {
        const globalTemplate = globalTemplates?.find(
          t => t.template_type === mappedType
        );
        if (globalTemplate?.content) {
          results.set(key, globalTemplate.content);
        } else {
          results.set(key, null);
        }
      }
    }

    return results;
  } catch (error) {
    console.error('Error in getMessageTemplatesBatch:', error);
    return results;
  }
}

export async function getMessageTemplate(
  eventId: string | undefined,
  templateType: string,
  variables: Record<string, string>,
  bypassCache: boolean = false
): Promise<string | null> {
  try {
    if (!eventId) {
      return getGlobalMessageTemplate(templateType, variables);
    }
    
    const cacheKey = cache.buildKey('TEMPLATE', eventId, templateType);
    const cacheDisabled = process.env.DISABLE_TEMPLATE_CACHE === 'true';
    
    if (!bypassCache && !cacheDisabled) {
      const cached = await cache.get<string>(cacheKey);
      if (cached !== null) {
        const rendered = renderTemplate(cached, variables);
        return rendered;
      }
    }
    
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[getMessageTemplate] Missing Supabase environment variables');
      return null;
    }
    
    const supabase = createAdminClient();
    const mappedType = TEMPLATE_TYPE_MAP[templateType] || templateType;

    const { data, error } = await supabase
      .rpc('get_message_template', {
        p_event_id: eventId,
        p_template_type: mappedType
      })
      .single<{ content: string; variables: string[]; send_timing: string; custom_timing_hours: number | null }>();
      
    if (error || !data?.content) {
      return getGlobalMessageTemplate(templateType, variables);
    }
    
    if (!cacheDisabled) {
      await cache.set(cacheKey, data.content, 'LONG');
    }
    
    const rendered = renderTemplate(data.content, variables);
    return rendered;
  } catch (error) {
    console.error('Error in getMessageTemplate:', error);
    return null;
  }
}

async function getGlobalMessageTemplate(
  templateType: string,
  variables: Record<string, string>
): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const mappedType = TEMPLATE_TYPE_MAP[templateType] || templateType;
    
    const { data, error } = await supabase
      .from('message_templates')
      .select('content')
      .eq('template_type', mappedType)
      .eq('is_default', true)
      .eq('is_active', true)
      .single();
    
    if (error || !data?.content) {
      return null;
    }
    
    const rendered = renderTemplate(data.content, variables);
    return rendered;
  } catch (error) {
    console.error('Error in getGlobalMessageTemplate:', error);
    return null;
  }
}
```

### File: src/lib/cache.ts
```ts
/**
 * Caching utilities for improving performance
 * Provides in-memory caching strategy
 */

import { logger } from './logger'

// Cache key prefixes
const CACHE_PREFIXES = {
  EVENT: 'event:',
  CUSTOMER: 'customer:',
  EMPLOYEE: 'employee:',
  TEMPLATE: 'template:',
  STATS: 'stats:',
  CAPACITY: 'capacity:',
  PERMISSION: 'permission:',
} as const

// Default TTL values (in seconds)
const DEFAULT_TTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  DAY: 86400, // 24 hours
} as const

export type CachePrefix = keyof typeof CACHE_PREFIXES
export type CacheTTL = keyof typeof DEFAULT_TTL

/**
 * In-memory cache
 */
class InMemoryCache {
  private cache = new Map<string, { value: any; expires: number }>()
  
  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key)
    if (!item) return null
    
    if (Date.now() > item.expires) {
      this.cache.delete(key)
      return null
    }
    
    return item.value as T
  }
  
  async set(key: string, value: any, ttl: number): Promise<void> {
    const expires = Date.now() + (ttl * 1000)
    this.cache.set(key, { value, expires })
  }
  
  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }
  
  async flush(pattern?: string): Promise<void> {
    if (!pattern) {
      this.cache.clear()
      return
    }
    
    // Delete keys matching pattern
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }
  
  getSize(): number {
    return this.cache.size
  }
}

/**
 * Cache manager that handles in-memory caching
 */
export class CacheManager {
  private static instance: CacheManager
  private memoryCache: InMemoryCache
  
  private constructor() {
    this.memoryCache = new InMemoryCache()
  }
  
  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager()
    }
    return CacheManager.instance
  }
  
  /**
   * Build a cache key with proper namespacing
   */
  buildKey(prefix: CachePrefix, ...parts: (string | number)[]): string {
    return `${CACHE_PREFIXES[prefix]}${parts.join(':')}`
  }
  
  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    return await this.memoryCache.get<T>(key)
  }
  
  /**
   * Set a value in cache
   */
  async set(key: string, value: any, ttl: CacheTTL | number): Promise<void> {
    const ttlSeconds = typeof ttl === 'number' ? ttl : DEFAULT_TTL[ttl]
    await this.memoryCache.set(key, value, ttlSeconds)
  }
  
  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<void> {
    await this.memoryCache.delete(key)
  }
  
  /**
   * Flush cache by pattern
   */
  async flush(prefix?: CachePrefix): Promise<void> {
    const pattern = prefix ? CACHE_PREFIXES[prefix] : undefined
    await this.memoryCache.flush(pattern)
  }
  
  /**
   * Get or set pattern - fetch from cache or compute and cache
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: CacheTTL | number
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key)
    if (cached !== null) {
      return cached
    }
    
    // Compute value
    const value = await factory()
    
    // Cache it
    await this.set(key, value, ttl)
    
    return value
  }
  
  /**
   * Invalidate related cache entries
   */
  async invalidateRelated(entity: 'event' | 'customer' | 'employee', id?: string): Promise<void> {
    switch (entity) {
      case 'event':
        await this.flush('EVENT')
        await this.flush('CAPACITY')
        await this.flush('STATS')
        break
      case 'customer':
        if (id) {
          await this.delete(this.buildKey('CUSTOMER', id))
        }
        await this.flush('STATS')
        break
      case 'employee':
        if (id) {
          await this.delete(this.buildKey('EMPLOYEE', id))
        }
        break
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      memorySize: this.memoryCache.getSize(),
    }
  }
}

// Export singleton instance
export const cache = CacheManager.getInstance()

/**
 * Cache decorator for class methods
 */
export function Cacheable(prefix: CachePrefix, ttl: CacheTTL = 'MEDIUM') {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    
    descriptor.value = async function (...args: any[]) {
      // Build cache key from method name and arguments
      const key = cache.buildKey(prefix, propertyKey, ...args.map(a => JSON.stringify(a)))
      
      // Try to get from cache
      const cached = await cache.get(key)
      if (cached !== null) {
        return cached
      }
      
      // Call original method
      const result = await originalMethod.apply(this, args)
      
      // Cache the result
      await cache.set(key, result, ttl)
      
      return result
    }
    
    return descriptor
  }
}

// Import React hooks only on client side
let useState: typeof import('react')['useState']
let useEffect: typeof import('react')['useEffect']
let useCallback: typeof import('react')['useCallback']

if (typeof window !== 'undefined') {
  // Dynamic import for client-side only
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  useState = React.useState
  useEffect = React.useEffect
  useCallback = React.useCallback
}

/**
 * React hook for client-side caching
 */
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: CacheTTL = 'MEDIUM'
): { data: T | null; isLoading: boolean; error: Error | null; refresh: () => Promise<void> } {
  if (!useState || !useEffect || !useCallback) {
    throw new Error('useCachedData can only be used in client components')
  }
  
  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  
  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await cache.getOrSet(key, fetcher, ttl)
      setData(result)
    } catch (err) {
      setError(err as Error)
    } finally {
      setIsLoading(false)
    }
  }, [key, fetcher, ttl])
  
  useEffect(() => {
    fetchData()
  }, [fetchData])
  
  const refresh = useCallback(async () => {
    await cache.delete(key)
    await fetchData()
  }, [key, fetchData])
  
  return { data, isLoading, error, refresh }
}
```

### File: src/lib/dateUtils.ts
```ts
const LONDON_TIMEZONE = 'Europe/London'

function toDate(value: string | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value)
}

export function formatDateInLondon(
  date: string | Date,
  options?: Intl.DateTimeFormatOptions,
  locale: string = 'en-GB'
): string {
  const d = toDate(date)
  return d.toLocaleDateString(locale, { ...options, timeZone: LONDON_TIMEZONE })
}

export function formatDate(date: string | Date): string {
  const d = toDate(date)
  // Format as "January 15, 2024" (US format for legacy UI sections)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: LONDON_TIMEZONE
  })
}

export function getTodayIsoDate(): string {
  const now = new Date()
  const offsetMinutes = now.getTimezoneOffset()
  now.setMinutes(now.getMinutes() - offsetMinutes)
  return now.toISOString().split('T')[0]
}

export function toLocalIsoDate(date: Date): string {
  const copy = new Date(date.getTime())
  const offsetMinutes = copy.getTimezoneOffset()
  copy.setMinutes(copy.getMinutes() - offsetMinutes)
  return copy.toISOString().split('T')[0]
}

export function getLocalIsoDateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return toLocalIsoDate(date)
}

export function getLocalIsoDateDaysAhead(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalIsoDate(date)
}

export function formatDateFull(date: string | Date | null): string {
  if (!date) return 'To be confirmed'
  return formatDateInLondon(date, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export function formatTime12Hour(time: string | null): string {
  if (!time) return 'TBC'
  
  // Handle time in HH:MM format
  const [hours, minutes] = time.split(':').slice(0, 2).map(num => parseInt(num, 10))
  
  if (isNaN(hours) || isNaN(minutes)) return time
  
  const period = hours >= 12 ? 'pm' : 'am'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  
  // If minutes are 0, just show the hour (e.g., "7PM")
  // Otherwise show full time (e.g., "7:30PM")
  if (minutes === 0) {
    return `${displayHours}${period}`
  } else {
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`
  }
}

export function formatDateTime(date: string | Date): string {
  const d = toDate(date)
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: LONDON_TIMEZONE
  })
}

export function formatDateTime12Hour(date: string | Date): string {
  const d = toDate(date)
  const dateStr = d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: LONDON_TIMEZONE
  })

  const londonTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: LONDON_TIMEZONE
  })
    .format(d)
    .split(':')

  const [hours, minutes] = londonTime.length === 2 ? londonTime : ['00', '00']
  const timeStr = formatTime12Hour(`${hours}:${minutes}`)

  return `${dateStr} at ${timeStr}`
}

export function formatDateWithTimeForSms(date: string | Date, time?: string | null): string {
  const formattedDate = formatDateInLondon(date, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  if (!time) {
    return formattedDate
  }

  return `${formattedDate} at ${formatTime12Hour(time)}`
}

```

### File: src/lib/validation.ts
```ts
import { z } from 'zod';

// Phone number validation
export const ukPhoneRegex = /^\+44[1-9]\d{9}$/;
export const internationalPhoneRegex = /^\+[1-9]\d{1,14}$/;

export const phoneSchema = z.string()
  .regex(ukPhoneRegex, {
    message: 'Please enter a valid UK phone number (e.g., +447700900123)'
  })
  .or(z.literal('')) // Allow empty
  .or(z.null())
  .optional();

export const requiredPhoneSchema = z.string()
  .regex(ukPhoneRegex, {
    message: 'Please enter a valid UK phone number (e.g., +447700900123)'
  });

// Date validation
export const futureDateSchema = z.string()
  .refine((date) => {
    const inputDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return inputDate >= today;
  }, {
    message: 'Date must be today or in the future'
  });

export const pastDateSchema = z.string()
  .refine((date) => {
    const inputDate = new Date(date);
    const today = new Date();
    return inputDate <= today;
  }, {
    message: 'Date cannot be in the future'
  });

// Email validation
export const emailSchema = z.string()
  .email('Please enter a valid email address')
  .min(1, 'Email is required');

export const optionalEmailSchema = z
  .string()
  .trim()
  .email('Please enter a valid email address')
  .max(255, 'Email is too long')
  .optional();

// Name validation
export const nameSchema = z.string()
  .min(1, 'Name is required')
  .max(100, 'Name is too long')
  .regex(/^[a-zA-Z\s\-']+$/, 'Name contains invalid characters');

// Common schemas
export const customerSchema = z.object({
  first_name: nameSchema,
  last_name: nameSchema.optional(),
  mobile_number: phoneSchema,
  email: optionalEmailSchema,
  sms_opt_in: z.boolean().default(false),
});

export const eventSchema = z.object({
  name: z.string().min(1, 'Event name is required'),
  date: futureDateSchema,
  time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
  capacity: z.number().min(1, 'Capacity must be at least 1').max(500),
  category_id: z.string().uuid().optional(),
});

export const bookingSchema = z.object({
  event_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  seats: z.number().min(1, 'At least 1 ticket required').max(20, 'Maximum 20 tickets per booking'),
});

// Helper functions
export function formatPhoneForDisplay(phone: string | null): string {
  if (!phone) return '';
  // Convert +447700900123 to 07700 900123
  if (phone.startsWith('+44')) {
    const number = phone.slice(3);
    return `0${number.slice(0, 4)} ${number.slice(4)}`;
  }
  return phone;
}

export function formatPhoneForStorage(phone: string): string {
  if (!phone) return '';
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // UK mobile starting with 07
  if (digits.startsWith('07') && digits.length === 11) {
    return `+44${digits.slice(1)}`;
  }
  
  // Already has country code
  if (digits.startsWith('44') && digits.length === 12) {
    return `+${digits}`;
  }
  
  // Invalid format
  throw new Error('Invalid UK phone number format');
}

// Sanitization helpers
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML
    .slice(0, 1000); // Limit length
}

export function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z\s\-']/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

// Receipts workspace
export const receiptTransactionStatusSchema = z.enum([
  'pending',
  'completed',
  'auto_completed',
  'no_receipt_required',
  'cant_find',
]);

export const receiptClassificationSourceSchema = z.enum(['ai', 'manual', 'rule', 'import']);

export const receiptExpenseCategorySchema = z.enum([
  'Total Staff',
  'Business Rate',
  'Water Rates',
  'Heat/Light/Power',
  'Premises Repairs/Maintenance',
  'Equipment Repairs/Maintenance',
  'Gardening Expenses',
  'Buildings Insurance',
  'Maintenance and Service Plan Charges',
  'Licensing',
  'Tenant Insurance',
  'Entertainment',
  'Sky / PRS / Vidimix',
  'Marketing/Promotion/Advertising',
  'Print/Post Stationary',
  'Telephone',
  'Travel/Car',
  'Waste Disposal/Cleaning/Hygiene',
  'Third Party Booking Fee',
  'Accountant/StockTaker/Professional Fees',
  'Bank Charges/Credit Card Commission',
  'Equipment Hire',
  'Sundries/Consumables',
  'Drinks Gas',
]);

export const receiptRuleDirectionSchema = z.enum(['in', 'out', 'both']);

export const receiptRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required').max(120, 'Keep the name under 120 characters'),
  description: z.string().trim().max(500).optional(),
  match_description: z.string().trim().max(300).optional(),
  match_transaction_type: z.string().trim().max(120).optional(),
  match_direction: receiptRuleDirectionSchema.default('both'),
  match_min_amount: z.number().nonnegative().optional(),
  match_max_amount: z.number().nonnegative().optional(),
  auto_status: receiptTransactionStatusSchema.default('no_receipt_required'),
  set_vendor_name: z.string().trim().max(120).optional(),
  set_expense_category: receiptExpenseCategorySchema.optional(),
}).refine((data) => {
  if (data.match_min_amount != null && data.match_max_amount != null) {
    return data.match_min_amount <= data.match_max_amount;
  }
  return true;
}, {
  path: ['match_max_amount'],
  message: 'Max amount must be greater than or equal to min amount',
});

export const receiptMarkSchema = z.object({
  transaction_id: z.string().uuid('Transaction reference is invalid'),
  status: receiptTransactionStatusSchema,
  note: z.string().trim().max(500).optional(),
  receipt_required: z.boolean().optional(),
});

export const receiptQuarterExportSchema = z.object({
  year: z.number().int().min(2020, 'Select a realistic year').max(2100),
  quarter: z.number().int().min(1).max(4),
});

```

### File: src/lib/utils.ts
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes'; // Changed from bytes === 0 to !+bytes to handle null/undefined/NaN

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function generatePhoneVariants(phone: string): string[] {
  const variants = [phone];
  
  // Clean the phone number - remove all non-digits except leading +
  const cleaned = phone.replace(/[^\d+]/g, '').replace(/\+/g, (match, offset) => offset === 0 ? match : '');
  const digitsOnly = cleaned.replace(/^\+/, '');
  
  // UK number handling
  if (cleaned.startsWith('+44') && digitsOnly.length >= 12) {
    const ukNumber = digitsOnly.substring(2); // Remove 44 from the digits
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (digitsOnly.startsWith('44') && digitsOnly.length >= 12) {
    const ukNumber = digitsOnly.substring(2); // Remove 44
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    const ukNumber = digitsOnly.substring(1); // Remove 0
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  }
  
  // Also add the cleaned version if different from original
  if (cleaned !== phone) {
    variants.push(cleaned);
  }
  
  return [...new Set(variants)];
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

export function formatPhoneForStorage(phone: string): string {
  // Clean the phone number - remove all non-digits except leading +
  const cleaned = phone.replace(/[^\d+]/g, '').replace(/\+/g, (match, offset) => offset === 0 ? match : '');
  const digitsOnly = cleaned.replace(/^\+/, '');
  
  // Convert UK numbers to E164 format
  if (digitsOnly.startsWith('44') && digitsOnly.length >= 12) {
    return '+' + digitsOnly;
  } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    // UK number starting with 0
    return '+44' + digitsOnly.substring(1);
  } else if (cleaned.startsWith('+')) {
    return cleaned;
  } else {
    // Default to adding UK code if no country code
    return '+44' + digitsOnly.replace(/^0/, '');
  }
}

export function sanitizeMoneyString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = typeof value === 'number' ? value.toString() : String(value)
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalised = trimmed.replace(/,/g, '')
  const match = normalised.match(/-?\d+(?:\.\d+)?/)
  return match ? match[0] : null
}

```

## SMS Delivery, Logging, and Status Handling

### File: src/lib/twilio.ts
```ts
import twilio from 'twilio';
import { retry, RetryConfigs } from './retry';
import { logger } from './logger';
import { TWILIO_STATUS_CALLBACK, TWILIO_STATUS_CALLBACK_METHOD, env } from './env';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { recordOutboundSmsMessage } from '@/lib/sms/logging';
import { createAdminClient } from '@/lib/supabase/admin';

const accountSid = env.TWILIO_ACCOUNT_SID;
const authToken = env.TWILIO_AUTH_TOKEN;
const fromNumber = env.TWILIO_PHONE_NUMBER;
const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;

export const twilioClient = twilio(accountSid, authToken);

export type SendSMSOptions = {
  customerId?: string;
  metadata?: Record<string, unknown>;
  createCustomerIfMissing?: boolean; // Default true
  customerFallback?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

export const sendSMS = async (to: string, body: string, options: SendSMSOptions = {}) => {
  try {
    // Build message parameters
    const messageParams: any = {
      body,
      to,
      statusCallback: TWILIO_STATUS_CALLBACK,
      statusCallbackMethod: TWILIO_STATUS_CALLBACK_METHOD,
    };

    // Use messaging service if configured, otherwise use from number
    if (messagingServiceSid) {
      messageParams.messagingServiceSid = messagingServiceSid;
    } else {
      messageParams.from = fromNumber;
    }

    // Send SMS with retry logic
    const message = await retry(
      async () => {
        return await twilioClient.messages.create(messageParams);
      },
      {
        ...RetryConfigs.sms,
        onRetry: (error, attempt) => {
          logger.warn(`SMS send retry attempt ${attempt}`, {
            error,
            metadata: { to, bodyLength: body.length }
          });
        }
      }
    );
    
    const segments = Math.ceil(body.length / 160);

    logger.info('SMS sent successfully', {
      metadata: { 
        to, 
        messageSid: message.sid,
        segments
      }
    });

    // AUTOMATIC LOGGING
    let messageId: string | null = null;
    let usedCustomerId: string | undefined = options.customerId;

    try {
      const supabase = createAdminClient();

      // If no customerId, try to resolve/create
      if (!usedCustomerId) {
        const { customerId: resolvedId } = await ensureCustomerForPhone(
          supabase, 
          to, 
          options.customerFallback
        );
        usedCustomerId = resolvedId ?? undefined;
      }

      if (usedCustomerId) {
          messageId = await recordOutboundSmsMessage({
          supabase,
          customerId: usedCustomerId,
          to,
          body,
          sid: message.sid,
          fromNumber: message.from ?? fromNumber ?? null,
          status: message.status ?? 'queued',
          twilioStatus: message.status ?? 'queued',
          metadata: options.metadata,
          segments,
          // Approximate cost if not provided by API immediately (usually it isn't)
          costUsd: segments * 0.04 
        });
      } else {
        logger.warn('SMS sent but could not resolve customer for logging', {
            metadata: { to, sid: message.sid }
        });
      }
    } catch (logError: unknown) {
      const error = logError instanceof Error ? logError : new Error(String(logError));
      logger.error('Failed to automatically log outbound SMS', {
        error,
        metadata: { to, sid: message.sid }
      });
    }
    
    return { 
      success: true, 
      sid: message.sid, 
      fromNumber: message.from ?? null, 
      status: message.status ?? 'queued',
      messageId,
      customerId: usedCustomerId
    };
  } catch (error: any) {
    logger.error('Failed to send SMS after retries', {
      error,
      metadata: { to, errorCode: error.code }
    });

    // Record failed attempt so downstream logic can enforce failure limits
    try {
      const failureSid = `local-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await recordOutboundSmsMessage({
        to,
        body,
        sid: failureSid,
        customerId: options.customerId,
        status: 'failed',
        twilioStatus: String(error.code ?? 'failed'),
        metadata: {
          error_code: error.code,
          error_message: error.message
        }
      })
    } catch (logError: unknown) {
      logger.error('Failed to log outbound SMS failure', {
        error: logError instanceof Error ? logError : new Error(String(logError)),
        metadata: { to }
      })
    }
    
    // Provide user-friendly error messages
    let userMessage = 'Failed to send message';
    if (error.code === 21211) {
      userMessage = 'Invalid phone number format';
    } else if (error.code === 21610) {
      userMessage = 'This number has opted out of messages';
    } else if (error.code === 20429) {
      userMessage = 'Too many messages sent. Please try again later';
    }
    
    return { success: false, error: userMessage, code: error.code };
  }
};

```

### File: src/lib/sms/support.ts
```ts
export function ensureReplyInstruction(message: string, phone?: string | null): string {
  const trimmed = message.trim()
  if (trimmed.length === 0) {
    return trimmed
  }

  const lower = trimmed.toLowerCase()
  if (lower.includes('reply to this message')) {
    return trimmed
  }

  const cleanedPhone = phone?.trim()
  const suffix = cleanedPhone
    ? `Reply to this message if you need any help or call ${cleanedPhone}.`
    : 'Reply to this message if you need any help.'

  const needsPunctuation = !/[.!?]$/.test(trimmed)
  const combined = needsPunctuation ? `${trimmed}. ${suffix}` : `${trimmed} ${suffix}`

  return combined.replace(/\s+/g, ' ').trim()
}

```

### File: src/lib/sms/logging.ts
```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { SupabaseClient } from '@supabase/supabase-js'

type RecordOutboundSmsParams = {
  supabase?: SupabaseClient<any, 'public', any>
  customerId?: string | null
  to: string
  body: string
  sid: string
  fromNumber?: string | null
  status?: string
  twilioStatus?: string
  metadata?: Record<string, unknown> | null
  segments?: number
  costUsd?: number
  sentAt?: string | null
  readAt?: string | null
}

/**
 * Persist an outbound SMS in the central `messages` table so it appears in customer timelines.
 * Falls back gracefully if no customer id is available.
 */
export async function recordOutboundSmsMessage(params: RecordOutboundSmsParams): Promise<string | null> {
  const {
    supabase,
    customerId,
    to,
    body,
    sid,
    fromNumber,
    status = 'sent',
    twilioStatus = 'queued',
    metadata = null,
    segments,
    costUsd,
    sentAt,
    readAt,
  } = params

  if (!customerId) {
    logger.debug('Skipping SMS log – no customer id provided', {
      metadata: { sid, to }
    })
    return null
  }

  const client = supabase ?? createAdminClient()

  const computedSegments = segments ?? (body.length <= 160 ? 1 : Math.ceil(body.length / 153))
  const computedCostUsd = costUsd ?? computedSegments * 0.04

  const insertPayload: Record<string, unknown> = {
    customer_id: customerId,
    direction: 'outbound',
    message_sid: sid,
    twilio_message_sid: sid,
    body,
    status,
    twilio_status: twilioStatus,
    from_number: fromNumber ?? process.env.TWILIO_PHONE_NUMBER ?? null,
    to_number: to,
    message_type: 'sms',
    segments: computedSegments,
    cost_usd: computedCostUsd,
    sent_at: sentAt ?? new Date().toISOString(),
    read_at: readAt ?? new Date().toISOString(),
  }

  if (metadata !== null && metadata !== undefined) {
    insertPayload.metadata = metadata
  }

  try {
    const { data, error } = await client
      .from('messages')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      // Fallback: retry without metadata if the column is missing (legacy schema)
      const isMetadataMissing =
        insertPayload.metadata !== undefined &&
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as any).message === 'string' &&
        (error as any).message.toLowerCase().includes("'metadata'")

      if (isMetadataMissing) {
        const { metadata: _removed, ...withoutMetadata } = insertPayload

        const { data: fallbackData, error: fallbackError } = await client
          .from('messages')
          .insert(withoutMetadata)
          .select('id')
          .single()

        if (fallbackError) {
          throw fallbackError
        }

        return fallbackData?.id ?? null
      }

      throw error
    }

    return data?.id ?? null
  } catch (error) {
    logger.error('Failed to record outbound SMS message', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId, sid }
    })
    return null
  }
}

```

### File: src/lib/sms/customers.ts
```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import type { SupabaseClient } from '@supabase/supabase-js'

type CustomerFallback = {
  firstName?: string
  lastName?: string
  email?: string | null
}

type ResolvedCustomerResult = {
  customerId: string | null
  standardizedPhone?: string | null
}

function deriveNameParts(fullName?: string | null): CustomerFallback {
  if (!fullName) {
    return {}
  }

  const parts = fullName
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return {}
  }

  const [firstName, ...rest] = parts
  const lastName = rest.length > 0 ? rest.join(' ') : undefined

  return {
    firstName,
    lastName
  }
}

export async function ensureCustomerForPhone(
  supabase: SupabaseClient<any, 'public', any> | undefined,
  phone: string | null | undefined,
  fallback: CustomerFallback = {}
): Promise<ResolvedCustomerResult> {
  if (!phone) {
    return { customerId: null, standardizedPhone: null }
  }

  const client = supabase ?? createAdminClient()

  try {
    const standardizedPhone = formatPhoneForStorage(phone)
    const variants = generatePhoneVariants(standardizedPhone)
    const numbersToMatch = variants.length > 0 ? variants : [standardizedPhone]

    const { data: existingMatches, error: lookupError } = await client
      .from('customers')
      .select('id')
      .in('mobile_number', numbersToMatch)
      .order('created_at', { ascending: true })
      .limit(1)

    if (lookupError) {
      console.error('Failed to look up customer for SMS logging:', lookupError)
    }

    if (existingMatches && existingMatches.length > 0) {
      return { customerId: existingMatches[0].id, standardizedPhone }
    }

    const sanitizedFirstName = fallback.firstName?.trim()
    const sanitizedLastName = fallback.lastName?.trim()

    const fallbackFirstName = sanitizedFirstName && sanitizedFirstName.length > 0
      ? sanitizedFirstName
      : 'Unknown'

    let fallbackLastName = sanitizedLastName && sanitizedLastName.length > 0
      ? sanitizedLastName
      : null

    if (!fallbackLastName) {
      const digits = standardizedPhone.replace(/\D/g, '')
      fallbackLastName = digits.length >= 4 ? digits.slice(-4) : 'Contact'
    }

    const insertPayload = {
      first_name: fallbackFirstName,
      last_name: fallbackLastName,
      mobile_number: standardizedPhone,
      email: fallback.email ?? null,
      sms_opt_in: true
    }

    const { data: inserted, error: insertError } = await client
      .from('customers')
      .insert(insertPayload)
      .select('id')
      .single()

    if (insertError) {
      if ((insertError as any)?.code === '23505') {
        const { data: conflictMatches } = await client
          .from('customers')
          .select('id')
          .in('mobile_number', numbersToMatch)
          .order('created_at', { ascending: true })
          .limit(1)

        if (conflictMatches && conflictMatches.length > 0) {
          return { customerId: conflictMatches[0].id, standardizedPhone }
        }
      }

      console.error('Failed to create customer for SMS logging:', insertError)
      return { customerId: null, standardizedPhone }
    }

    return { customerId: inserted?.id ?? null, standardizedPhone }
  } catch (error) {
    console.error('Failed to resolve customer for phone:', error)
    return { customerId: null, standardizedPhone: null }
  }
}

export async function resolveCustomerIdForSms(
  supabase: SupabaseClient<any, 'public', any>,
  params: { bookingId?: string; customerId?: string; to: string }
): Promise<{ customerId: string | null }> {
  if (params.customerId) {
    return { customerId: params.customerId }
  }

  let bookingContext:
    | { type: 'private'; record: any }
    | { type: 'table'; record: any }
    | null = null

  if (params.bookingId) {
    const { data: privateBooking } = await supabase
      .from('private_bookings')
      .select(
        'id, customer_id, contact_phone, customer_first_name, customer_last_name, customer_name, contact_email'
      )
      .eq('id', params.bookingId)
      .maybeSingle()

    if (privateBooking) {
      if (privateBooking.customer_id) {
        return { customerId: privateBooking.customer_id }
      }

      bookingContext = { type: 'private', record: privateBooking }
    } else {
      const { data: tableBooking } = await supabase
        .from('table_bookings')
        .select(
          'id, customer_id, customer:customers(id, first_name, last_name, email, mobile_number)'
        )
        .eq('id', params.bookingId)
        .maybeSingle()

      if (tableBooking) {
        const customerRecord = Array.isArray(tableBooking.customer) ? tableBooking.customer[0] : tableBooking.customer
        const linkedCustomerId = tableBooking.customer_id || customerRecord?.id
        if (linkedCustomerId) {
          return { customerId: linkedCustomerId }
        }

        bookingContext = { type: 'table', record: { ...tableBooking, customer: customerRecord } }
      }
    }
  }

  const bookingRecord = bookingContext?.record
  const nameFallback = bookingRecord?.customer_first_name || bookingRecord?.customer?.first_name
    ? {
        firstName: bookingRecord.customer_first_name || bookingRecord.customer?.first_name,
        lastName: bookingRecord.customer_last_name || bookingRecord.customer?.last_name || undefined
      }
    : deriveNameParts(bookingRecord?.customer_name)

  const fallbackInfo: CustomerFallback = {
    firstName: nameFallback?.firstName,
    lastName: nameFallback?.lastName,
    email: bookingRecord?.contact_email || bookingRecord?.customer?.email || null
  }

  const phoneToUse = bookingRecord?.contact_phone || bookingRecord?.customer?.mobile_number || params.to

  const { customerId } = await ensureCustomerForPhone(supabase, phoneToUse, fallbackInfo)

  if (customerId && bookingContext) {
    try {
      if (bookingContext.type === 'private') {
        const displayName = fallbackInfo.lastName
          ? `${fallbackInfo.firstName} ${fallbackInfo.lastName}`.trim()
          : fallbackInfo.firstName

        await supabase
          .from('private_bookings')
          .update({
            customer_id: customerId,
            customer_name: displayName || null
          })
          .eq('id', bookingContext.record.id)
      } else if (bookingContext.type === 'table') {
        await supabase
          .from('table_bookings')
          .update({ customer_id: customerId })
          .eq('id', bookingContext.record.id)
      }
    } catch (updateError) {
      console.error('Failed to link booking to customer:', updateError)
    }
  }

  return { customerId }
}

```

### File: src/lib/sms-status.ts
```ts
/**
 * SMS Status Management
 * Handles mapping between Twilio statuses and our application statuses
 * Includes progression guard to prevent status regression
 */

// Twilio's possible message statuses
export type TwilioStatus =
  | 'accepted'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'canceled'
  | 'scheduled'
  | 'receiving'
  | 'received'
  | 'read';

// Our simplified application statuses
export type AppStatus = 
  | 'queued'
  | 'sent' 
  | 'delivered'
  | 'failed'
  | 'received'
  | 'delivery_unknown';

// Map Twilio status to our simplified status
export const STATUS_MAP: Record<TwilioStatus, AppStatus> = {
  accepted: 'queued',
  queued: 'queued',
  sending: 'sent',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'failed',
  failed: 'failed',
  canceled: 'failed',
  scheduled: 'queued',
  receiving: 'received',
  received: 'received',
  read: 'received',
};

// Status progression order (higher number = more final)
const STATUS_ORDER: Record<string, number> = {
  // Outbound progression
  accepted: 0,
  queued: 1,
  scheduled: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  
  // Terminal states (same level, no progression between them)
  undelivered: 4,
  failed: 4,
  canceled: 4,
  
  // Inbound states
  receiving: 4,
  received: 5,
  read: 6,
};

/**
 * Map Twilio status to our application status
 */
export function mapTwilioStatus(twilioStatus: string): AppStatus {
  const status = twilioStatus.toLowerCase() as TwilioStatus;
  return STATUS_MAP[status] || 'queued';
}

/**
 * Check if a status transition is valid (prevents regression)
 * @param currentStatus - Current status in database
 * @param newStatus - New status from webhook
 * @returns true if the transition is allowed
 */
export function isStatusUpgrade(currentStatus?: string, newStatus?: string): boolean {
  if (!currentStatus || !newStatus) return true;
  
  const currentOrder = STATUS_ORDER[currentStatus.toLowerCase()] ?? -1;
  const newOrder = STATUS_ORDER[newStatus.toLowerCase()] ?? -1;
  
  return newOrder >= currentOrder;
}

/**
 * Determine if a message should be considered "delivery unknown"
 * Messages stuck in 'sent' for over 6 hours without delivery confirmation
 */
export function shouldMarkDeliveryUnknown(status: string, sentAt: Date | string): boolean {
  if (status !== 'sent') return false;
  
  const sentTime = typeof sentAt === 'string' ? new Date(sentAt) : sentAt;
  const hoursSinceSent = (Date.now() - sentTime.getTime()) / (1000 * 60 * 60);
  
  return hoursSinceSent > 6;
}

/**
 * Format error code to user-friendly message
 */
export function formatErrorMessage(errorCode?: string | number | null): string {
  if (!errorCode) return 'Message delivery failed';
  
  const code = errorCode.toString();
  
  // Common Twilio error codes
  const ERROR_MESSAGES: Record<string, string> = {
    '21211': 'Invalid phone number format',
    '21408': 'Permission to send to this region denied',
    '21610': 'Recipient has opted out of messages',
    '21611': 'SMS queued but cannot be sent',
    '21614': 'Invalid mobile number',
    '21617': 'Message body missing or invalid',
    '30003': 'Unreachable - device may be off or out of coverage',
    '30004': 'Message blocked by carrier',
    '30005': 'Unknown destination',
    '30006': 'Landline or unreachable carrier',
    '30007': 'Carrier violation - message filtered',
    '30008': 'Unknown error from carrier',
    '30034': 'Carrier temporarily unavailable',
  };
  
  return ERROR_MESSAGES[code] || `Delivery failed (Error ${code})`;
}

/**
 * Check if a message is stuck and needs reconciliation
 */
export function isMessageStuck(status: string, createdAt: Date | string, direction: string = 'outbound'): boolean {
  // Only check outbound messages
  if (direction !== 'outbound' && direction !== 'outbound-api') return false;
  
  // Only queued and sent statuses can be "stuck"
  if (status !== 'queued' && status !== 'sent') return false;
  
  const createdTime = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const hoursSinceCreated = (Date.now() - createdTime.getTime()) / (1000 * 60 * 60);
  
  // Consider stuck if:
  // - Queued for more than 1 hour
  // - Sent for more than 2 hours
  if (status === 'queued' && hoursSinceCreated > 1) return true;
  if (status === 'sent' && hoursSinceCreated > 2) return true;
  
  return false;
}
```

### File: src/lib/retry.ts
```ts
import { logger } from './logger'

export interface RetryOptions {
  maxAttempts?: number
  delay?: number
  backoff?: 'linear' | 'exponential'
  factor?: number
  maxDelay?: number
  onRetry?: (error: Error, attempt: number) => void
  retryIf?: (error: Error) => boolean
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delay: 1000,
  backoff: 'exponential',
  factor: 2,
  maxDelay: 30000,
  onRetry: () => {},
  retryIf: () => true
}

/**
 * Retry a function with configurable backoff strategy
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      // Check if we should retry
      if (!opts.retryIf(lastError)) {
        throw lastError
      }
      
      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) {
        throw lastError
      }
      
      // Calculate delay
      let delay = opts.delay
      if (opts.backoff === 'exponential') {
        delay = Math.min(
          opts.delay * Math.pow(opts.factor, attempt - 1),
          opts.maxDelay
        )
      }
      
      // Log retry attempt
      logger.warn(`Retry attempt ${attempt}/${opts.maxAttempts}`, {
        error: lastError,
        metadata: { delay, operation: fn.name || 'anonymous' }
      })
      
      // Call onRetry callback
      opts.onRetry(lastError, attempt)
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError!
}

/**
 * Retry decorator for class methods
 */
export function Retryable(options: RetryOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    
    descriptor.value = async function (...args: any[]) {
      return retry(() => originalMethod.apply(this, args), options)
    }
    
    return descriptor
  }
}

/**
 * Common retry configurations
 */
export const RetryConfigs = {
  // For database operations
  database: {
    maxAttempts: 3,
    delay: 100,
    backoff: 'exponential' as const,
    factor: 2,
    retryIf: (error: Error) => {
      // Retry on connection errors or deadlocks
      const message = error.message.toLowerCase()
      return message.includes('connection') ||
             message.includes('deadlock') ||
             message.includes('timeout')
    }
  },
  
  // For external API calls
  api: {
    maxAttempts: 5,
    delay: 1000,
    backoff: 'exponential' as const,
    factor: 2,
    maxDelay: 30000,
    retryIf: (error: any) => {
      // Retry on network errors or 5xx status codes
      if (error.code === 'ECONNREFUSED' || 
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND') {
        return true
      }
      
      // Retry on server errors (5xx) but not client errors (4xx)
      if (error.status && error.status >= 500) {
        return true
      }
      
      return false
    }
  },
  
  // For SMS operations
  sms: {
    maxAttempts: 3,
    delay: 2000,
    backoff: 'exponential' as const,
    factor: 2,
    retryIf: (error: any) => {
      // Don't retry on invalid phone numbers or opt-outs
      if (error.code === 21211 || // Invalid phone number
          error.code === 21610) {  // Opt-out
        return false
      }
      
      // Retry on rate limits or server errors
      if (error.code === 20429 || // Rate limit
          error.status >= 500) {
        return true
      }
      
      return true
    }
  },
  
  // For file operations
  file: {
    maxAttempts: 3,
    delay: 500,
    backoff: 'linear' as const,
    retryIf: (error: any) => {
      // Retry on temporary file system errors
      return error.code === 'EBUSY' ||
             error.code === 'EMFILE' ||
             error.code === 'ENFILE'
    }
  }
}

/**
 * Circuit breaker pattern for protecting failing services
 */
export class CircuitBreaker {
  private failures = 0
  private lastFailTime?: number
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailTime! > this.timeout) {
        this.state = 'half-open'
      } else {
        throw new Error('Circuit breaker is open')
      }
    }
    
    try {
      const result = await fn()
      
      // Reset on success
      if (this.state === 'half-open') {
        this.state = 'closed'
        this.failures = 0
      }
      
      return result
    } catch (error) {
      this.failures++
      this.lastFailTime = Date.now()
      
      if (this.failures >= this.threshold) {
        this.state = 'open'
        logger.error('Circuit breaker opened', {
          error: error as Error,
          metadata: { failures: this.failures }
        })
      }
      
      throw error
    }
  }
  
  reset() {
    this.state = 'closed'
    this.failures = 0
    this.lastFailTime = undefined
  }
}
```

### File: src/app/api/webhooks/twilio/route.ts
```ts
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs'
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { retry, RetryConfigs } from '@/lib/retry';
import { logger } from '@/lib/logger';
import { mapTwilioStatus, isStatusUpgrade, formatErrorMessage } from '@/lib/sms-status';
import { skipTwilioSignatureValidation } from '@/lib/env';

// Create public Supabase client for logging (no auth required)
function getPublicSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'x-client-info': 'supabase-anon-webhook'
      }
    }
  })
}

// Log webhook attempt to database
async function logWebhookAttempt(
  client: ReturnType<typeof createClient>,
  status: string,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>,
  error?: string,
  errorDetails?: unknown,
  additionalData?: Record<string, unknown>
) {
  try {
    const logEntry = {
      webhook_type: 'twilio',
      status,
      headers,
      body: body.substring(0, 10000), // Limit body size
      params,
      error_message: error,
      error_details: errorDetails,
      message_sid: params.MessageSid || params.SmsSid,
      from_number: params.From,
      to_number: params.To,
      message_body: params.Body?.substring(0, 1000), // Limit message size
      ...additionalData
    };
    
    const { error: logError } = await (client
      .from('webhook_logs') as any)
      .insert(logEntry);
      
    if (logError) {
      console.error('Failed to log webhook attempt:', logError);
    }
  } catch (e) {
    console.error('Exception while logging webhook:', e);
  }
}

// Verify Twilio webhook signature
function verifyTwilioSignature(request: NextRequest, body: string): boolean {
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioAuthToken) {
    console.error('TWILIO_AUTH_TOKEN not configured');
    return false;
  }

  const twilioSignature = request.headers.get('X-Twilio-Signature');
  if (!twilioSignature) {
    console.error('Missing X-Twilio-Signature header');
    return false;
  }

  // Construct the full URL
  const url = request.url;
  
  // Parse form data for validation
  const params = new URLSearchParams(body);
  const paramsObject: Record<string, string> = {};
  params.forEach((value, key) => {
    paramsObject[key] = value;
  });

  // Verify the signature
  return twilio.validateRequest(
    twilioAuthToken,
    twilioSignature,
    url,
    paramsObject
  );
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('=== TWILIO WEBHOOK START ===');
  console.log('Time:', new Date().toISOString());
  
  // Initialize variables for logging
  let body = '';
  let headers: Record<string, string> = {};
  const params: Record<string, string> = {};
  let publicClient: any = null;
  let adminClient: any = null;
  
  try {
    // Get headers
    headers = Object.fromEntries(request.headers.entries());
    console.log('Headers received:', headers);
    
    
    // Get public client for logging
    publicClient = getPublicSupabaseClient();
    if (!publicClient) {
      console.error('Failed to create public Supabase client');
    }
    
    // Get body
    body = await request.text();
    console.log('Body length:', body.length);
    console.log('Body preview:', body.substring(0, 200));
    
    // Parse parameters
    const formData = new URLSearchParams(body);
    formData.forEach((value, key) => {
      params[key] = value;
    });
    console.log('Parsed params:', params);
    
    // Log the initial webhook receipt
    if (publicClient) {
      await logWebhookAttempt(publicClient, 'received', headers, body, params);
    }
    
    // Always verify signature unless explicitly disabled (NEVER disable in production)
    const skipValidation = skipTwilioSignatureValidation();
    
    if (!skipValidation) {
      const isValid = verifyTwilioSignature(request, body);
      console.log('Signature validation result:', isValid);
      console.log('Auth token configured:', !!process.env.TWILIO_AUTH_TOKEN);
      console.log('Signature header present:', !!headers['x-twilio-signature']);
      
      if (!isValid) {
        console.error('Invalid webhook signature');
        console.error('Request URL:', request.url);
        console.error('Headers:', headers);
        
        if (publicClient) {
          await logWebhookAttempt(publicClient, 'signature_failed', headers, body, params, 'Invalid Twilio signature', {
            url: request.url,
            authTokenConfigured: !!process.env.TWILIO_AUTH_TOKEN,
            signaturePresent: !!headers['x-twilio-signature']
          });
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.warn('⚠️ Skipping Twilio signature validation - ONLY for local development/testing');
    }
    
    // Get admin client for database operations
    adminClient = createAdminClient();
    
    // Determine webhook type and process
    if (params.Body && params.From && params.To) {
      console.log('Detected INBOUND SMS');
      return await handleInboundSMS(publicClient, adminClient, headers, body, params);
    } else if (params.MessageStatus || params.SmsStatus) {
      console.log('Detected STATUS UPDATE');
      return await handleStatusUpdate(publicClient, adminClient, headers, body, params);
    } else {
      console.log('Unknown webhook type');
      if (publicClient) {
        await logWebhookAttempt(publicClient, 'unknown_type', headers, body, params, 'Could not determine webhook type');
      }
      return NextResponse.json({ success: true, message: 'Unknown webhook type' });
    }
    
  } catch (error: any) {
    console.error('=== WEBHOOK ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    // Try to log the error
    if (publicClient) {
      await logWebhookAttempt(
        publicClient, 
        'exception', 
        headers, 
        body, 
        params, 
        error.message, 
        { stack: error.stack, name: error.name }
      );
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    const duration = Date.now() - startTime;
    console.log(`=== WEBHOOK END (${duration}ms) ===`);
  }
}

async function handleInboundSMS(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  console.log('=== PROCESSING INBOUND SMS ===');
  
  try {
    const messageBody = params.Body.trim();
    const fromNumber = params.From;
    const toNumber = params.To;
    const messageSid = params.MessageSid || params.SmsSid;
    
    console.log('Message details:', { from: fromNumber, to: toNumber, sid: messageSid, bodyLength: messageBody.length });
    
    // Look up or create customer
    let customer;
    
    // Try to find existing customer
    const phoneVariants = generatePhoneVariants(fromNumber);
    console.log('Searching for customer with phone variants:', phoneVariants);
    
    const orConditions = phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(',');
    const { data: customers, error: customerError } = await adminClient
      .from('customers')
      .select('*')
      .or(orConditions)
      .limit(1);
    
    if (customerError) {
      throw new Error(`Customer lookup failed: ${customerError.message}`);
    }
    
    if (!customers || customers.length === 0) {
      console.log('No existing customer found, creating new one');
      
      // Create new customer with retry
      const { data: newCustomer, error: createError } = await retry(
        async () => {
          return await adminClient
            .from('customers')
            .insert({
              first_name: 'Unknown',
              last_name: `(${fromNumber})`,
              mobile_number: fromNumber,
              sms_opt_in: true
            })
            .select()
            .single();
        },
        {
          ...RetryConfigs.database,
          onRetry: (error, attempt) => {
            logger.warn(`Retry creating customer for webhook`, {
              error,
              metadata: { attempt, fromNumber }
            });
          }
        }
      );
      
      if (createError) {
        throw new Error(`Failed to create customer: ${createError.message}`);
      }
      
      customer = newCustomer;
      console.log('Created new customer:', customer.id);
    } else {
      customer = customers[0];
      console.log('Found existing customer:', customer.id);
    }
    
    // Check for opt-out keywords
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'];
    const messageUpper = messageBody.toUpperCase();
    const isOptOut = stopKeywords.some(keyword => messageUpper === keyword || messageUpper.startsWith(keyword + ' '));
    
    if (isOptOut) {
      console.log('Processing opt-out request');
      const { error: optOutError } = await adminClient
        .from('customers')
        .update({ sms_opt_in: false })
        .eq('id', customer.id);
      
      if (optOutError) {
        console.error('Failed to update opt-out status:', optOutError);
      }
    }
    
    // Save the message
    const messageData = {
      customer_id: customer.id,
      direction: 'inbound' as const,
      message_sid: messageSid,
      twilio_message_sid: messageSid,
      body: messageBody,
      status: 'received',
      twilio_status: 'received',
      from_number: fromNumber,
      to_number: toNumber,
      message_type: 'sms'
    };
    
    console.log('Saving message with data:', messageData);
    
    const { data: savedMessage, error: messageError } = await retry(
      async () => {
        return await adminClient
          .from('messages')
          .insert(messageData)
          .select()
          .single();
      },
      {
        ...RetryConfigs.database,
        onRetry: (error, attempt) => {
          logger.warn(`Retry saving inbound message`, {
            error,
            metadata: { attempt, messageSid }
          });
        }
      }
    );
    
    if (messageError) {
      throw new Error(`Failed to save message: ${messageError.message}`);
    }
    
    console.log('Message saved successfully:', savedMessage.id);
    
    // Log success
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'success',
        headers,
        body,
        params,
        undefined,
        undefined,
        { customer_id: customer.id, message_id: savedMessage.id }
      );
    }
    
    return NextResponse.json({ success: true, messageId: savedMessage.id });
    
  } catch (error: any) {
    console.error('Error in handleInboundSMS:', error);
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        error.message,
        { stack: error.stack }
      );
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleStatusUpdate(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  console.log('=== PROCESSING STATUS UPDATE ===');
  
  try {
    const messageSid = params.MessageSid || params.SmsSid;
    const messageStatus = (params.MessageStatus || params.SmsStatus)?.toLowerCase();
    const errorCode = params.ErrorCode;
    const errorMessage = params.ErrorMessage;
    
    console.log('Status update:', { sid: messageSid, status: messageStatus, errorCode });
    
    if (!messageSid || !messageStatus) {
      throw new Error('Missing required fields: MessageSid or MessageStatus');
    }
    
    // First, try to find the existing message
    const { data: existingMessage, error: fetchError } = await adminClient
      .from('messages')
      .select('id, status, twilio_status, direction')
      .eq('twilio_message_sid', messageSid)
      .single();
    
    if (fetchError || !existingMessage) {
      console.log('Message not found for SID:', messageSid);
      
      // Log to webhook_logs but return success to prevent retries
      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'message_not_found',
          headers,
          body,
          params,
          'Message row not found',
          { messageSid }
        );
      }
      
      // Still return success to stop Twilio retries
      return NextResponse.json({ success: true, note: 'Message not found' });
    }
    
    // Check if this is a valid status progression
    if (!isStatusUpgrade(existingMessage.twilio_status, messageStatus)) {
      console.log('Skipping status regression:', {
        current: existingMessage.twilio_status,
        new: messageStatus
      });
      
      // Still log the event for audit purposes
      const { error: historyError } = await adminClient
        .from('message_delivery_status')
        .insert({
          message_id: existingMessage.id,
          status: messageStatus,
          error_code: errorCode,
          error_message: errorMessage,
          raw_webhook_data: params,
          note: 'Status regression prevented'
        });
      
      return NextResponse.json({ success: true, note: 'Status regression prevented' });
    }
    
    // Perform idempotent update with status progression
    const { data: message, error: updateError } = await adminClient
      .from('messages')
      .update({
        status: mapTwilioStatus(messageStatus),
        twilio_status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage || (errorCode ? formatErrorMessage(errorCode) : null),
        updated_at: new Date().toISOString(),
        ...(messageStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
        ...(messageStatus === 'failed' && { failed_at: new Date().toISOString() }),
        ...(messageStatus === 'undelivered' && { failed_at: new Date().toISOString() }),
        ...(messageStatus === 'sent' && !existingMessage.sent_at && { sent_at: new Date().toISOString() })
      })
      .eq('twilio_message_sid', messageSid)
      .eq('id', existingMessage.id) // Extra safety with ID match
      .select()
      .single();
    
    if (updateError) {
      console.error('Failed to update message:', updateError);
      // Don't throw - message might not exist yet
    }
    
    // Save status history (append-only audit log)
    const { error: historyError } = await adminClient
      .from('message_delivery_status')
      .insert({
        message_id: message?.id || existingMessage.id,
        status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage || (errorCode ? formatErrorMessage(errorCode) : null),
        raw_webhook_data: params,
        created_at: new Date().toISOString()
      });
    
    if (historyError) {
      console.error('Failed to save status history:', historyError);
    }
    
    // Log success
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'success',
        headers,
        body,
        params,
        undefined,
        undefined,
        { message_id: message?.id }
      );
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    console.error('Error in handleStatusUpdate:', error);
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        error.message,
        { stack: error.stack }
      );
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function generatePhoneVariants(phone: string): string[] {
  const variants = [phone];
  
  // Clean the phone number - remove all non-digits except leading +
  const cleaned = phone.replace(/[^\d+]/g, '').replace(/\+/g, (match, offset) => offset === 0 ? match : '');
  const digitsOnly = cleaned.replace(/^\+/, '');
  
  // UK number handling
  if (cleaned.startsWith('+44') && digitsOnly.length >= 12) {
    const ukNumber = digitsOnly.substring(2); // Remove 44 from the digits
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (digitsOnly.startsWith('44') && digitsOnly.length >= 12) {
    const ukNumber = digitsOnly.substring(2); // Remove 44
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    const ukNumber = digitsOnly.substring(1); // Remove 0
    variants.push('+44' + ukNumber);
    variants.push('44' + ukNumber);
    variants.push('0' + ukNumber);
  }
  
  // Also add the cleaned version if different from original
  if (cleaned !== phone) {
    variants.push(cleaned);
  }
  
  return [...new Set(variants)];
}

```

## Cron Entry Point and Auth

### File: src/app/api/cron/reminders/route.ts
```ts
import { NextResponse } from 'next/server'
import { processScheduledEventReminders } from '@/app/actions/sms-event-reminders'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

const JOB_NAME = 'event-reminders'
const LONDON_TZ = 'Europe/London'
const STALE_RUN_WINDOW_MINUTES = 30
const DEFAULT_SEND_HOUR = 10

function getLondonRunKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

async function acquireCronRun(runKey: string) {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('cron_job_runs')
    .insert({
      job_name: JOB_NAME,
      run_key: runKey,
      status: 'running',
      started_at: nowIso
    })
    .select('id')
    .single()

  if (data) {
    return { runId: data.id, supabase, skip: false }
  }

  const pgError = error as { code?: string; message?: string }

  if (pgError?.code !== '23505') {
    throw error
  }

  const { data: existing, error: fetchError } = await supabase
    .from('cron_job_runs')
    .select('id, status, started_at, finished_at')
    .eq('job_name', JOB_NAME)
    .eq('run_key', runKey)
    .maybeSingle()

  if (fetchError) {
    throw fetchError
  }

  if (!existing) {
    throw error
  }

  const startedAt = existing.started_at ? new Date(existing.started_at) : null
  const isStale =
    existing.status === 'running' &&
    startedAt !== null &&
    Date.now() - startedAt.getTime() > STALE_RUN_WINDOW_MINUTES * 60 * 1000

  if (existing.status === 'completed') {
    logger.info('Reminder cron already completed for today', {
      metadata: { runKey, jobId: existing.id }
    })
    return { runId: existing.id, supabase, skip: true }
  }

  if (existing.status === 'running' && !isStale) {
    logger.info('Reminder cron already running, skipping duplicate trigger', {
      metadata: { runKey, jobId: existing.id }
    })
    return { runId: existing.id, supabase, skip: true }
  }

  const { data: restarted, error: restartError } = await supabase
    .from('cron_job_runs')
    .update({
      status: 'running',
      started_at: nowIso,
      finished_at: null,
      error_message: null
    })
    .eq('id', existing.id)
    .select('id')
    .single()

  if (restartError) {
    throw restartError
  }

  logger.warn('Reminder cron run restored from previous failed/stale state', {
    metadata: { runKey, jobId: existing.id, previousStatus: existing.status }
  })

  return { runId: restarted?.id ?? existing.id, supabase, skip: false }
}

async function resolveCronRunResult(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  status: 'completed' | 'failed',
  errorMessage?: string
) {
  const updatePayload: Record<string, unknown> = {
    status,
    finished_at: new Date().toISOString()
  }

  if (errorMessage) {
    updatePayload.error_message = errorMessage.slice(0, 2000)
  }

  await supabase
    .from('cron_job_runs')
    .update(updatePayload)
    .eq('id', runId)
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  let runContext: { supabase: ReturnType<typeof createAdminClient>; runId: string; runKey: string } | null = null

  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authResult = authorizeCronRequest(request)

    if (!authResult.authorized) {
      console.log('Unauthorized reminder request', authResult.reason)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const runKey = getLondonRunKey()
    const { supabase, runId, skip } = await acquireCronRun(runKey)
    runContext = { supabase, runId, runKey }

    if (skip) {
      return new NextResponse(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'already_processed',
          runKey
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('Starting reminder check (scheduled pipeline only by default)...')

    // Warn if the cron fires before the intended send hour to avoid missing same-day reminders
    const londonNow = new Date(new Date().toLocaleString('en-GB', { timeZone: LONDON_TZ }))
    if (londonNow.getHours() < DEFAULT_SEND_HOUR) {
      logger.warn('Reminder cron ran before default send hour; consider scheduling after 10:00 London', {
        metadata: { runKey, londonHour: londonNow.getHours() }
      })
    }

    // Process new scheduled reminders from booking_reminders table (single source of truth)
    const scheduledResult = await processScheduledEventReminders()
    console.log('Scheduled reminders processed:', scheduledResult)

    // Legacy path has been removed to prevent duplicate or early sends.
    console.log('Legacy reminder sender removed — only scheduled pipeline runs')
    
    console.log('Reminder check completed successfully')

    await resolveCronRunResult(supabase, runId, 'completed')

    return new NextResponse(
      JSON.stringify({
        success: true,
        scheduled: scheduledResult,
        message: 'Reminders processed successfully'
      }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Error processing reminders:', error)
    const failureMessage = error instanceof Error ? error.message : 'Unknown error'

    if (runContext) {
      try {
        await resolveCronRunResult(runContext.supabase, runContext.runId, 'failed', failureMessage)
      } catch (logError) {
        logger.error('Failed to update cron job run status', {
          error: logError as Error,
          metadata: { runId: runContext.runId, runKey: runContext.runKey }
        })
      }
    }

    // Return the error message in the response for debugging
    return new NextResponse(`Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
} 

```

### File: src/lib/cron-auth.ts
```ts
import type { NextRequest } from 'next/server'

type CronRequest = Request | NextRequest

export type CronAuthResult = {
  authorized: boolean
  reason?: string
}

function headerEquals(header: string | null, value: string | undefined) {
  if (!header || !value) return false
  return header.trim() === value
}

export function authorizeCronRequest(request: CronRequest): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET?.trim()
  const authHeader = request.headers.get('authorization')?.trim() ?? null
  const vercelCronHeader = request.headers.get('x-vercel-cron')

  if (!cronSecret && process.env.NODE_ENV !== 'production') {
    // In non-production environments allow cron execution without auth for convenience
    return { authorized: true }
  }

  if (cronSecret) {
    const bearerSecret = `Bearer ${cronSecret}`
    if (headerEquals(authHeader, bearerSecret) || headerEquals(authHeader, cronSecret)) {
      return { authorized: true }
    }
  }

  if (vercelCronHeader) {
    return { authorized: true }
  }

  return {
    authorized: false,
    reason: 'Missing or invalid cron credentials'
  }
}

```

### File: src/lib/env.ts
```ts
import { z } from 'zod';

// Define the schema for environment variables
const envSchema = z.object({
  // Public variables (available to client and server)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL must be a valid URL'),
  NEXT_PUBLIC_CONTACT_PHONE_NUMBER: z.string().optional(),
  
  // Server-only variables
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required').optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  SUSPEND_EVENT_SMS: z.string().optional(),
  SUSPEND_ALL_SMS: z.string().optional(),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required').optional(),
  
  // Webhook configuration
  WEBHOOK_BASE_URL: z.string().url().optional(),
  VERCEL_URL: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  SKIP_TWILIO_SIGNATURE_VALIDATION: z.string().optional(),
});

// Create a type from the schema
type Env = z.infer<typeof envSchema>;

// Validate environment variables
function validateEnv(): Env {
  const withTestDefaults =
    process.env.NODE_ENV === 'test'
      ? {
          NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
          ...process.env,
        }
      : process.env;

  try {
    return envSchema.parse(withTestDefaults);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Environment validation failed:\n${issues.join('\n')}`);
    }
    throw error;
  }
}

// Export validated environment variables
export const env = validateEnv();

// Webhook configuration with smart defaults
export const WEBHOOK_BASE_URL = 
  env.WEBHOOK_BASE_URL || 
  env.NEXT_PUBLIC_SITE_URL ||
  env.NEXT_PUBLIC_APP_URL ||
  (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000');

// Twilio webhook endpoints
export const TWILIO_STATUS_CALLBACK = `${WEBHOOK_BASE_URL}/api/webhooks/twilio`;
export const TWILIO_STATUS_CALLBACK_METHOD = 'POST' as const;

// Export helper functions for optional features
export const isSmsEnabled = () => {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
};

export const isServerActionEnabled = () => {
  return !!env.SUPABASE_SERVICE_ROLE_KEY;
};

// Check if Twilio signature validation should be skipped (development only)
export const skipTwilioSignatureValidation = () => {
  return process.env.NODE_ENV === 'development' && env.SKIP_TWILIO_SIGNATURE_VALIDATION === 'true';
};

```

### File: src/lib/supabase/admin.ts
```ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

```

## Database Schema - Core Tables and Functions (excerpted from supabase/migrations/20251123120000_squashed.sql)

### Function: public.get_message_template
```sql
CREATE OR REPLACE FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") RETURNS TABLE("content" "text", "variables" "text"[], "send_timing" "text", "custom_timing_hours" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- First check for event-specific template
  RETURN QUERY
  SELECT emt.content, emt.variables, emt.send_timing, emt.custom_timing_hours
  FROM event_message_templates emt
  WHERE emt.event_id = p_event_id
    AND emt.template_type = p_template_type
    AND emt.is_active = true
  LIMIT 1;
  
  -- If no event-specific template, return default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT mt.content, mt.variables, mt.send_timing, mt.custom_timing_hours
    FROM message_templates mt
    WHERE mt.template_type = p_template_type
      AND mt.is_default = true
      AND mt.is_active = true
    LIMIT 1;
  END IF;
END;
$$;

```

### Table: public.booking_reminders (base definition)
```sql
CREATE TABLE IF NOT EXISTS "public"."booking_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "message_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_reminders_reminder_type_check" CHECK (("reminder_type" = ANY (ARRAY['24_hour'::"text", '7_day'::"text", '1_hour'::"text", '12_hour'::"text", 'custom'::"text"])))
);

```

### Table: public.bookings
```sql
CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "seats" integer,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "notes" "text",
    CONSTRAINT "chk_booking_seats" CHECK (("seats" >= 0))
);

```

### Table: public.customers
```sql
CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "mobile_number" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "sms_opt_in" boolean DEFAULT true,
    "sms_delivery_failures" integer DEFAULT 0,
    "last_sms_failure_reason" "text",
    "last_successful_sms_at" timestamp with time zone,
    "sms_deactivated_at" timestamp with time zone,
    "sms_deactivation_reason" "text",
    "messaging_status" "text" DEFAULT 'active'::"text",
    "last_successful_delivery" timestamp with time zone,
    "consecutive_failures" integer DEFAULT 0,
    "total_failures_30d" integer DEFAULT 0,
    "last_failure_type" "text",
    CONSTRAINT "chk_customer_name_length" CHECK ((("length"("first_name") <= 100) AND ("length"("last_name") <= 100))),
    CONSTRAINT "chk_customer_phone_format" CHECK ((("mobile_number" IS NULL) OR ("mobile_number" ~ '^\+[1-9]\d{7,14}$'::"text") OR ("mobile_number" ~ '^0[1-9]\d{9,10}$'::"text"))),
    CONSTRAINT "customers_messaging_status_check" CHECK (("messaging_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'invalid_number'::"text", 'opted_out'::"text"])))
);

```

### Table: public.messages
```sql
CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "message_sid" "text" NOT NULL,
    "body" "text" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "twilio_message_sid" "text",
    "error_code" "text",
    "error_message" "text",
    "price" numeric(10,4),
    "price_unit" "text",
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "twilio_status" "text",
    "from_number" "text",
    "to_number" "text",
    "message_type" "text" DEFAULT 'sms'::"text",
    "read_at" timestamp with time zone,
    "segments" integer DEFAULT 1,
    "cost_usd" numeric(10,4),
    CONSTRAINT "chk_message_direction" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "chk_message_segments" CHECK (("segments" >= 1)),
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "messages_message_type_check" CHECK (("message_type" = ANY (ARRAY['sms'::"text", 'mms'::"text", 'whatsapp'::"text"])))
);

```

### Table: public.event_message_templates
```sql
CREATE TABLE IF NOT EXISTS "public"."event_message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "template_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "variables" "text"[] DEFAULT '{}'::"text"[],
    "is_active" boolean DEFAULT true,
    "character_count" integer GENERATED ALWAYS AS ("length"("content")) STORED,
    "estimated_segments" integer GENERATED ALWAYS AS (
CASE
    WHEN ("length"("content") <= 160) THEN (1)::numeric
    ELSE "ceil"((("length"("content"))::numeric / (153)::numeric))
END) STORED,
    "send_timing" "text" DEFAULT 'immediate'::"text",
    "custom_timing_hours" integer,
    CONSTRAINT "event_message_templates_custom_timing_hours_check" CHECK ((("custom_timing_hours" > 0) AND ("custom_timing_hours" <= 720))),
    CONSTRAINT "event_message_templates_send_timing_check" CHECK (("send_timing" = ANY (ARRAY['immediate'::"text", '1_hour'::"text", '12_hours'::"text", '24_hours'::"text", '7_days'::"text", 'custom'::"text"]))),
    CONSTRAINT "event_message_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['booking_confirmation'::"text", 'reminder_7_day'::"text", 'reminder_24_hour'::"text", 'booking_reminder_confirmation'::"text", 'booking_reminder_7_day'::"text", 'booking_reminder_24_hour'::"text", 'custom'::"text"])))
);

```

### Table: public.message_templates
```sql
CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "template_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "variables" "text"[] DEFAULT '{}'::"text"[],
    "is_default" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "character_count" integer GENERATED ALWAYS AS ("length"("content")) STORED,
    "estimated_segments" integer GENERATED ALWAYS AS (
CASE
    WHEN ("length"("content") <= 160) THEN (1)::numeric
    ELSE "ceil"((("length"("content"))::numeric / (153)::numeric))
END) STORED,
    "send_timing" "text" DEFAULT 'immediate'::"text" NOT NULL,
    "custom_timing_hours" integer,
    CONSTRAINT "message_templates_custom_timing_hours_check" CHECK ((("custom_timing_hours" > 0) AND ("custom_timing_hours" <= 720))),
    CONSTRAINT "message_templates_send_timing_check" CHECK (("send_timing" = ANY (ARRAY['immediate'::"text", '1_hour'::"text", '12_hours'::"text", '24_hours'::"text", '7_days'::"text", 'custom'::"text"]))),
    CONSTRAINT "message_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['booking_confirmation'::"text", 'reminder_7_day'::"text", 'reminder_24_hour'::"text", 'booking_reminder_confirmation'::"text", 'booking_reminder_7_day'::"text", 'booking_reminder_24_hour'::"text", 'custom'::"text", 'private_booking_created'::"text", 'private_booking_deposit_received'::"text", 'private_booking_final_payment'::"text", 'private_booking_reminder_14d'::"text", 'private_booking_balance_reminder'::"text", 'private_booking_reminder_1d'::"text", 'private_booking_date_changed'::"text", 'private_booking_confirmed'::"text", 'private_booking_cancelled'::"text"])))
);

```

### Table: public.events
```sql
CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "date" "date" NOT NULL,
    "time" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "capacity" integer,
    "category_id" "uuid",
    "description" "text",
    "end_time" time without time zone,
    "event_status" character varying(50) DEFAULT 'scheduled'::character varying,
    "performer_name" character varying(255),
    "performer_type" character varying(50),
    "price" numeric(10,2) DEFAULT 0,
    "price_currency" character varying(3) DEFAULT 'GBP'::character varying,
    "is_free" boolean DEFAULT true,
    "booking_url" "text",
    "image_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "is_recurring" boolean DEFAULT false,
    "recurrence_rule" "text",
    "parent_event_id" "uuid",
    "slug" character varying(255) NOT NULL,
    "short_description" "text",
    "long_description" "text",
    "highlights" "jsonb" DEFAULT '[]'::"jsonb",
    "meta_title" character varying(255),
    "meta_description" "text",
    "keywords" "jsonb" DEFAULT '[]'::"jsonb",
    "hero_image_url" "text",
    "gallery_image_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "poster_image_url" "text",
    "thumbnail_image_url" "text",
    "promo_video_url" "text",
    "highlight_video_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "doors_time" time without time zone,
    "duration_minutes" integer,
    "last_entry_time" time without time zone,
    CONSTRAINT "check_duration_positive" CHECK ((("duration_minutes" IS NULL) OR ("duration_minutes" > 0))),
    CONSTRAINT "chk_event_date_reasonable" CHECK (("date" >= (CURRENT_DATE - '1 year'::interval))),
    CONSTRAINT "events_capacity_check" CHECK ((("capacity" IS NULL) OR ("capacity" > 0)))
);

```

## Database Migrations - Reminder-Specific

### File: supabase/migrations-archive/pre-squash-20251123/20250822_event_sms_reminder_system.sql
```sql
-- Migration: Enhanced Event SMS Reminder System
-- Description: Adds new reminder types and booking source tracking for improved SMS messaging

-- 1. Add new reminder types to the enum (if using enum)
-- First check if we're using an enum or just text
DO $$
BEGIN
  -- Check if reminder_type enum exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reminder_type') THEN
    -- Try to add new values to existing enum (wrapped in exception handler)
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_2_weeks';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_1_week';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_day_before';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'has_seats_1_week';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'has_seats_day_before';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- 2. Add booking_source to bookings table to track how booking was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'booking_source'
  ) THEN
    ALTER TABLE bookings 
    ADD COLUMN booking_source TEXT DEFAULT 'direct_booking'
    CHECK (booking_source IN ('direct_booking', 'bulk_add', 'customer_portal', 'sms_reply', 'import'));
  END IF;
END $$;

-- 3. Add last_reminder_sent to bookings table for tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'last_reminder_sent'
  ) THEN
    ALTER TABLE bookings 
    ADD COLUMN last_reminder_sent TIMESTAMPTZ;
  END IF;
END $$;

-- 4. Ensure booking_reminders table has proper structure
-- First add missing columns if the table already exists
DO $$
BEGIN
  -- Check if table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'booking_reminders'
  ) THEN
    -- Add scheduled_for column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'scheduled_for'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
    
    -- Add status column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'status'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'));
    END IF;
    
    -- Add error_message column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'error_message'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN error_message TEXT;
    END IF;
    
    -- Add message_id column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'message_id'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN message_id TEXT;
    END IF;
    
    -- Add updated_at column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END IF;
END $$;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS booking_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  message_id TEXT, -- Twilio message SID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_booking_reminders_scheduled 
ON booking_reminders(scheduled_for, status) 
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_booking_reminders_booking 
ON booking_reminders(booking_id, reminder_type);

CREATE INDEX IF NOT EXISTS idx_bookings_source 
ON bookings(booking_source);

CREATE INDEX IF NOT EXISTS idx_bookings_event_seats 
ON bookings(event_id, seats);

-- 6. Create or update the function to prevent duplicate reminders
CREATE OR REPLACE FUNCTION prevent_duplicate_reminders()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if a reminder of the same type already exists for this booking
  IF EXISTS (
    SELECT 1 FROM booking_reminders 
    WHERE booking_id = NEW.booking_id 
    AND reminder_type = NEW.reminder_type 
    AND status IN ('pending', 'sent')
    AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Duplicate reminder already exists for booking % with type %', 
      NEW.booking_id, NEW.reminder_type;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for duplicate prevention
DROP TRIGGER IF EXISTS prevent_duplicate_reminders_trigger ON booking_reminders;
CREATE TRIGGER prevent_duplicate_reminders_trigger
  BEFORE INSERT OR UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_reminders();

-- 8. Add RLS policies for booking_reminders
ALTER TABLE booking_reminders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate
DROP POLICY IF EXISTS "Users can view reminders for accessible bookings" ON booking_reminders;
CREATE POLICY "Users can view reminders for accessible bookings" 
ON booking_reminders FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = booking_reminders.booking_id
  )
);

-- Only service role can insert/update/delete reminders
DROP POLICY IF EXISTS "Service role can manage reminders" ON booking_reminders;
CREATE POLICY "Service role can manage reminders" 
ON booking_reminders FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 9. Add helper function to calculate reminder dates
CREATE OR REPLACE FUNCTION calculate_reminder_dates(
  event_date DATE,
  event_time TEXT,
  has_seats BOOLEAN
)
RETURNS TABLE (
  reminder_type TEXT,
  scheduled_for TIMESTAMPTZ
) AS $$
DECLARE
  event_datetime TIMESTAMPTZ;
  days_until_event INTEGER;
BEGIN
  -- Combine date and time
  event_datetime := (event_date || ' ' || event_time)::TIMESTAMPTZ;
  days_until_event := (event_date - CURRENT_DATE);
  
  IF has_seats THEN
    -- Has seats: 1 week and 1 day before
    IF days_until_event >= 7 THEN
      RETURN QUERY SELECT 'has_seats_1_week'::TEXT, event_datetime - INTERVAL '7 days';
    END IF;
    IF days_until_event >= 1 THEN
      RETURN QUERY SELECT 'has_seats_day_before'::TEXT, event_datetime - INTERVAL '1 day';
    END IF;
  ELSE
    -- No seats: 2 weeks, 1 week, and 1 day before
    IF days_until_event >= 14 THEN
      RETURN QUERY SELECT 'no_seats_2_weeks'::TEXT, event_datetime - INTERVAL '14 days';
    END IF;
    IF days_until_event >= 7 THEN
      RETURN QUERY SELECT 'no_seats_1_week'::TEXT, event_datetime - INTERVAL '7 days';
    END IF;
    IF days_until_event >= 1 THEN
      RETURN QUERY SELECT 'no_seats_day_before'::TEXT, event_datetime - INTERVAL '1 day';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 10. Update existing bookings to have booking_source
UPDATE bookings 
SET booking_source = CASE 
  WHEN seats > 0 THEN 'direct_booking'
  ELSE 'bulk_add'
END
WHERE booking_source IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN bookings.booking_source IS 'Source of booking creation: direct_booking (New Booking button), bulk_add (Add Attendees), customer_portal, sms_reply, import';
COMMENT ON COLUMN bookings.last_reminder_sent IS 'Timestamp of the last reminder sent for this booking';
COMMENT ON TABLE booking_reminders IS 'Tracks scheduled and sent SMS reminders for event bookings';
```

### File: supabase/migrations-archive/pre-squash-20251123/20250915093000_sms_reminder_overhaul.sql
```sql
-- SMS reminder overhaul: align schema with new scheduling pipeline

-- 1. Expand reminder_type constraint to include new cadence types while keeping legacy values
ALTER TABLE booking_reminders
  DROP CONSTRAINT IF EXISTS booking_reminders_reminder_type_check;

ALTER TABLE booking_reminders
  ADD CONSTRAINT booking_reminders_reminder_type_check
  CHECK (
    reminder_type IN (
      'booking_confirmation',
      'booked_1_month',
      'booked_1_week',
      'booked_1_day',
      'reminder_invite_1_month',
      'reminder_invite_1_week',
      'reminder_invite_1_day',
      'no_seats_2_weeks',
      'no_seats_1_week',
      'no_seats_day_before',
      'has_seats_1_week',
      'has_seats_day_before',
      'booking_reminder_24_hour',
      'booking_reminder_7_day',
      -- legacy values retained for historical rows
      '24_hour',
      '7_day',
      '12_hour',
      '1_hour',
      'custom'
    )
  );

-- 2. Ensure event_id and target_phone columns exist for deduping per guest
ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS event_id UUID;

ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS target_phone TEXT;

-- 3. Backfill event_id and target_phone using current booking/customer data
WITH booking_data AS (
  SELECT br.id,
         b.event_id,
         c.mobile_number
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN customers c ON c.id = b.customer_id
)
UPDATE booking_reminders br
SET event_id = COALESCE(br.event_id, booking_data.event_id),
    target_phone = COALESCE(br.target_phone, booking_data.mobile_number)
FROM booking_data
WHERE br.id = booking_data.id
  AND (br.event_id IS NULL OR br.target_phone IS NULL);

-- 4. Normalise target_phone format by trimming whitespace
UPDATE booking_reminders
SET target_phone = NULLIF(trim(target_phone), '')
WHERE target_phone IS NOT NULL;

-- 5. Create partial unique index to prevent duplicated sends per event/phone/type
DROP INDEX IF EXISTS idx_booking_reminders_phone_unique;
CREATE UNIQUE INDEX idx_booking_reminders_phone_unique
  ON booking_reminders(event_id, target_phone, reminder_type)
  WHERE status IN ('pending', 'sent') AND target_phone IS NOT NULL;

-- 6. Refresh trigger to enforce uniqueness and backfill missing metadata automatically
CREATE OR REPLACE FUNCTION prevent_duplicate_reminders()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id UUID;
  v_phone TEXT;
BEGIN
  -- Resolve event id and phone if not supplied
  IF NEW.event_id IS NULL OR NEW.target_phone IS NULL THEN
    SELECT b.event_id, c.mobile_number
    INTO v_event_id, v_phone
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.id = NEW.booking_id;

    IF NEW.event_id IS NULL THEN
      NEW.event_id := v_event_id;
    END IF;
    IF NEW.target_phone IS NULL THEN
      NEW.target_phone := v_phone;
    END IF;
  END IF;

  -- Prevent duplicates for the same guest/event/type when reminder is still active
  IF EXISTS (
    SELECT 1
    FROM booking_reminders br
    WHERE br.id <> NEW.id
      AND br.event_id = NEW.event_id
      AND br.reminder_type = NEW.reminder_type
      AND br.target_phone = NEW.target_phone
      AND br.status IN ('pending', 'sent')
  ) THEN
    RAISE EXCEPTION 'Duplicate reminder already exists for event %, phone %, type %',
      NEW.event_id, NEW.target_phone, NEW.reminder_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_duplicate_reminders_trigger ON booking_reminders;
CREATE TRIGGER prevent_duplicate_reminders_trigger
  BEFORE INSERT OR UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_reminders();

-- 7. Touch updated_at when metadata changes
ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION booking_reminders_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_reminders_set_updated_at_trigger ON booking_reminders;
CREATE TRIGGER booking_reminders_set_updated_at_trigger
  BEFORE UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION booking_reminders_set_updated_at();

```

### File: supabase/migrations-archive/pre-squash-20251123/20251025120000_add_booking_reminder_flag.sql
```sql
-- Add explicit reminder flag to bookings so we no longer rely on seats === 0
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS is_reminder_only boolean NOT NULL DEFAULT false;

-- Backfill existing data: any booking without seats counts as a reminder
UPDATE public.bookings
SET is_reminder_only = COALESCE(seats, 0) = 0
WHERE is_reminder_only = false;

-- Helpful index for reminder-specific queries
CREATE INDEX IF NOT EXISTS idx_bookings_is_reminder_only
  ON public.bookings (is_reminder_only);

```

### File: supabase/migrations-archive/pre-squash-20251123/20251104153000_add_cron_job_runs.sql
```sql
-- Guard table for cron executions to prevent duplicate reminder sends

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  run_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_job_runs_job_key
  ON cron_job_runs (job_name, run_key);

CREATE OR REPLACE FUNCTION cron_job_runs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cron_job_runs_set_updated_at_trigger ON cron_job_runs;
CREATE TRIGGER cron_job_runs_set_updated_at_trigger
  BEFORE UPDATE ON cron_job_runs
  FOR EACH ROW
  EXECUTE FUNCTION cron_job_runs_set_updated_at();

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages cron job runs"
  ON cron_job_runs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

```
