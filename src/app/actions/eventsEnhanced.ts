'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { EventFAQ } from '@/types/database'

// Enhanced event validation schema with SEO fields
const eventSchemaEnhanced = z.object({
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
  // Existing fields
  description: z.string().max(2000).nullable().optional(),
  end_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) return null
    return val
  }),
  event_status: z.enum(['scheduled', 'cancelled', 'postponed', 'rescheduled']).default('scheduled'),
  performer_name: z.string().max(255).nullable().optional(),
  performer_type: z.string().max(50).nullable().optional(),
  price: z.preprocess(
    (val) => val === '' ? 0 : Number(val),
    z.number().min(0).max(99999.99).default(0)
  ),
  price_currency: z.string().default('GBP'),
  is_free: z.boolean().default(false),
  booking_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  image_urls: z.array(z.string()).default([]).transform(urls => {
    return urls.filter(url => {
      if (!url || url.trim() === '') return false
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    })
  }),
  // Phase 1 SEO fields
  slug: z.string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase letters, numbers, and hyphens'),
  short_description: z.string().max(150).nullable().optional(),
  long_description: z.string().nullable().optional(),
  highlights: z.array(z.string()).default([]),
  meta_title: z.string().max(60).nullable().optional(),
  meta_description: z.string().max(160).nullable().optional(),
  keywords: z.array(z.string()).default([]),
  hero_image_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  gallery_image_urls: z.array(z.string()).default([]).transform(urls => {
    return urls.filter(url => {
      if (!url || url.trim() === '') return false
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    })
  }),
  poster_image_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  thumbnail_image_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  promo_video_url: z.string().nullable().optional().transform(val => {
    if (!val || val.trim() === '') return null
    try {
      new URL(val)
      return val
    } catch {
      return null
    }
  }),
  highlight_video_urls: z.array(z.string()).default([]).transform(urls => {
    return urls.filter(url => {
      if (!url || url.trim() === '') return false
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    })
  }),
  doors_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) return null
    return val
  }),
  duration_minutes: z.preprocess(
    (val) => val === '' ? null : Number(val),
    z.number().min(1).max(1440).nullable().optional() // Max 24 hours
  ),
  last_entry_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) return null
    return val
  }),
})

export async function createEventEnhanced(formData: FormData, faqs: Array<{question: string, answer: string, sort_order: number}>) {
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
      capacity: formData.get('capacity') as string || null,
      category_id: formData.get('category_id') as string || null,
      description: formData.get('description') as string || null,
      end_time: formData.get('end_time') as string || null,
      event_status: formData.get('event_status') as string || 'scheduled',
      performer_name: formData.get('performer_name') as string || null,
      performer_type: formData.get('performer_type') as string || null,
      price: formData.get('price') as string || '0',
      price_currency: formData.get('price_currency') as string || 'GBP',
      is_free: formData.get('is_free') === 'true',
      booking_url: formData.get('booking_url') as string || null,
      image_urls: (() => {
        try {
          const urls = formData.get('image_urls') as string
          return urls ? JSON.parse(urls) : []
        } catch {
          return []
        }
      })(),
      // SEO fields
      slug: formData.get('slug') as string,
      short_description: formData.get('short_description') as string || null,
      long_description: formData.get('long_description') as string || null,
      highlights: (() => {
        try {
          const highlights = formData.get('highlights') as string
          return highlights ? JSON.parse(highlights) : []
        } catch {
          return []
        }
      })(),
      meta_title: formData.get('meta_title') as string || null,
      meta_description: formData.get('meta_description') as string || null,
      keywords: (() => {
        try {
          const keywords = formData.get('keywords') as string
          return keywords ? JSON.parse(keywords) : []
        } catch {
          return []
        }
      })(),
      hero_image_url: formData.get('hero_image_url') as string || null,
      gallery_image_urls: (() => {
        try {
          const urls = formData.get('gallery_image_urls') as string
          return urls ? JSON.parse(urls) : []
        } catch {
          return []
        }
      })(),
      poster_image_url: formData.get('poster_image_url') as string || null,
      thumbnail_image_url: formData.get('thumbnail_image_url') as string || null,
      promo_video_url: formData.get('promo_video_url') as string || null,
      highlight_video_urls: (() => {
        try {
          const urls = formData.get('highlight_video_urls') as string
          return urls ? JSON.parse(urls) : []
        } catch {
          return []
        }
      })(),
      doors_time: formData.get('doors_time') as string || null,
      duration_minutes: formData.get('duration_minutes') as string || null,
      last_entry_time: formData.get('last_entry_time') as string || null,
    }

    const validationResult = eventSchemaEnhanced.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Check for duplicate event (same slug)
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('slug', data.slug)
      .single()

    if (existing) {
      return { error: 'An event with this URL slug already exists' }
    }

    // Start a transaction
    const { data: event, error } = await supabase
      .from('events')
      .insert(data)
      .select()
      .single()

    if (error) {
      console.error('Event creation error:', error)
      return { error: 'Failed to create event' }
    }

    // Create FAQs if provided
    if (faqs.length > 0) {
      const validFaqs = faqs.filter(faq => faq.question && faq.answer)
      if (validFaqs.length > 0) {
        const faqData = validFaqs.map((faq, index) => ({
          event_id: event.id,
          question: faq.question,
          answer: faq.answer,
          sort_order: faq.sort_order || index * 10
        }))

        const { error: faqError } = await supabase
          .from('event_faqs')
          .insert(faqData)

        if (faqError) {
          console.error('FAQ creation error:', faqError)
          // Note: We don't fail the event creation if FAQs fail
        }
      }
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'create',
      resource_type: 'event',
      resource_id: event.id,
      operation_status: 'success',
      additional_info: {
        eventName: event.name,
        eventDate: event.date,
        eventSlug: event.slug
      }
    })

    revalidatePath('/events')
    return { success: true, data: event }
  } catch (error) {
    console.error('Unexpected error creating event:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateEventEnhanced(
  id: string, 
  formData: FormData, 
  faqs: Array<{question: string, answer: string, sort_order: number}>
) {
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
      capacity: formData.get('capacity') as string || null,
      category_id: formData.get('category_id') as string || null,
      description: formData.get('description') as string || null,
      end_time: formData.get('end_time') as string || null,
      event_status: formData.get('event_status') as string || 'scheduled',
      performer_name: formData.get('performer_name') as string || null,
      performer_type: formData.get('performer_type') as string || null,
      price: formData.get('price') as string || '0',
      price_currency: formData.get('price_currency') as string || 'GBP',
      is_free: formData.get('is_free') === 'true',
      booking_url: formData.get('booking_url') as string || null,
      image_urls: (() => {
        try {
          const urls = formData.get('image_urls') as string
          return urls ? JSON.parse(urls) : []
        } catch {
          return []
        }
      })(),
      // SEO fields
      slug: formData.get('slug') as string,
      short_description: formData.get('short_description') as string || null,
      long_description: formData.get('long_description') as string || null,
      highlights: (() => {
        try {
          const highlights = formData.get('highlights') as string
          return highlights ? JSON.parse(highlights) : []
        } catch {
          return []
        }
      })(),
      meta_title: formData.get('meta_title') as string || null,
      meta_description: formData.get('meta_description') as string || null,
      keywords: (() => {
        try {
          const keywords = formData.get('keywords') as string
          return keywords ? JSON.parse(keywords) : []
        } catch {
          return []
        }
      })(),
      hero_image_url: formData.get('hero_image_url') as string || null,
      gallery_image_urls: (() => {
        try {
          const urls = formData.get('gallery_image_urls') as string
          return urls ? JSON.parse(urls) : []
        } catch {
          return []
        }
      })(),
      poster_image_url: formData.get('poster_image_url') as string || null,
      thumbnail_image_url: formData.get('thumbnail_image_url') as string || null,
      promo_video_url: formData.get('promo_video_url') as string || null,
      highlight_video_urls: (() => {
        try {
          const urls = formData.get('highlight_video_urls') as string
          return urls ? JSON.parse(urls) : []
        } catch {
          return []
        }
      })(),
      doors_time: formData.get('doors_time') as string || null,
      duration_minutes: formData.get('duration_minutes') as string || null,
      last_entry_time: formData.get('last_entry_time') as string || null,
    }

    // Use a modified schema for past events
    const updateSchema = currentEvent && new Date(currentEvent.date) < new Date() 
      ? eventSchemaEnhanced.omit({ date: true }).extend({
          date: z.string().min(1, 'Date is required')
        })
      : eventSchemaEnhanced

    const validationResult = updateSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Check for duplicate slug (excluding current event)
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('slug', data.slug)
      .neq('id', id)
      .single()

    if (existing) {
      return { error: 'An event with this URL slug already exists' }
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

    // Update FAQs
    // First, delete existing FAQs
    await supabase
      .from('event_faqs')
      .delete()
      .eq('event_id', id)

    // Then, insert new FAQs if provided
    if (faqs.length > 0) {
      const validFaqs = faqs.filter(faq => faq.question && faq.answer)
      if (validFaqs.length > 0) {
        const faqData = validFaqs.map((faq, index) => ({
          event_id: event.id,
          question: faq.question,
          answer: faq.answer,
          sort_order: faq.sort_order || index * 10
        }))

        const { error: faqError } = await supabase
          .from('event_faqs')
          .insert(faqData)

        if (faqError) {
          console.error('FAQ update error:', faqError)
        }
      }
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'update',
      resource_type: 'event',
      resource_id: event.id,
      operation_status: 'success',
      additional_info: {
        eventName: event.name,
        eventDate: event.date,
        eventSlug: event.slug
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

export async function getEventFAQs(eventId: string): Promise<{ data?: EventFAQ[], error?: string }> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('event_faqs')
      .select('*')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true })

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching event FAQs:', error)
    return { error: 'Failed to fetch FAQs' }
  }
}