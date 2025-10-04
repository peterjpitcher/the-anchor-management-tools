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
    const wasNoSeats = oldSeats === 0
    const willBeNoSeats = validatedData.seats === 0
    
    // Update the booking
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ 
        seats: validatedData.seats,
        updated_at: new Date().toISOString()
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
        flowChange: wasNoSeats !== willBeNoSeats ? `${wasNoSeats ? 'no_seats' : 'has_seats'} -> ${willBeNoSeats ? 'no_seats' : 'has_seats'}` : 'none'
      }
    })
    
    // Revalidate the event page
    revalidatePath(`/events/${booking.event.id}`)
    
    return { 
      success: true, 
      oldSeats,
      newSeats: validatedData.seats,
      flowChanged: wasNoSeats !== willBeNoSeats
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
