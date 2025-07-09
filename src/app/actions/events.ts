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
  category_id: z.string().uuid().nullable().optional(),
  // Content fields
  description: z.string().max(2000).nullable().optional(),
  short_description: z.string().max(500).nullable().optional(),
  long_description: z.string().nullable().optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  // SEO fields
  meta_title: z.string().max(255).nullable().optional(),
  meta_description: z.string().max(500).nullable().optional(),
  // Time fields
  end_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    // Validate time format if provided
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) return null
    return val
  }),
  duration_minutes: z.number().nullable().optional(),
  doors_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    // Validate time format if provided
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) return null
    return val
  }),
  last_entry_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    // Validate time format if provided
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) return null
    return val
  }),
  // Event details
  event_status: z.enum(['scheduled', 'cancelled', 'postponed', 'rescheduled']).default('scheduled'),
  performer_name: z.string().max(255).nullable().optional(),
  performer_type: z.string().max(50).nullable().optional(),
  // Pricing
  price: z.preprocess(
    (val) => val === '' ? 0 : Number(val),
    z.number().min(0).max(99999.99).default(0)
  ),
  price_currency: z.string().default('GBP'),
  is_free: z.boolean().default(false),
  booking_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    // Basic URL validation
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  // Media fields - using existing database fields
  hero_image_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    // Basic URL validation
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  thumbnail_image_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    // Basic URL validation
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  poster_image_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    // Basic URL validation
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  promo_video_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    // Basic URL validation
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  highlight_video_urls: z.array(z.string()).default([]).transform(urls => {
    // Filter out empty strings and validate URLs
    return urls.filter(url => {
      if (!url || url.trim() === '') return false
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    })
  })
})

export async function createEvent(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get category ID to fetch defaults
    const categoryId = formData.get('category_id') as string || null
    let categoryDefaults: any = {}
    
    // Fetch category defaults if category is selected
    if (categoryId) {
      const { data: category } = await supabase
        .from('event_categories')
        .select('*')
        .eq('id', categoryId)
        .single()
      
      if (category) {
        categoryDefaults = {
          // Time defaults
          time: category.default_start_time,
          end_time: category.default_end_time,
          duration_minutes: category.default_duration_minutes,
          doors_time: category.default_doors_time,
          last_entry_time: category.default_last_entry_time,
          // Capacity and pricing
          capacity: category.default_capacity,
          price: category.default_price,
          is_free: category.default_is_free,
          // Content defaults
          description: category.description,
          short_description: category.short_description,
          long_description: category.long_description,
          highlights: category.highlights,
          keywords: category.keywords,
          // SEO defaults
          meta_title: category.meta_title,
          meta_description: category.meta_description,
          // Media defaults
          hero_image_url: category.image_url,
          promo_video_url: category.promo_video_url,
          highlight_video_urls: category.highlight_video_urls,
          // Other defaults
          performer_type: category.default_performer_type,
          event_status: category.default_event_status || 'scheduled',
          booking_url: category.default_booking_url
        }
      }
    }

    // Parse form data with category defaults as fallback
    const rawData = {
      name: formData.get('name') as string,
      date: formData.get('date') as string,
      time: formData.get('time') as string || categoryDefaults.time,
      capacity: formData.get('capacity') as string || categoryDefaults.capacity?.toString(),
      category_id: categoryId,
      description: formData.get('description') as string || categoryDefaults.description || null,
      short_description: formData.get('short_description') as string || categoryDefaults.short_description || null,
      long_description: formData.get('long_description') as string || categoryDefaults.long_description || null,
      highlights: formData.get('highlights') ? JSON.parse(formData.get('highlights') as string) : categoryDefaults.highlights || [],
      keywords: formData.get('keywords') ? JSON.parse(formData.get('keywords') as string) : categoryDefaults.keywords || [],
      meta_title: formData.get('meta_title') as string || categoryDefaults.meta_title || null,
      meta_description: formData.get('meta_description') as string || categoryDefaults.meta_description || null,
      end_time: formData.get('end_time') as string || categoryDefaults.end_time || null,
      duration_minutes: formData.get('duration_minutes') ? parseInt(formData.get('duration_minutes') as string) : categoryDefaults.duration_minutes || null,
      doors_time: formData.get('doors_time') as string || categoryDefaults.doors_time || null,
      last_entry_time: formData.get('last_entry_time') as string || categoryDefaults.last_entry_time || null,
      event_status: formData.get('event_status') as string || categoryDefaults.event_status || 'scheduled',
      performer_name: formData.get('performer_name') as string || null,
      performer_type: formData.get('performer_type') as string || categoryDefaults.performer_type || null,
      price: formData.get('price') as string || categoryDefaults.price?.toString() || '0',
      price_currency: formData.get('price_currency') as string || 'GBP',
      is_free: formData.get('is_free') ? formData.get('is_free') === 'true' : categoryDefaults.is_free || false,
      booking_url: formData.get('booking_url') as string || categoryDefaults.booking_url || null,
      hero_image_url: formData.get('hero_image_url') as string || categoryDefaults.hero_image_url || null,
      thumbnail_image_url: formData.get('thumbnail_image_url') as string || null,
      poster_image_url: formData.get('poster_image_url') as string || null,
      promo_video_url: formData.get('promo_video_url') as string || categoryDefaults.promo_video_url || null,
      highlight_video_urls: formData.get('highlight_video_urls') ? JSON.parse(formData.get('highlight_video_urls') as string) : categoryDefaults.highlight_video_urls || []
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
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'create',
      resource_type: 'event',
      resource_id: event.id,
      operation_status: 'success',
      additional_info: {
        eventName: event.name,
        eventDate: event.date
      }
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
      category_id: formData.get('category_id') as string || null,
      description: formData.get('description') as string || null,
      short_description: formData.get('short_description') as string || null,
      long_description: formData.get('long_description') as string || null,
      highlights: formData.get('highlights') ? JSON.parse(formData.get('highlights') as string) : [],
      keywords: formData.get('keywords') ? JSON.parse(formData.get('keywords') as string) : [],
      meta_title: formData.get('meta_title') as string || null,
      meta_description: formData.get('meta_description') as string || null,
      end_time: formData.get('end_time') as string || null,
      duration_minutes: formData.get('duration_minutes') ? parseInt(formData.get('duration_minutes') as string) : null,
      doors_time: formData.get('doors_time') as string || null,
      last_entry_time: formData.get('last_entry_time') as string || null,
      event_status: formData.get('event_status') as string || 'scheduled',
      performer_name: formData.get('performer_name') as string || null,
      performer_type: formData.get('performer_type') as string || null,
      price: formData.get('price') as string || '0',
      price_currency: formData.get('price_currency') as string || 'GBP',
      is_free: formData.get('is_free') === 'true',
      booking_url: formData.get('booking_url') as string || null,
      hero_image_url: formData.get('hero_image_url') as string || null,
      thumbnail_image_url: formData.get('thumbnail_image_url') as string || null,
      poster_image_url: formData.get('poster_image_url') as string || null,
      promo_video_url: formData.get('promo_video_url') as string || null,
      highlight_video_urls: formData.get('highlight_video_urls') ? JSON.parse(formData.get('highlight_video_urls') as string) : []
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
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'event',
      resource_id: event.id,
      operation_status: 'success',
      additional_info: {
        eventName: event.name,
        eventDate: event.date
      }
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
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'delete',
        resource_type: 'event',
        resource_id: id,
        operation_status: 'success',
        additional_info: {
          eventName: event.name,
          eventDate: event.date
        }
      })
    }

    revalidatePath('/events')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting event:', error)
    return { error: 'An unexpected error occurred' }
  }
}