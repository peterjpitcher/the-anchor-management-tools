'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import type { Event, EventFAQ } from '@/types/database'
import { checkUserPermission } from '@/app/actions/rbac'
import { EventService, eventSchema, CreateEventInput, UpdateEventInput } from '@/services/events'
import { createClient } from '@/lib/supabase/server' // Required for getting user in action

type CreateEventResult = { error: string } | { success: true; data: Event }

// Helper to extract event data from FormData and apply category defaults
async function prepareEventDataFromFormData(formData: FormData, existingEventId?: string | null) {
  const supabase = await createClient(); // For fetching category defaults

  const categoryId = formData.get('category_id') as string || null;
  let categoryDefaults: Partial<CreateEventInput> = {};
  
  if (categoryId) {
    const { data: category } = await supabase
      .from('event_categories')
      .select('*')
      .eq('id', categoryId)
      .single();
    
    if (category) {
      categoryDefaults = {
        time: category.default_start_time,
        end_time: category.default_end_time,
        duration_minutes: category.default_duration_minutes,
        doors_time: category.default_doors_time,
        last_entry_time: category.default_last_entry_time,
        capacity: category.default_capacity,
        price: category.default_price,
        is_free: category.default_is_free,
        short_description: category.short_description,
        long_description: category.long_description,
        brief: category.brief,
        highlights: category.highlights,
        keywords: category.keywords,
        meta_title: category.meta_title,
        meta_description: category.meta_description,
        hero_image_url: category.image_url,
        promo_video_url: category.promo_video_url,
        highlight_video_urls: category.highlight_video_urls,
        gallery_image_urls: category.gallery_image_urls,
        performer_type: category.default_performer_type,
        event_status: category.default_event_status || 'scheduled',
        booking_url: category.default_booking_url
      };
    }
  }

  const rawData = Object.fromEntries(formData.entries());

  // Handle specific fields from form data
  const data: Partial<CreateEventInput> = {
    name: rawData.name as string,
    date: rawData.date as string,
    time: rawData.time as string || categoryDefaults.time,
    capacity: (rawData.capacity as string) ? Number(rawData.capacity) : categoryDefaults.capacity,
    category_id: categoryId,
    short_description: rawData.short_description as string || categoryDefaults.short_description || null,
    long_description: rawData.long_description as string || categoryDefaults.long_description || null,
    brief: (rawData.brief as string)?.trim() || categoryDefaults.brief || null,
    highlights: rawData.highlights ? JSON.parse(rawData.highlights as string) : categoryDefaults.highlights || [],
    keywords: rawData.keywords ? JSON.parse(rawData.keywords as string) : categoryDefaults.keywords || [],
    slug: (rawData.slug as string)?.trim() || null,
    meta_title: rawData.meta_title as string || categoryDefaults.meta_title || null,
    meta_description: rawData.meta_description as string || categoryDefaults.meta_description || null,
    end_time: rawData.end_time as string || categoryDefaults.end_time || null,
    duration_minutes: (rawData.duration_minutes as string) ? Number(rawData.duration_minutes) : categoryDefaults.duration_minutes || null,
    doors_time: rawData.doors_time as string || categoryDefaults.doors_time || null,
    last_entry_time: rawData.last_entry_time as string || categoryDefaults.last_entry_time || null,
    event_status: rawData.event_status as string || categoryDefaults.event_status || 'scheduled',
    performer_name: rawData.performer_name as string || null,
    performer_type: rawData.performer_type as string || categoryDefaults.performer_type || null,
    price: (rawData.price as string) ? Number(rawData.price) : categoryDefaults.price || 0,
    is_free: rawData.is_free === 'true' || categoryDefaults.is_free || false,
    booking_url: rawData.booking_url as string || categoryDefaults.booking_url || null,
    hero_image_url: rawData.hero_image_url as string || categoryDefaults.hero_image_url || null,
    thumbnail_image_url: rawData.thumbnail_image_url as string || null,
    poster_image_url: rawData.poster_image_url as string || null,
    promo_video_url: rawData.promo_video_url as string || categoryDefaults.promo_video_url || null,
    highlight_video_urls: rawData.highlight_video_urls ? JSON.parse(rawData.highlight_video_urls as string) : categoryDefaults.highlight_video_urls || [],
    gallery_image_urls: rawData.gallery_image_urls ? JSON.parse(rawData.gallery_image_urls as string) : categoryDefaults.gallery_image_urls || []
  };

  // Handle FAQs
  let faqs: Array<{question: string, answer: string, sort_order?: number}> = [];
  try {
    const faqsJson = formData.get('faqs') as string;
    if (faqsJson) {
      const parsed = JSON.parse(faqsJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
         faqs = parsed.filter(faq => faq.question && faq.answer);
      }
    }
  } catch (e) {
    console.error('Error parsing FAQs:', e);
  }
  (data as any).faqs = faqs;

  return data;
}

export async function createEvent(formData: FormData): Promise<CreateEventResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage');
    if (!canManageEvents) {
      return { error: 'Insufficient permissions to create events' };
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'Unauthorized' };
    }

    const rawData = await prepareEventDataFromFormData(formData);
    const validationResult = eventSchema.safeParse(rawData);

    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message };
    }

    const event = await EventService.createEvent(validationResult.data as CreateEventInput);

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'create',
      resource_type: 'event',
      resource_id: event.id,
      operation_status: 'success',
      additional_info: {
        eventName: event.name,
        eventDate: event.date,
        slug: event.slug
      }
    });

    revalidatePath('/events');
    return { success: true, data: event as Event };
  } catch (error: any) {
    console.error('Unexpected error creating event:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function updateEvent(id: string, formData: FormData) {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage');
    if (!canManageEvents) {
      return { error: 'Insufficient permissions to update events' };
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'Unauthorized' };
    }

    const rawData = await prepareEventDataFromFormData(formData, id); // Pass existingEventId if needed
    
    // For updates, we allow partial data, but still validate if fields are present
    const validationResult = eventSchema.partial().safeParse(rawData);
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message };
    }

    const event = await EventService.updateEvent(id, validationResult.data as UpdateEventInput);

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'event',
      resource_id: event.id,
      operation_status: 'success',
      additional_info: {
        eventName: event.name,
        eventDate: event.date,
        slug: event.slug
      }
    });

    revalidatePath('/events');
    revalidatePath(`/events/${id}`);
    return { success: true, data: event as Event };
  } catch (error: any) {
    console.error('Unexpected error updating event:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function deleteEvent(id: string) {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage');
    if (!canManageEvents) {
      return { error: 'Insufficient permissions to delete events' };
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'Unauthorized' };
    }

    const event = await EventService.deleteEvent(id);

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
    });

    revalidatePath('/events');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error deleting event:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function getEventFAQs(eventId: string): Promise<{ data?: EventFAQ[], error?: string }> {
  try {
    const data = await EventService.getEventFAQs(eventId);
    return { data };
  } catch (error: any) {
    console.error('Error fetching event FAQs:', error);
    return { error: error.message || 'Failed to fetch FAQs' };
  }
}

export async function getEventById(eventId: string): Promise<{ data?: Event | null, error?: string }> {
  try {
    const data = await EventService.getEventById(eventId);
    return { data };
  } catch (error: any) {
    console.error('Error fetching event by ID:', error);
    return { error: error.message || 'Failed to fetch event' };
  }
}

export async function getEvents(options?: {
  status?: 'all' | 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'sold_out';
  searchTerm?: string;
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderAsc?: boolean;
}): Promise<{ data?: Event[], pagination?: { totalCount: number, currentPage: number, pageSize: number, totalPages: number }, error?: string }> {
  try {
    const { events, pagination } = await EventService.getEvents(options);
    return { data: events, pagination };
  } catch (error: any) {
    console.error('Error fetching events:', error);
    return { error: error.message || 'Failed to fetch events' };
  }
}
