'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { scheduleAndProcessBookingReminders } from './event-sms-scheduler'
import { withRetry } from '@/lib/supabase-retry'
import { getEventAvailableCapacity, invalidateEventCache } from '@/lib/events'
import { formatPhoneForStorage } from '@/lib/validation'

// Booking validation schema
const bookingSchema = z.object({
  event_id: z.string().uuid('Invalid event ID'),
  customer_id: z.string().uuid('Invalid customer ID'),
  seats: z.number()
    .min(0, 'Tickets cannot be negative')
    .max(100, 'Cannot book more than 100 tickets at once'),
  notes: z.string().max(500, 'Notes too long').optional()
})

interface BookingData {
  id: string;
  event_id: string;
  customer_id: string;
  seats: number | null;
  notes: string | null;
  created_at: string;
}

type CreateBookingResult = 
  | { success: true; data: BookingData }
  | { error: string }
  | { error: 'duplicate_booking'; existingBooking: { id: string; seats: number } }

export async function createBooking(formData: FormData): Promise<CreateBookingResult> {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    let customerId = formData.get('customer_id') as string

    // Check if we need to create a new customer
    if (formData.get('create_customer') === 'true') {
      const firstName = formData.get('customer_first_name') as string
      const lastName = formData.get('customer_last_name') as string
      const mobileNumber = formData.get('customer_mobile_number') as string

      if (!firstName || !lastName || !mobileNumber) {
        return { error: 'Customer details are required' }
      }

      // Normalize phone number
      let formattedPhone: string
      try {
        formattedPhone = formatPhoneForStorage(mobileNumber)
      } catch (error) {
        return { error: 'Invalid phone number format. Please use UK format (07XXX XXXXXX)' }
      }

      // Check if customer already exists with this phone number
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('mobile_number', formattedPhone)
        .single()

      if (existingCustomer) {
        customerId = existingCustomer.id
      } else {
        // Create new customer
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            first_name: firstName,
            last_name: lastName,
            mobile_number: formattedPhone,
            sms_consent: true
          })
          .select()
          .single()

        if (customerError) {
          console.error('Customer creation error:', customerError)
          return { error: 'Failed to create customer' }
        }

        customerId = newCustomer.id

        // Log customer creation
        await logAuditEvent({
          user_id: user.id,
          user_email: user.email || undefined,
          operation_type: 'create',
          resource_type: 'customer',
          resource_id: customerId,
          operation_status: 'success',
          additional_info: {
            firstName,
            lastName,
            mobileNumber: formattedPhone,
            createdDuringBooking: true
          }
        })
      }
    }

    // Parse and validate form data
    const rawData = {
      event_id: formData.get('event_id') as string,
      customer_id: customerId,
      seats: parseInt(formData.get('seats') as string || '0'),
      notes: formData.get('notes') as string || undefined,
      overwrite: formData.get('overwrite') === 'true' // Check if we should overwrite existing booking
    }

    const validationResult = bookingSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Check if booking already exists
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id, seats')
      .eq('event_id', data.event_id)
      .eq('customer_id', data.customer_id)
      .single()

    if (existingBooking && !rawData.overwrite) {
      // Return specific error with existing booking info
      return { 
        error: 'duplicate_booking',
        existingBooking: {
          id: existingBooking.id,
          seats: existingBooking.seats
        }
      }
    }

    // Get event details to check capacity
    const { data: event } = await supabase
      .from('events')
      .select('id, name, date, time, capacity')
      .eq('id', data.event_id)
      .single()

    if (!event) {
      return { error: 'Event not found' }
    }

    // Check capacity using cached function
    if (event.capacity && data.seats > 0) {
      let availableCapacity = await getEventAvailableCapacity(data.event_id)
      
      // If overwriting, add back the existing booking's seats to available capacity
      if (existingBooking && rawData.overwrite && existingBooking.seats) {
        availableCapacity = availableCapacity !== null ? availableCapacity + existingBooking.seats : null
      }
      
      if (availableCapacity !== null && data.seats > availableCapacity) {
        return { error: `Only ${availableCapacity} tickets available (capacity: ${event.capacity})` }
      }
    }

    // Get customer details for audit log
    const { data: customer } = await supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', data.customer_id)
      .single()

    let booking
    let operationType: 'create' | 'update' = 'create'

    if (existingBooking && rawData.overwrite) {
      // Update existing booking
      const { data: updatedBooking, error } = await withRetry(
        async () => {
          return await supabase
            .from('bookings')
            .update({
              seats: data.seats,
              notes: data.notes || null
            })
            .eq('id', existingBooking.id)
            .select()
            .single()
        },
        'update booking'
      )

      if (error) {
        console.error('Booking update error:', error)
        return { error: 'Failed to update booking' }
      }
      
      booking = updatedBooking
      operationType = 'update'
    } else {
      // Create new booking with retry logic
      const { data: newBooking, error } = await withRetry(
        async () => {
          return await supabase
            .from('bookings')
            .insert({
              event_id: data.event_id,
              customer_id: data.customer_id,
              seats: data.seats,
              notes: data.notes || null,
              booking_source: 'direct_booking' // Mark as direct booking
            })
            .select()
            .single()
        },
        'create booking'
      )

      if (error) {
        console.error('Booking creation error:', error)
        return { error: 'Failed to create booking' }
      }
      
      booking = newBooking
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: operationType,
      resource_type: 'booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: {
        eventId: event.id,
        eventName: event.name,
        customerId: data.customer_id,
        customerName: customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown',
        seats: data.seats,
        overwrote: existingBooking && rawData.overwrite
      }
    })

    try {
      const reminderResult = await scheduleAndProcessBookingReminders(booking.id)
      if (!reminderResult.success) {
        console.error('Failed to queue booking reminders:', reminderResult.error)
        await logAuditEvent({
          user_id: user.id,
          user_email: user.email || undefined,
          operation_type: 'sms_failure',
          resource_type: 'booking',
          resource_id: booking.id,
          operation_status: 'failure',
          additional_info: {
            error: reminderResult.error,
            customerId: data.customer_id
          }
        })
      }
    } catch (error) {
      console.error('Unexpected error scheduling reminders:', error)
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email || undefined,
        operation_type: 'sms_failure',
        resource_type: 'booking',
        resource_id: booking.id,
        operation_status: 'failure',
        additional_info: {
          error: error instanceof Error ? error.message : 'Unknown error',
          customerId: data.customer_id
        }
      })
    }

    // Invalidate event cache
    await invalidateEventCache(data.event_id)
    
    revalidatePath(`/events/${data.event_id}`)
    return { success: true, data: booking }
  } catch (error) {
    console.error('Unexpected error creating booking:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createBulkBookings(eventId: string, customerIds: string[]) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    if (!eventId || !customerIds.length) {
      return { error: 'Invalid request data' }
    }

    // Get event details
    const { data: event } = await supabase
      .from('events')
      .select('name, date')
      .eq('id', eventId)
      .single()

    if (!event) {
      return { error: 'Event not found' }
    }

    // Get existing bookings to avoid duplicates
    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('event_id', eventId)
      .in('customer_id', customerIds)

    const existingCustomerIds = new Set(existingBookings?.map(b => b.customer_id) || [])
    const newCustomerIds = customerIds.filter(id => !existingCustomerIds.has(id))

    if (newCustomerIds.length === 0) {
      return { error: 'All selected customers already have bookings for this event' }
    }

    // Create bookings
    const bookingsToInsert = newCustomerIds.map(customerId => ({
      event_id: eventId,
      customer_id: customerId,
      seats: 0, // Default to reminder-only bookings
      notes: 'Added via bulk add'
    }))

    const { data: bookings, error } = await supabase
      .from('bookings')
      .insert(bookingsToInsert)
      .select()

    if (error) {
      console.error('Bulk booking creation error:', error)
      return { error: 'Failed to create bookings' }
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'bulk_create',
      resource_type: 'booking',
      operation_status: 'success',
      additional_info: {
        eventId: eventId,
        eventName: event.name,
        customerCount: bookings.length
      }
    })

    await Promise.all(
      bookings.map(async booking => {
        const result = await scheduleAndProcessBookingReminders(booking.id)
        if (!result.success) {
          console.error(`Failed to queue reminders for booking ${booking.id}:`, result.error)
        }
      })
    )

    revalidatePath(`/events/${eventId}`)
    return { success: true, data: bookings }
  } catch (error) {
    console.error('Unexpected error creating bulk bookings:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateBooking(id: string, formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Parse and validate form data
    const seats = parseInt(formData.get('seats') as string || '0')
    const notes = formData.get('notes') as string || undefined

    if (seats < 0) {
      return { error: 'Tickets cannot be negative' }
    }
    if (seats > 100) {
      return { error: 'Cannot book more than 100 tickets at once' }
    }

    // Get booking details
    const { data: booking } = await supabase
      .from('bookings')
      .select('event_id, customer_id')
      .eq('id', id)
      .single()

    if (!booking) {
      return { error: 'Booking not found' }
    }

    // Get event details to check capacity
    const { data: event } = await supabase
      .from('events')
      .select('name, capacity')
      .eq('id', booking.event_id)
      .single()

    // Check capacity if event has one and seats are increasing
    if (event?.capacity && seats > 0) {
      const { data: currentBooking } = await supabase
        .from('bookings')
        .select('seats')
        .eq('id', id)
        .single()

      const seatDifference = seats - (currentBooking?.seats || 0)

      if (seatDifference > 0) {
        const { data: otherBookings } = await supabase
          .from('bookings')
          .select('seats')
          .eq('event_id', booking.event_id)
          .neq('id', id)

        if (otherBookings) {
          const currentSeats = otherBookings.reduce((sum, b) => sum + (b.seats || 0), 0)
          if (currentSeats + seats > event.capacity) {
            const available = event.capacity - currentSeats
            return { error: `Only ${available} tickets available (capacity: ${event.capacity})` }
          }
        }
      }
    }

    // Update booking
    const { error } = await supabase
      .from('bookings')
      .update({
        seats,
        notes: notes || null
      })
      .eq('id', id)

    if (error) {
      console.error('Booking update error:', error)
      return { error: 'Failed to update booking' }
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'update',
      resource_type: 'booking',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        eventName: event?.name,
        seats
      }
    })

    revalidatePath(`/events/${booking.event_id}`)
    return { success: true }
  } catch (error) {
    console.error('Unexpected error updating booking:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteBooking(id: string) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get booking details for audit log
    const { data: booking } = await supabase
      .from('bookings')
      .select('event_id, customer_id, seats, events(name), customers(first_name, last_name)')
      .eq('id', id)
      .single() as { data: {
        event_id: string;
        customer_id: string;
        seats: number | null;
        events?: { name: string };
        customers?: { first_name: string; last_name: string };
      } | null }

    // Delete booking
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Booking deletion error:', error)
      return { error: 'Failed to delete booking' }
    }

    // Log audit event
    if (booking) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email || undefined,
        operation_type: 'delete',
        resource_type: 'booking',
        resource_id: id,
        operation_status: 'success',
        additional_info: {
          eventId: booking.event_id,
          eventName: booking.events?.name,
          customerId: booking.customer_id,
          customerName: booking.customers ? 
            `${booking.customers.first_name} ${booking.customers.last_name}` : 
            'Unknown',
          seats: booking.seats
        }
      })
    }

    revalidatePath(`/events/${booking?.event_id}`)
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting booking:', error)
    return { error: 'An unexpected error occurred' }
  }
}
