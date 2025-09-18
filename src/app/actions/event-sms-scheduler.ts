'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { logAuditEvent } from './audit'

interface ReminderSchedule {
  reminder_type: string
  scheduled_for: Date
}

/**
 * Calculate which reminders to schedule based on event date and booking status
 */
export async function calculateReminderSchedule(
  eventDate: string,
  eventTime: string,
  hasSeats: boolean
): Promise<ReminderSchedule[]> {
  const reminders: ReminderSchedule[] = []
  
  // Combine date and time for accurate scheduling
  const eventDateTime = new Date(`${eventDate}T${eventTime}`)
  const now = new Date()
  const daysUntilEvent = Math.floor((eventDateTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  
  if (hasSeats) {
    // Has seats: 1 week and 1 day before
    if (daysUntilEvent >= 7) {
      const oneWeekBefore = new Date(eventDateTime)
      oneWeekBefore.setDate(oneWeekBefore.getDate() - 7)
      oneWeekBefore.setHours(10, 0, 0, 0) // Send at 10 AM
      reminders.push({
        reminder_type: 'has_seats_1_week',
        scheduled_for: oneWeekBefore
      })
    }
    
    if (daysUntilEvent >= 1) {
      const oneDayBefore = new Date(eventDateTime)
      oneDayBefore.setDate(oneDayBefore.getDate() - 1)
      oneDayBefore.setHours(10, 0, 0, 0) // Send at 10 AM
      reminders.push({
        reminder_type: 'has_seats_day_before',
        scheduled_for: oneDayBefore
      })
    }
  } else {
    // No seats: 2 weeks, 1 week, and 1 day before
    if (daysUntilEvent >= 14) {
      const twoWeeksBefore = new Date(eventDateTime)
      twoWeeksBefore.setDate(twoWeeksBefore.getDate() - 14)
      twoWeeksBefore.setHours(10, 0, 0, 0) // Send at 10 AM
      reminders.push({
        reminder_type: 'no_seats_2_weeks',
        scheduled_for: twoWeeksBefore
      })
    } else if (daysUntilEvent >= 7) {
      // If less than 14 days but more than 7, send initial invitation immediately
      reminders.push({
        reminder_type: 'no_seats_2_weeks', // Use the invitation template
        scheduled_for: new Date() // Send now
      })
    }
    
    if (daysUntilEvent >= 7) {
      const oneWeekBefore = new Date(eventDateTime)
      oneWeekBefore.setDate(oneWeekBefore.getDate() - 7)
      oneWeekBefore.setHours(10, 0, 0, 0) // Send at 10 AM
      reminders.push({
        reminder_type: 'no_seats_1_week',
        scheduled_for: oneWeekBefore
      })
    } else if (daysUntilEvent >= 1) {
      // If less than 7 days but more than 1, send urgency message immediately
      reminders.push({
        reminder_type: 'no_seats_1_week', // Use the urgency template
        scheduled_for: new Date() // Send now
      })
    }
    
    if (daysUntilEvent >= 1) {
      const oneDayBefore = new Date(eventDateTime)
      oneDayBefore.setDate(oneDayBefore.getDate() - 1)
      oneDayBefore.setHours(10, 0, 0, 0) // Send at 10 AM
      reminders.push({
        reminder_type: 'no_seats_day_before',
        scheduled_for: oneDayBefore
      })
    } else if (daysUntilEvent === 0) {
      // Event is today, send last chance message immediately
      reminders.push({
        reminder_type: 'no_seats_day_before',
        scheduled_for: new Date() // Send now
      })
    }
  }
  
  return reminders
}

/**
 * Schedule SMS reminders for a booking
 */
export async function scheduleBookingReminders(
  bookingId: string,
  eventDate: string,
  eventTime: string,
  hasSeats: boolean
) {
  const supabase = createAdminClient()
  
  try {
    // Calculate which reminders to schedule
    const reminders = await calculateReminderSchedule(eventDate, eventTime, hasSeats)
    
    if (reminders.length === 0) {
      logger.info('No reminders to schedule', { 
        metadata: { bookingId, eventDate, hasSeats } 
      })
      return { success: true, scheduled: 0 }
    }
    
    // Check for existing reminders to avoid duplicates
    const { data: existingReminders } = await supabase
      .from('booking_reminders')
      .select('reminder_type')
      .eq('booking_id', bookingId)
      .in('status', ['pending', 'sent'])
    
    const existingTypes = new Set(existingReminders?.map(r => r.reminder_type) || [])
    
    // Filter out reminders that already exist
    const newReminders = reminders.filter(r => !existingTypes.has(r.reminder_type))
    
    if (newReminders.length === 0) {
      logger.info('All reminders already scheduled', { 
        metadata: { bookingId } 
      })
      return { success: true, scheduled: 0 }
    }
    
    // Insert new reminders
    const remindersToInsert = newReminders.map(reminder => ({
      booking_id: bookingId,
      reminder_type: reminder.reminder_type,
      scheduled_for: reminder.scheduled_for.toISOString(),
      status: 'pending'
    }))
    
    const { error } = await supabase
      .from('booking_reminders')
      .insert(remindersToInsert)
    
    if (error) {
      logger.error('Failed to schedule reminders', {
        error: error as Error,
        metadata: { bookingId, reminders: newReminders }
      })
      return { error: 'Failed to schedule reminders' }
    }
    
    logger.info('Reminders scheduled successfully', {
      metadata: { 
        bookingId, 
        scheduled: newReminders.length,
        types: newReminders.map(r => r.reminder_type)
      }
    })
    
    return { success: true, scheduled: newReminders.length }
  } catch (error) {
    logger.error('Error scheduling reminders', {
      error: error as Error,
      metadata: { bookingId }
    })
    return { error: 'Failed to schedule reminders' }
  }
}

/**
 * Cancel pending reminders for a booking
 */
export async function cancelBookingReminders(
  bookingId: string,
  reminderTypes?: string[]
) {
  const supabase = createAdminClient()
  
  try {
    let query = supabase
      .from('booking_reminders')
      .update({ status: 'cancelled' })
      .eq('booking_id', bookingId)
      .eq('status', 'pending')
    
    // Optionally cancel only specific types
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

/**
 * Update reminders when booking status changes (e.g., from no seats to has seats)
 */
export async function updateBookingReminders(
  bookingId: string,
  eventDate: string,
  eventTime: string,
  newHasSeats: boolean
) {
  try {
    // Cancel existing pending reminders
    await cancelBookingReminders(bookingId)
    
    // Schedule new reminders based on new status
    const result = await scheduleBookingReminders(
      bookingId,
      eventDate,
      eventTime,
      newHasSeats
    )
    
    return result
  } catch (error) {
    logger.error('Error updating reminders', {
      error: error as Error,
      metadata: { bookingId, newHasSeats }
    })
    return { error: 'Failed to update reminders' }
  }
}

/**
 * Create bookings via Add Attendees with scheduled SMS
 */
export async function addAttendeesWithScheduledSMS(
  eventId: string,
  customerIds: string[]
) {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, date, time')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      return { error: 'Event not found' }
    }

    const uniqueCustomerIds = Array.from(new Set(customerIds))

    // Check which customers already have bookings
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

    // Create bookings with bulk_add source
    const newBookings = customersToAdd.map(customerId => ({
      event_id: eventId,
      customer_id: customerId,
      seats: 0, // No seats for bulk add
      booking_source: 'bulk_add',
      notes: 'Added via bulk add'
    }))

    const insertedBookings: { id: string; customer_id: string }[] = []
    const chunkSize = 100

    for (let i = 0; i < newBookings.length; i += chunkSize) {
      const chunk = newBookings.slice(i, i + chunkSize)
      const { data, error } = await supabase
        .from('bookings')
        .insert(chunk)
        .select('id, customer_id')

      if (error || !data) {
        return { error: 'Failed to create bookings' }
      }

      insertedBookings.push(...data)
    }

    // Use admin client for scheduling reminders
    const adminSupabase = createAdminClient()

    // Schedule reminders for each booking
    let scheduledCount = 0
    for (const booking of insertedBookings) {
      const result = await scheduleBookingReminders(
        booking.id,
        event.date,
        event.time,
        false // No seats
      )
      
      if (result.success) {
        scheduledCount += result.scheduled || 0
      }
    }
    
    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'create',
      resource_type: 'booking',
      operation_status: 'success',
      additional_info: {
        eventId,
        eventName: event.name,
        customersAdded: customersToAdd.length,
        remindersScheduled: scheduledCount,
        source: 'bulk_add'
      }
    })
    
    return {
      success: true,
      added: customersToAdd.length,
      skipped: uniqueCustomerIds.length - customersToAdd.length,
      remindersScheduled: scheduledCount
    }
  } catch (error) {
    logger.error('Error in addAttendeesWithScheduledSMS', {
      error: error as Error,
      metadata: { eventId, customerCount: customerIds.length }
    })
    return { error: 'Failed to add attendees' }
  }
}
