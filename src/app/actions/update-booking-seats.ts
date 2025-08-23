'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { sendBookingConfirmationSync } from './sms'
import { updateBookingReminders, scheduleBookingReminders } from './event-sms-scheduler'
import { logger } from '@/lib/logger'

const updateSeatsSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
  seats: z.number().min(0, 'Seats cannot be negative').max(100, 'Cannot book more than 100 seats')
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
    
    // Handle SMS flow changes
    if (wasNoSeats && !willBeNoSeats) {
      // Changed from no seats to has seats
      logger.info('Booking changed from no seats to has seats', {
        metadata: { bookingId: validatedData.bookingId, oldSeats, newSeats: validatedData.seats }
      })
      
      // Send immediate confirmation
      try {
        await sendBookingConfirmationSync(validatedData.bookingId)
      } catch (error) {
        logger.error('Failed to send confirmation SMS', {
          error: error as Error,
          metadata: { bookingId: validatedData.bookingId }
        })
      }
      
      // Update reminders to has-seats flow
      await updateBookingReminders(
        validatedData.bookingId,
        booking.event.date,
        booking.event.time,
        true // Has seats
      )
      
    } else if (!wasNoSeats && willBeNoSeats) {
      // Changed from has seats to no seats (cancellation)
      logger.info('Booking changed from has seats to no seats', {
        metadata: { bookingId: validatedData.bookingId, oldSeats, newSeats: validatedData.seats }
      })
      
      // Update reminders to no-seats flow
      await updateBookingReminders(
        validatedData.bookingId,
        booking.event.date,
        booking.event.time,
        false // No seats
      )
      
    } else if (!wasNoSeats && !willBeNoSeats && oldSeats !== validatedData.seats) {
      // Just changing seat count (still has seats)
      logger.info('Booking seat count updated', {
        metadata: { bookingId: validatedData.bookingId, oldSeats, newSeats: validatedData.seats }
      })
      
      // No need to change reminders, they stay as has-seats flow
      // But could send an update SMS if desired
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
    return { error: 'Failed to update booking seats' }
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