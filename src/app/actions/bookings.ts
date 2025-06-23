'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { sendBookingConfirmationSync } from './sms'
import { withRetry, withTransaction } from '@/lib/supabase-retry'
import { logger } from '@/lib/logger'
import { getEventAvailableCapacity, invalidateEventCache } from '@/lib/events'

// Booking validation schema
const bookingSchema = z.object({
  event_id: z.string().uuid('Invalid event ID'),
  customer_id: z.string().uuid('Invalid customer ID'),
  seats: z.number()
    .min(0, 'Seats cannot be negative')
    .max(100, 'Cannot book more than 100 seats at once'),
  notes: z.string().max(500, 'Notes too long').optional()
})

export async function createBooking(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Parse and validate form data
    const rawData = {
      event_id: formData.get('event_id') as string,
      customer_id: formData.get('customer_id') as string,
      seats: parseInt(formData.get('seats') as string || '0'),
      notes: formData.get('notes') as string || undefined
    }

    const validationResult = bookingSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Check if booking already exists
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('event_id', data.event_id)
      .eq('customer_id', data.customer_id)
      .single()

    if (existingBooking) {
      return { error: 'This customer already has a booking for this event' }
    }

    // Get event details to check capacity
    const { data: event } = await supabase
      .from('events')
      .select('id, name, date, capacity')
      .eq('id', data.event_id)
      .single()

    if (!event) {
      return { error: 'Event not found' }
    }

    // Check capacity using cached function
    if (event.capacity && data.seats > 0) {
      const availableCapacity = await getEventAvailableCapacity(data.event_id)
      
      if (availableCapacity !== null && data.seats > availableCapacity) {
        return { error: `Only ${availableCapacity} seats available (capacity: ${event.capacity})` }
      }
    }

    // Get customer details for audit log
    const { data: customer } = await supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', data.customer_id)
      .single()

    // Create booking with retry logic
    const { data: booking, error } = await withRetry(
      async () => {
        return await supabase
          .from('bookings')
          .insert(data)
          .select()
          .single()
      },
      'create booking'
    )

    if (error) {
      console.error('Booking creation error:', error)
      return { error: 'Failed to create booking' }
    }

    // Log audit event
    await logAuditEvent(user.id, 'booking.create', {
      bookingId: booking.id,
      eventId: event.id,
      eventName: event.name,
      customerId: data.customer_id,
      customerName: customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown',
      seats: data.seats
    })

    // Send SMS confirmation immediately
    sendBookingConfirmationSync(booking.id).catch(error => {
      console.error('Failed to send booking confirmation:', error)
    })

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
    await logAuditEvent(user.id, 'booking.bulk_create', {
      eventId: eventId,
      eventName: event.name,
      customerCount: bookings.length
    })

    // Send SMS confirmations immediately
    bookings.forEach(booking => {
      sendBookingConfirmationSync(booking.id).catch(error => {
        console.error(`Failed to send confirmation for booking ${booking.id}:`, error)
      })
    })

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
      return { error: 'Seats cannot be negative' }
    }
    if (seats > 100) {
      return { error: 'Cannot book more than 100 seats at once' }
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
            return { error: `Only ${available} seats available (capacity: ${event.capacity})` }
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
    await logAuditEvent(user.id, 'booking.update', {
      bookingId: id,
      eventName: event?.name,
      seats
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
      .single()

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
      await logAuditEvent(user.id, 'booking.delete', {
        bookingId: id,
        eventId: booking.event_id,
        eventName: (booking as any).events?.name,
        customerId: booking.customer_id,
        customerName: (booking as any).customers ? 
          `${(booking as any).customers.first_name} ${(booking as any).customers.last_name}` : 
          'Unknown',
        seats: booking.seats
      })
    }

    revalidatePath(`/events/${booking?.event_id}`)
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting booking:', error)
    return { error: 'An unexpected error occurred' }
  }
}