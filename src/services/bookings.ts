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
    // SMS Reminders
    scheduleAndProcessBookingReminders(booking.id).catch(console.error);

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
