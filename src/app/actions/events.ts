'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'

// Event validation schema
const eventSchema = z.object({
  name: z.string().min(1, 'Event name is required').max(200, 'Event name too long'),
  date: z.string()
    .min(1, 'Date is required')
    .refine((val) => {
      const date = new Date(val)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const oneYearFromNow = new Date()
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
      
      return date >= today && date <= oneYearFromNow
    }, 'Date must be between today and one year from now'),
  time: z.string()
    .min(1, 'Time is required')
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
  capacity: z.preprocess(
    (val) => val === '' ? null : Number(val),
    z.number().min(1, 'Capacity must be at least 1').max(10000, 'Capacity too large').nullable()
  ),
  category_id: z.string().uuid().nullable().optional()
})

export async function createEvent(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Parse and validate form data
    const rawData = {
      name: formData.get('name') as string,
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      capacity: formData.get('capacity') as string,
      category_id: formData.get('category_id') as string || null
    }

    const validationResult = eventSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Check for duplicate event (same name and date)
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('name', data.name)
      .eq('date', data.date)
      .single()

    if (existing) {
      return { error: 'An event with this name already exists on this date' }
    }

    // Create event
    const { data: event, error } = await supabase
      .from('events')
      .insert(data)
      .select()
      .single()

    if (error) {
      console.error('Event creation error:', error)
      return { error: 'Failed to create event' }
    }

    // Log audit event
    await logAuditEvent(user.id, 'event.create', {
      eventId: event.id,
      eventName: event.name,
      eventDate: event.date
    })

    revalidatePath('/events')
    return { success: true, data: event }
  } catch (error) {
    console.error('Unexpected error creating event:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateEvent(id: string, formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get the current event to check if it's in the past
    const { data: currentEvent } = await supabase
      .from('events')
      .select('date')
      .eq('id', id)
      .single()

    // Parse and validate form data
    const rawData = {
      name: formData.get('name') as string,
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      capacity: formData.get('capacity') as string,
      category_id: formData.get('category_id') as string || null
    }

    // Use a modified schema for past events
    const updateSchema = currentEvent && new Date(currentEvent.date) < new Date() 
      ? eventSchema.omit({ date: true }).extend({
          date: z.string().min(1, 'Date is required')
        })
      : eventSchema

    const validationResult = updateSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Check for duplicate event (excluding current event)
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('name', data.name)
      .eq('date', data.date)
      .neq('id', id)
      .single()

    if (existing) {
      return { error: 'An event with this name already exists on this date' }
    }

    // If capacity is being reduced, check if it would be below current bookings
    if (data.capacity !== null) {
      const { data: bookings } = await supabase
        .from('bookings')
        .select('seats')
        .eq('event_id', id)

      if (bookings) {
        const totalSeats = bookings.reduce((sum, b) => sum + (b.seats || 0), 0)
        if (totalSeats > data.capacity) {
          return { error: `Cannot reduce capacity below current bookings (${totalSeats} seats booked)` }
        }
      }
    }

    // Update event
    const { data: event, error } = await supabase
      .from('events')
      .update(data)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Event update error:', error)
      return { error: 'Failed to update event' }
    }

    // Log audit event
    await logAuditEvent(user.id, 'event.update', {
      eventId: event.id,
      eventName: event.name,
      eventDate: event.date
    })

    revalidatePath('/events')
    revalidatePath(`/events/${id}`)
    return { success: true, data: event }
  } catch (error) {
    console.error('Unexpected error updating event:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteEvent(id: string) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get event details for audit log
    const { data: event } = await supabase
      .from('events')
      .select('name, date')
      .eq('id', id)
      .single()

    // Check if event has bookings
    const { count } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id)

    if (count && count > 0) {
      return { error: 'Cannot delete event with existing bookings' }
    }

    // Delete event
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Event deletion error:', error)
      return { error: 'Failed to delete event' }
    }

    // Log audit event
    if (event) {
      await logAuditEvent(user.id, 'event.delete', {
        eventId: id,
        eventName: event.name,
        eventDate: event.date
      })
    }

    revalidatePath('/events')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting event:', error)
    return { error: 'An unexpected error occurred' }
  }
}