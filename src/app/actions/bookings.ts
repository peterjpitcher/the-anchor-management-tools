'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { BookingService } from '@/services/bookings'

// Booking validation schema
const bookingSchema = z.object({
  event_id: z.string().uuid('Invalid event ID'),
  customer_id: z.string().uuid('Invalid customer ID').optional(), // Made optional as handled by service if creating new
  seats: z.number()
    .min(0, 'Tickets cannot be negative')
    .max(100, 'Cannot book more than 100 tickets at once'),
  notes: z.string().max(500, 'Notes too long').optional(),
  is_reminder_only: z.boolean().optional()
})

export async function createBooking(formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const rawData = {
      event_id: formData.get('event_id') as string,
      customer_id: (formData.get('customer_id') as string) || undefined,
      seats: parseInt(formData.get('seats') as string || '0'),
      notes: formData.get('notes') as string || undefined,
      is_reminder_only: formData.get('is_reminder_only') === 'true',
      overwrite: formData.get('overwrite') === 'true',
      create_customer: formData.get('create_customer') === 'true',
      customer_first_name: (formData.get('customer_first_name') as string | null)?.trim() || '',
      customer_last_name: (formData.get('customer_last_name') as string | null)?.trim() || '',
      customer_email: (formData.get('customer_email') as string | null)?.trim() || '',
      customer_mobile_number: (formData.get('customer_mobile_number') as string | null)?.trim() || ''
    }

    // Validate basic fields
    const result = bookingSchema.safeParse({
      ...rawData,
      customer_id: rawData.customer_id // Zod will validate if present
    })

    if (!result.success) {
      return { error: result.error.errors[0].message }
    }

    let createCustomerInput;
    if (rawData.create_customer) {
      if (!rawData.customer_first_name || !rawData.customer_mobile_number) {
        return { error: 'Customer details are required' }
      }
      createCustomerInput = {
        firstName: rawData.customer_first_name,
        lastName: rawData.customer_last_name || undefined,
        email: rawData.customer_email || undefined,
        mobileNumber: rawData.customer_mobile_number
      };
    } else if (!rawData.customer_id) {
      return { error: 'Customer ID is required' }
    }

    try {
      const { booking, event, operation } = await BookingService.createBooking({
        eventId: rawData.event_id,
        customerId: rawData.customer_id,
        seats: rawData.seats,
        notes: rawData.notes,
        isReminderOnly: rawData.is_reminder_only,
        overwrite: rawData.overwrite,
        createCustomer: createCustomerInput,
        userId: user.id,
        userEmail: user.email
      });

      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: operation,
        resource_type: 'booking',
        resource_id: booking.id,
        operation_status: 'success',
        additional_info: {
          eventId: event.id,
          eventName: event.name,
          customerId: booking.customer_id,
          seats: booking.seats
        }
      });

      revalidatePath(`/events/${rawData.event_id}`)
      return { success: true, data: booking }

    } catch (error: any) {
      if (error.code === 'duplicate_booking') {
        return { error: 'duplicate_booking', existingBooking: error.existingBooking }
      }
      return { error: error.message || 'Failed to create booking' }
    }
  } catch (error) {
    console.error('Unexpected error creating booking:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createBulkBookings(eventId: string, customerIds: string[]) {
  // Keeping bulk booking logic here or move to service later if needed.
  // It's distinct enough from single booking flow.
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // ... (rest of existing bulk booking logic)
    // For brevity, I am keeping the existing bulk logic as it was not the primary target of this refactor
    // but ideally it moves to `BookingService.createBulkBookings`
    
    // [Original Logic for Bulk Bookings - Preserved for now]
    if (!eventId || !customerIds.length) return { error: 'Invalid request data' }
    const { data: event } = await supabase.from('events').select('name').eq('id', eventId).single()
    if (!event) return { error: 'Event not found' }

    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('event_id', eventId)
      .in('customer_id', customerIds)

    const existingSet = new Set(existingBookings?.map(b => b.customer_id) || [])
    const newIds = customerIds.filter(id => !existingSet.has(id))

    if (newIds.length === 0) return { error: 'All selected customers already booked' }

    const bookingsToInsert = newIds.map(cid => ({
      event_id: eventId,
      customer_id: cid,
      seats: 0,
      is_reminder_only: true,
      notes: 'Added via bulk add'
    }))

    const { data: bookings, error } = await supabase.from('bookings').insert(bookingsToInsert).select()
    if (error) return { error: 'Failed to create bookings' }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'bulk_create',
      resource_type: 'booking',
      operation_status: 'success',
      additional_info: { eventId, count: bookings.length }
    })

    revalidatePath(`/events/${eventId}`)
    return { success: true, data: bookings }
  } catch (error) {
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateBooking(id: string, formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const seats = parseInt(formData.get('seats') as string || '0')
    const notes = formData.get('notes') as string || undefined

    const { event } = await BookingService.updateBooking({
      id,
      seats,
      notes,
      userId: user.id,
      userEmail: user.email
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'booking',
      resource_id: id,
      operation_status: 'success',
      additional_info: { eventName: event?.name, seats }
    })

    // Need to fetch booking to get event_id for revalidation if not returned fully
    // The service returns event name/capacity but we need ID for path.
    // We can rely on the client or fetch it again if needed, but service should ideally return it.
    // Service implementation used `booking.event_id` internally.
    
    // Revalidating general events page for safety
    revalidatePath('/events')
    return { success: true }
  } catch (error: any) {
    return { error: error.message || 'An unexpected error occurred' }
  }
}

export async function deleteBooking(id: string) {
  try {
    const hasPermission = await checkUserPermission('events', 'manage')
    if (!hasPermission) return { error: 'Insufficient permissions' }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const booking = await BookingService.deleteBooking(id)

    if (booking) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'delete',
        resource_type: 'booking',
        resource_id: id,
        operation_status: 'success',
        additional_info: {
          eventName: Array.isArray(booking.events) ? booking.events[0]?.name : (booking.events as any)?.name,
          customerName: (() => { const c = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers; return c ? `${c.first_name} ${c.last_name}` : 'Unknown' })()
        }
      })
      if (booking.event_id) revalidatePath(`/events/${booking.event_id}`)
      if (booking.customer_id) revalidatePath(`/customers/${booking.customer_id}`)
    }
    
    revalidatePath('/events')
    return { success: true }
  } catch (error: any) {
    return { error: error.message || 'An unexpected error occurred' }
  }
}