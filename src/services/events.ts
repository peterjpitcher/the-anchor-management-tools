import { createClient } from '@/lib/supabase/server';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { generateEventMarketingLinks } from '@/app/actions/event-marketing-links';
import { z } from 'zod';

function sanitizeEventSearchTerm(value: string): string {
  return value
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export type CreateEventInput = {
  name: string;
  date: string;
  time: string;
  capacity?: number | null;
  booking_mode?: 'table' | 'general' | 'mixed' | null;
  event_type?: string | null;
  category_id?: string | null;
  short_description?: string | null;
  long_description?: string | null;
  brief?: string | null;
  highlights?: string[];
  keywords?: string[];
  slug?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  doors_time?: string | null;
  last_entry_time?: string | null;
  event_status?: string;
  performer_name?: string | null;
  performer_type?: string | null;
  price?: number;
  is_free?: boolean;
  booking_url?: string | null;
  hero_image_url?: string | null;
  thumbnail_image_url?: string | null;
  poster_image_url?: string | null;
  promo_video_url?: string | null;
  highlight_video_urls?: string[];
  gallery_image_urls?: string[];
  faqs?: Array<{ question: string; answer: string; sort_order?: number }>;
};

export type UpdateEventInput = Partial<CreateEventInput>;

const eventFaqSchema = z.object({
  question: z.string().trim().min(1, 'FAQ question is required'),
  answer: z.string().trim().min(1, 'FAQ answer is required'),
  sort_order: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined
    const parsed = Number(val)
    return Number.isNaN(parsed) ? undefined : parsed
  }, z.number().int().min(0).optional())
})

const PUBLISHED_EVENT_STATUSES = new Set([
  'scheduled',
  'cancelled',
  'postponed',
  'rescheduled',
  'sold_out'
])

type PublishValidationInput = {
  status?: string | null
  name?: string | null
  date?: string | null
  time?: string | null
  slug?: string | null
  short_description?: string | null
  hero_image_url?: string | null
  thumbnail_image_url?: string | null
  poster_image_url?: string | null
  is_free?: boolean | null
  price?: number | null
}

function hasValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
}

function isPublishedStatus(status: string | null | undefined): boolean {
  if (!status) return false
  return PUBLISHED_EVENT_STATUSES.has(status)
}

function normalizeSlugValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getPublishValidationIssues(input: PublishValidationInput): string[] {
  if (!isPublishedStatus(input.status || null)) {
    return []
  }

  const missing: string[] = []

  if (!hasValue(input.name)) missing.push('event name')
  if (!hasValue(input.date)) missing.push('event date')
  if (!hasValue(input.time)) missing.push('event start time')
  if (!hasValue(input.slug)) missing.push('URL slug')
  if (!hasValue(input.short_description)) missing.push('short description')

  const hasImage =
    hasValue(input.hero_image_url) ||
    hasValue(input.thumbnail_image_url) ||
    hasValue(input.poster_image_url)

  if (!hasImage) {
    missing.push('event image')
  }

  const isFree = input.is_free === true
  const price = typeof input.price === 'number' && Number.isFinite(input.price) ? input.price : null

  if (!isFree && (price === null || price <= 0)) {
    missing.push('ticket price (or mark event as free)')
  }

  return missing
}

// Helper function to generate a URL-friendly slug
function generateSlug(name: string, date: string): string {
  const nameSlug = normalizeSlugValue(name).substring(0, 100)

  const dateStr = toLocalIsoDate(new Date(date))

  return normalizeSlugValue(`${nameSlug}-${dateStr}`)
}

// Helper function to format time to HH:MM
function formatTimeToHHMM(time: string | undefined | null): string | undefined | null {
  if (!time) return time

  if (/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    return time
  }

  const [hours, minutes] = time.split(':')
  const formattedHours = hours.padStart(2, '0')
  const formattedMinutes = (minutes || '00').padStart(2, '0')

  return `${formattedHours}:${formattedMinutes}`
}

// Event validation schema
export const eventSchema = z.object({
  name: z.string().min(1, 'Event name is required').max(200, 'Event name too long'),
  date: z.string()
    .min(1, 'Date is required')
    .refine((val) => {
      return true
    }, 'Date must be valid'),
  time: z.string()
    .min(1, 'Time is required')
    .refine((val) => /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$|^24:00(:00)?$/.test(val), 'Invalid time format (HH:MM)')
    .transform(val => {
      if (val.startsWith('24:00')) return '00:00'
      const parts = val.split(':')
      if (parts.length < 2) return val
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
    }),
  capacity: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    },
    z.number().min(1, 'Capacity must be at least 1').max(10000, 'Capacity too large').nullable()
  ),
  category_id: z.string().uuid().nullable().optional(),
  short_description: z.string().max(500).nullable().optional(),
  long_description: z.string().nullable().optional(),
  brief: z.string().max(8000).nullable().optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase letters, numbers, and hyphens').nullable().optional(),
  meta_title: z.string().max(255).nullable().optional(),
  meta_description: z.string().max(500).nullable().optional(),
  end_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    if (val.startsWith('24:00')) return '00:00'
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(val)) return null
    const parts = val.split(':')
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }),
  duration_minutes: z.number().nullable().optional(),
  doors_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    if (val.startsWith('24:00')) return '00:00'
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(val)) return null
    const parts = val.split(':')
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }),
  last_entry_time: z.string().optional().nullable().transform(val => {
    if (!val || val.trim() === '') return null
    if (val.startsWith('24:00')) return '00:00'
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(val)) return null
    const parts = val.split(':')
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }),
  event_status: z.enum(['scheduled', 'cancelled', 'postponed', 'rescheduled', 'sold_out', 'draft']).default('scheduled'),
  booking_mode: z.enum(['table', 'general', 'mixed']).default('table'),
  event_type: z.string().trim().max(120).nullable().optional().transform((val) => {
    if (!val) return null
    return val.length > 0 ? val : null
  }),
  performer_name: z.string().max(255).nullable().optional(),
  performer_type: z.string().max(50).nullable().optional(),
  price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return 0;
      const num = Number(val);
      return isNaN(num) ? null : num;
    },
    z.number().min(0).max(99999.99).default(0).nullable()
  ),
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
  hero_image_url: z.string().nullable().optional().transform(val => {
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
  poster_image_url: z.string().nullable().optional().transform(val => {
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
  faqs: z.array(eventFaqSchema).default([])
})

export class EventService {
  static async createEvent(input: CreateEventInput) {
    const supabase = await createClient();

    // Determine slug: use provided or generate
    const rawSlug =
      input.slug && input.slug.trim() !== ''
        ? input.slug.trim()
        : generateSlug(input.name, input.date)
    const slug = normalizeSlugValue(rawSlug)

    const publishIssues = getPublishValidationIssues({
      status: input.event_status,
      name: input.name,
      date: input.date,
      time: input.time,
      slug,
      short_description: input.short_description,
      hero_image_url: input.hero_image_url,
      thumbnail_image_url: input.thumbnail_image_url,
      poster_image_url: input.poster_image_url,
      is_free: input.is_free,
      price: input.price
    })

    if (publishIssues.length > 0) {
      throw new Error(
        `Published events require: ${publishIssues.join(', ')}. Save as Draft until complete.`
      )
    }

    // Check for duplicate slug
    const { data: existingSlug } = await supabase
      .from('events')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existingSlug) {
      throw new Error('An event with this URL slug already exists');
    }

    // Prepare payload
    const eventData = {
      ...input,
      slug,
      // Ensure arrays are not undefined
      highlights: input.highlights || [],
      keywords: input.keywords || [],
      highlight_video_urls: input.highlight_video_urls || [],
      gallery_image_urls: input.gallery_image_urls || []
    };

    // Execute RPC
    const { data: event, error } = await supabase.rpc('create_event_transaction', {
      p_event_data: eventData,
      p_faqs: input.faqs || []
    });

    if (error) {
      console.error('Create event transaction error:', error);
      throw new Error('Failed to create event');
    }

    // Trigger side effect (marketing links) - fire and forget or await?
    // In service, we usually just return data. Side effects can be here or in action.
    // Let's do it here as it's closely tied to event creation success.
    void generateEventMarketingLinks(event.id).catch((e) => {
      console.error('Failed to generate marketing links:', e);
    });

    return event;
  }

  static async updateEvent(id: string, input: UpdateEventInput) {
    const supabase = await createClient();

    const { data: currentEvent, error: currentEventError } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        slug,
        event_status,
        short_description,
        hero_image_url,
        thumbnail_image_url,
        poster_image_url,
        is_free,
        price
      `)
      .eq('id', id)
      .maybeSingle()

    if (currentEventError || !currentEvent) {
      throw new Error('Event not found')
    }

    const nextStatus = input.event_status ?? currentEvent.event_status
    const nextName = input.name ?? currentEvent.name
    const nextDate = input.date ?? currentEvent.date
    const nextTime = input.time ?? currentEvent.time
    const nextShortDescription = input.short_description ?? currentEvent.short_description
    const nextHeroImage = input.hero_image_url ?? currentEvent.hero_image_url
    const nextThumbnailImage = input.thumbnail_image_url ?? currentEvent.thumbnail_image_url
    const nextPosterImage = input.poster_image_url ?? currentEvent.poster_image_url
    const nextIsFree = input.is_free ?? currentEvent.is_free
    const nextPrice = input.price ?? currentEvent.price

    let slug: string | undefined

    if (typeof input.slug === 'string') {
      const normalizedInputSlug = normalizeSlugValue(input.slug)
      slug = normalizedInputSlug.length > 0 ? normalizedInputSlug : undefined
    } else {
      const currentSlug = typeof currentEvent.slug === 'string' ? normalizeSlugValue(currentEvent.slug) : ''
      if (currentSlug.length > 0) {
        slug = currentSlug
      } else if (isPublishedStatus(nextStatus) && nextName && nextDate) {
        slug = generateSlug(nextName, nextDate)
      }
    }

    const publishIssues = getPublishValidationIssues({
      status: nextStatus,
      name: nextName,
      date: nextDate,
      time: nextTime,
      slug: slug || null,
      short_description: nextShortDescription,
      hero_image_url: nextHeroImage,
      thumbnail_image_url: nextThumbnailImage,
      poster_image_url: nextPosterImage,
      is_free: nextIsFree,
      price: typeof nextPrice === 'number' ? nextPrice : Number(nextPrice || 0)
    })

    if (publishIssues.length > 0) {
      throw new Error(
        `Published events require: ${publishIssues.join(', ')}. Save as Draft until complete.`
      )
    }

    if (slug) {
      // Check for duplicate slug (excluding current event)
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('slug', slug)
        .neq('id', id)
        .maybeSingle();

      if (existing) {
        throw new Error('An event with this URL slug already exists');
      }
    }

    // Prepare payload
    const eventData = {
      ...input,
      slug // might be undefined, handled by COALESCE in SQL
    };

    // Execute RPC
    const { data: event, error } = await supabase.rpc('update_event_transaction', {
      p_event_id: id,
      p_event_data: eventData,
      p_faqs: input.faqs // If undefined, SQL will ignore. If [], SQL will delete all.
    });

    if (error) {
      console.error('Update event transaction error:', error);
      throw new Error('Failed to update event');
    }

    void generateEventMarketingLinks(event.id).catch((e) => {
      console.error('Failed to refresh marketing links:', e);
    });

    return event;
  }

  static async deleteEvent(id: string) {
    const supabase = await createClient();

    // Get event details for return/audit
    const { data: event } = await supabase
      .from('events')
      .select('name, date')
      .eq('id', id)
      .single();

    if (!event) {
      throw new Error('Event not found');
    }

    const { data: deletedEvent, error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Event deletion error:', error);
      throw new Error('Failed to delete event');
    }

    if (!deletedEvent) {
      throw new Error('Event not found');
    }

    return event;
  }

  static async getEventFAQs(eventId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('event_faqs')
      .select('id, event_id, question, answer, sort_order, created_at, updated_at')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching event FAQs:', error);
      throw new Error('Failed to fetch FAQs');
    }
    return data;
  }

  static async getEventById(eventId: string) {
    const supabase = await createClient();
    const { data: event, error } = await supabase
      .from('events')
      .select('*, faqs:event_faqs(*), category:event_categories(*)')
      .eq('id', eventId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching event by ID:', error);
      throw new Error('Failed to fetch event');
    }
    return event;
  }

  static async getEventsByDate(date: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('events')
      .select('*, category:event_categories(*)')
      .eq('date', date)
      .neq('event_status', 'cancelled')
      .order('time', { ascending: true });

    if (error) {
      console.error('Error fetching events by date:', error);
      throw new Error('Failed to fetch events');
    }

    return data;
  }

  static async getEvents(options?: {
    status?: 'all' | 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'sold_out';
    searchTerm?: string;
    page?: number;
    pageSize?: number;
    orderBy?: string;
    orderAsc?: boolean;
  }) {
    const supabase = await createClient();
    const { status = 'scheduled', searchTerm, page = 1, pageSize = 10, orderBy = 'date', orderAsc = true } = options || {};

    let query = supabase
      .from('events')
      .select('*, category:event_categories(*)', { count: 'exact' });

    if (status !== 'all') {
      query = query.eq('event_status', status);
    }
    if (searchTerm) {
      const sanitizedSearch = sanitizeEventSearchTerm(searchTerm);
      if (sanitizedSearch.length > 0) {
        const searchPattern = `%${sanitizedSearch}%`;
        query = query.or(
          `name.ilike.${searchPattern},slug.ilike.${searchPattern},short_description.ilike.${searchPattern}`
        );
      }
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count, error } = await query
      .order(orderBy, { ascending: orderAsc })
      .range(from, to);

    if (error) {
      console.error('Error fetching events:', error);
      throw new Error('Failed to fetch events');
    }

    return {
      events: data || [],
      pagination: {
        totalCount: count || 0,
        currentPage: page,
        pageSize,
        totalPages: count ? Math.ceil(count / pageSize) : 0,
      }
    };
  }
}
