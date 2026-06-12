import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { generateEventMarketingLinks } from '@/app/actions/event-marketing-links';
import { z } from 'zod';
import { sendSMS } from '@/lib/twilio';
import { buildEventCancelledSms, buildRefundNote } from '@/lib/sms/templates';
import { processEventRefund } from '@/lib/events/manage-booking';
import { logger } from '@/lib/logger';
import { normalizeEventPricingFields } from '@/lib/events/pricing';
import { buildEventBookingStats } from '@/lib/events/stats';

function sanitizeEventSearchTerm(value: string): string {
  return value
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getSupabaseErrorMessage(error: unknown): string {
  if (!error) return 'Unknown database error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export type CreateEventInput = {
  name: string;
  date: string;
  time: string;
  capacity?: number | null;
  seated_capacity?: number | null;
  standing_capacity?: number | null;
  payment_mode?: 'free' | 'cash_only' | 'prepaid' | null;
  booking_mode?: 'table' | 'general' | 'mixed' | 'communal' | null;
  // Derived from event_categories.slug — not user-editable. Set by prepareEventDataFromFormData.
  event_type?: string | null;
  category_id?: string | null;
  short_description?: string | null;
  long_description?: string | null;
  brief?: string | null;
  highlights?: string[];
  keywords?: string[];
  primary_keywords?: string[];
  secondary_keywords?: string[];
  local_seo_keywords?: string[];
  image_alt_text?: string | null;
  social_copy_whatsapp?: string | null;
  previous_event_summary?: string | null;
  attendance_note?: string | null;
  cancellation_policy?: string | null;
  accessibility_notes?: string | null;
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
  promo_sms_enabled?: boolean;
  bookings_enabled?: boolean;
};

type EventBookingMode = NonNullable<CreateEventInput['booking_mode']>;

export function normalizeEventBookingMode(value: unknown): EventBookingMode {
  return value === 'general' || value === 'mixed' || value === 'communal' || value === 'table'
    ? value
    : 'table'
}

export function isCommunalBookingModeTransition(
  currentMode: unknown,
  nextMode: unknown
): boolean {
  const current = normalizeEventBookingMode(currentMode)
  const next = normalizeEventBookingMode(nextMode)
  return current !== next && (current === 'communal' || next === 'communal')
}

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

const nullableCapacitySchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
  },
  z.number().min(0, 'Capacity cannot be negative').max(10000, 'Capacity too large').nullable()
)

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
  payment_mode?: string | null
  booking_mode?: string | null
}

export type PublishValidationResult = {
  errors: string[]
  warnings: string[]
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

function isWorldCup2026EventName(value: string | null | undefined): boolean {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return normalized.startsWith('world cup 2026:') || normalized.includes('fifa world cup 2026')
}

async function updateEventSplitCapacities(
  eventId: string,
  input: Pick<UpdateEventInput, 'seated_capacity' | 'standing_capacity'>
) {
  const payload: { seated_capacity?: number | null; standing_capacity?: number | null } = {}
  if (input.seated_capacity !== undefined) payload.seated_capacity = input.seated_capacity
  if (input.standing_capacity !== undefined) payload.standing_capacity = input.standing_capacity

  if (Object.keys(payload).length === 0) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('events')
    .update(payload)
    .eq('id', eventId)
    .select('*')
    .maybeSingle()

  if (error) {
    logger.error('Failed to update event split capacities', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId }
    })
    throw new Error('Failed to update event capacity split')
  }

  return data
}

export function isWorldCup2026Event(input: { name?: string | null; slug?: string | null }): boolean {
  const normalizedSlug = typeof input.slug === 'string' ? normalizeSlugValue(input.slug) : ''
  return normalizedSlug.startsWith('world-cup-2026-') || isWorldCup2026EventName(input.name)
}

export function getPublishValidationIssues(input: PublishValidationInput): PublishValidationResult {
  if (!isPublishedStatus(input.status || null)) {
    return { errors: [], warnings: [] }
  }

  const errors: string[] = []
  const warnings: string[] = []

  if (!hasValue(input.name)) errors.push('event name')
  if (!hasValue(input.date)) errors.push('event date')
  if (!hasValue(input.time)) errors.push('event start time')
  if (!hasValue(input.slug)) errors.push('URL slug')
  if (!hasValue(input.short_description)) errors.push('short description')

  const hasImage =
    hasValue(input.hero_image_url) ||
    hasValue(input.thumbnail_image_url) ||
    hasValue(input.poster_image_url)

  if (!hasImage) {
    errors.push('event image')
  }

  const pricing = normalizeEventPricingFields({
    price: input.price,
    is_free: input.is_free,
    payment_mode: input.payment_mode,
  })
  const isFree = pricing.is_free
  const price = pricing.price

  if (!isFree && (price === null || price <= 0)) {
    errors.push('ticket price (or mark event as free)')
  }

  if (pricing.payment_mode === 'prepaid' && price <= 0) {
    errors.push('Prepaid events must have a price set')
  }

  if (!input.booking_mode) {
    warnings.push('No booking mode set — defaulting to table bookings')
  }

  return { errors, warnings }
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

const keywordArraySchema = z.array(
  z.string()
    .max(100, 'Keyword must be under 100 characters')
    .transform(s => s.trim().replace(/\s+/g, ' '))
    .refine(s => !/<[^>]+>/.test(s), 'Keywords must not contain HTML')
).max(10, 'Maximum 10 keywords per tier').default([])

// Event validation schema
export const eventSchema = z.object({
  name: z.string().min(1, 'Event name is required').max(200, 'Event name too long'),
  date: z.string()
    .min(1, 'Date is required')
    .refine((val) => {
      try {
        const eventDate = new Date(val + 'T00:00:00')
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return eventDate >= today
      } catch {
        return false
      }
    }, { message: 'Event date cannot be in the past' }),
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
  seated_capacity: nullableCapacitySchema.optional(),
  standing_capacity: nullableCapacitySchema.optional(),
  category_id: z.string().uuid().nullable().optional(),
  short_description: z.string().max(500).nullable().optional(),
  long_description: z.string().nullable().optional(),
  brief: z.string().max(50000).nullable().optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  primary_keywords: keywordArraySchema,
  secondary_keywords: keywordArraySchema,
  local_seo_keywords: keywordArraySchema,
  image_alt_text: z.string().max(200).nullable().optional(),
  social_copy_whatsapp: z.string().max(300).nullable().optional(),
  previous_event_summary: z.string().max(300).nullable().optional(),
  attendance_note: z.string().max(200).nullable().optional(),
  cancellation_policy: z.string().max(300).nullable().optional(),
  accessibility_notes: z.string().max(300).nullable().optional(),
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
  booking_mode: z.enum(['table', 'general', 'mixed', 'communal']).default('table'),
  payment_mode: z.enum(['free', 'cash_only', 'prepaid']).nullable().optional(),
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
  faqs: z.array(eventFaqSchema).default([]),
  promo_sms_enabled: z.boolean().optional(),
  bookings_enabled: z.boolean().optional()
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

    const publishValidation = getPublishValidationIssues({
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
      price: input.price,
      payment_mode: input.payment_mode,
      booking_mode: input.booking_mode
    })

    if (publishValidation.errors.length > 0) {
      throw new Error(
        `Published events require: ${publishValidation.errors.join(', ')}. Save as Draft until complete.`
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
    const forcePromoSmsDisabled = isWorldCup2026Event({ name: input.name, slug })
    const pricing = normalizeEventPricingFields({
      price: input.price,
      is_free: input.is_free,
      payment_mode: input.payment_mode,
    })

    const eventData = {
      ...input,
      slug,
      price: pricing.price,
      is_free: pricing.is_free,
      payment_mode: pricing.payment_mode,
      ...(forcePromoSmsDisabled ? { promo_sms_enabled: false } : {}),
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
      logger.error('Create event transaction error', { error: error instanceof Error ? error : new Error(String(error)) });
      throw new Error('Failed to create event');
    }

    const capacityEvent = await updateEventSplitCapacities(event.id, {
      seated_capacity: input.seated_capacity,
      standing_capacity: input.standing_capacity,
    })
    const savedEvent = capacityEvent || event

    // Attempt marketing link generation — non-blocking for save, but capture failures
    let marketingLinksWarning: string | null = null
    try {
      await generateEventMarketingLinks(savedEvent.id)
    } catch (e) {
      logger.warn('Failed to generate marketing links', {
        error: e instanceof Error ? e : new Error(String(e)),
        metadata: { eventId: savedEvent.id }
      })
      marketingLinksWarning = 'Event saved but marketing links failed to generate. You can retry from the event detail page.'
    }

    return { ...savedEvent, marketingLinksWarning };
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
        price,
        payment_mode,
        booking_mode,
        seated_capacity,
        standing_capacity
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
    const nextPaymentMode = input.payment_mode ?? currentEvent.payment_mode

    let slug: string | undefined

    const dateChanged = input.date && input.date !== currentEvent.date

    if (typeof input.slug === 'string') {
      const normalizedInputSlug = normalizeSlugValue(input.slug)
      // If the user sent the existing slug unchanged but the date moved,
      // regenerate so the embedded date stays in sync.
      if (dateChanged && normalizedInputSlug === normalizeSlugValue(currentEvent.slug ?? '')) {
        slug = generateSlug(nextName, nextDate)
      } else {
        slug = normalizedInputSlug.length > 0 ? normalizedInputSlug : undefined
      }
    } else {
      const currentSlug = typeof currentEvent.slug === 'string' ? normalizeSlugValue(currentEvent.slug) : ''
      if (dateChanged && currentSlug.length > 0) {
        // Date moved but no explicit slug change — regenerate
        slug = generateSlug(nextName, nextDate)
      } else if (currentSlug.length > 0) {
        slug = currentSlug
      } else if (isPublishedStatus(nextStatus) && nextName && nextDate) {
        slug = generateSlug(nextName, nextDate)
      }
    }

    const currentBookingMode = normalizeEventBookingMode(currentEvent.booking_mode)
    const requestedBookingMode = input.booking_mode === undefined
      ? undefined
      : normalizeEventBookingMode(input.booking_mode)
    const nextBookingMode = requestedBookingMode ?? currentBookingMode

    if (
      requestedBookingMode !== undefined &&
      isCommunalBookingModeTransition(currentBookingMode, requestedBookingMode)
    ) {
      const { count: activeBookings, error: activeBookingsError } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', id)
        .in('status', ['confirmed', 'pending_payment'])

      if (activeBookingsError) {
        throw new Error('Failed to check active event bookings')
      }

      if ((activeBookings ?? 0) > 0) {
        throw new Error('Cannot change communal seating mode while this event has active bookings.')
      }
    }

    const publishValidation = getPublishValidationIssues({
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
      price: typeof nextPrice === 'number' ? nextPrice : Number(nextPrice || 0),
      payment_mode: nextPaymentMode,
      booking_mode: nextBookingMode
    })

    if (publishValidation.errors.length > 0) {
      throw new Error(
        `Published events require: ${publishValidation.errors.join(', ')}. Save as Draft until complete.`
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
    const forcePromoSmsDisabled = isWorldCup2026Event({
      name: nextName,
      slug: slug ?? currentEvent.slug,
    })
    const pricing = normalizeEventPricingFields({
      price: nextPrice,
      is_free: nextIsFree,
      payment_mode: nextPaymentMode,
    })

    const eventData = {
      ...input,
      ...(requestedBookingMode !== undefined ? { booking_mode: requestedBookingMode } : {}),
      price: pricing.price,
      is_free: pricing.is_free,
      payment_mode: pricing.payment_mode,
      slug, // might be undefined, handled by COALESCE in SQL
      ...(forcePromoSmsDisabled ? { promo_sms_enabled: false } : {})
    };

    // Execute RPC
    const { data: event, error } = await supabase.rpc('update_event_transaction', {
      p_event_id: id,
      p_event_data: eventData,
      p_faqs: input.faqs !== undefined ? input.faqs : null // null = preserve existing; array = replace
    });

    if (error) {
      logger.error('Update event transaction error', { error: error instanceof Error ? error : new Error(String(error)) });
      throw new Error('Failed to update event');
    }

    const capacityEvent = await updateEventSplitCapacities(id, {
      seated_capacity: input.seated_capacity,
      standing_capacity: input.standing_capacity,
    })
    const savedEvent = capacityEvent || event

    // Attempt marketing link refresh — non-blocking for save, but capture failures
    let marketingLinksWarning: string | null = null
    try {
      await generateEventMarketingLinks(savedEvent.id)
    } catch (e) {
      logger.warn('Failed to refresh marketing links', {
        error: e instanceof Error ? e : new Error(String(e)),
        metadata: { eventId: event.id }
      })
      marketingLinksWarning = 'Event saved but marketing links failed to generate. You can retry from the event detail page.'
    }

    return {
      ...savedEvent,
      _oldDate: currentEvent.date as string | null,
      _oldTime: currentEvent.time as string | null,
      _oldName: currentEvent.name as string | null,
      _oldStatus: currentEvent.event_status as string | null,
      marketingLinksWarning,
    };
  }

  static async deleteEvent(id: string): Promise<{ name: string; date: string } | { error: string }> {
    const supabase = createAdminClient();

    // Get event details for return/audit
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('name, date')
      .eq('id', id)
      .maybeSingle();

    if (eventError) {
      logger.error('Event deletion prefetch error', {
        error: new Error(getSupabaseErrorMessage(eventError)),
        metadata: { eventId: id },
      });
      throw new Error('Failed to load event');
    }

    if (!event) {
      throw new Error('Event not found');
    }

    // Check for active bookings before deletion
    const { count: activeBookings, error: activeBookingsError } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', id)
      .in('status', ['confirmed', 'pending_payment'])

    if (activeBookingsError) {
      logger.error('Event active-booking deletion check error', {
        error: new Error(getSupabaseErrorMessage(activeBookingsError)),
        metadata: { eventId: id },
      });
      throw new Error('Failed to check event bookings');
    }

    if (activeBookings && activeBookings > 0) {
      return {
        error: `Cannot delete this event — it has ${activeBookings} active booking${activeBookings !== 1 ? 's' : ''}. Cancel the event first to notify customers and process refunds, then delete.`
      }
    }

    const { count: checkIns, error: checkInsError } = await supabase
      .from('event_check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', id)

    if (checkInsError) {
      logger.error('Event check-in deletion check error', {
        error: new Error(getSupabaseErrorMessage(checkInsError)),
        metadata: { eventId: id },
      });
      throw new Error('Failed to check event history');
    }

    if (checkIns && checkIns > 0) {
      return {
        error: `Cannot delete this event — it has ${checkIns} check-in record${checkIns !== 1 ? 's' : ''}.`
      }
    }

    const cleanupTables = ['sms_promo_context', 'promo_sequence'] as const;
    for (const table of cleanupTables) {
      const { error: cleanupError } = await supabase
        .from(table)
        .delete()
        .eq('event_id', id);

      if (cleanupError) {
        logger.error('Event deletion cleanup error', {
          error: new Error(getSupabaseErrorMessage(cleanupError)),
          metadata: { eventId: id, table },
        });
        throw new Error('Failed to clean up event references');
      }
    }

    const { data: deletedEvent, error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      const message = getSupabaseErrorMessage(error);
      logger.error('Event deletion error', {
        error: new Error(message),
        metadata: { eventId: id },
      });

      if (message.toLowerCase().includes('active booking')) {
        return { error: 'Cannot delete this event — it has active bookings. Cancel the event first, then delete.' };
      }

      throw new Error(message || 'Failed to delete event');
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
      logger.error('Error fetching event FAQs', { error: error instanceof Error ? error : new Error(String(error)) });
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
      logger.error('Error fetching event by ID', { error: error instanceof Error ? error : new Error(String(error)) });
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
      logger.error('Error fetching events by date', { error: error instanceof Error ? error : new Error(String(error)) });
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
    dateFrom?: string;
    dateTo?: string;
  }) {
    const supabase = await createClient();
    const { status = 'scheduled', searchTerm, page = 1, pageSize = 10, orderBy = 'date', orderAsc = true, dateFrom, dateTo } = options || {};

    let query = supabase
      .from('events')
      .select('*, category:event_categories(*), bookings:bookings(seats, status, is_reminder_only)', { count: 'exact' });

    if (status !== 'all') {
      query = query.eq('event_status', status);
    }
    if (dateFrom) {
      query = query.gte('date', dateFrom);
    }
    if (dateTo) {
      query = query.lte('date', dateTo);
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
      logger.error('Error fetching events', { error: error instanceof Error ? error : new Error(String(error)) });
      throw new Error('Failed to fetch events');
    }

    const eventIds = (data || []).map((row: Record<string, unknown>) => row.id as string)

    const clickCountMap: Record<string, number> = {}
    if (eventIds.length > 0) {
      const adminDb = createAdminClient()
      const orFilter = eventIds.map(id => `metadata.cs.{"event_id":"${id}"}`).join(',')
      const { data: linkRows } = await adminDb
        .from('short_links')
        .select('metadata, click_count')
        .or(orFilter)

      if (linkRows) {
        for (const row of linkRows) {
          const eid = (row.metadata as Record<string, unknown>)?.event_id as string
          if (eid) {
            clickCountMap[eid] = (clickCountMap[eid] || 0) + ((row.click_count as number) || 0)
          }
        }
      }
    }

    const events = (data || []).map((row: Record<string, unknown>) => {
      const bookings = Array.isArray(row.bookings)
        ? row.bookings as { seats: number | null; status: string | null; is_reminder_only?: boolean | null }[]
        : []
      const stats = buildEventBookingStats(
        row as Record<string, unknown>,
        bookings,
        [{ clickCount: clickCountMap[row.id as string] || 0 }],
      )
      const booked_count = stats.totalSeats
      const link_clicks = stats.totalLinkClicks
      const { bookings: _bookings, ...event } = row
      return { ...event, booked_count, link_clicks }
    })

    return {
      events,
      pagination: {
        totalCount: count || 0,
        currentPage: page,
        pageSize,
        totalPages: count ? Math.ceil(count / pageSize) : 0,
      }
    };
  }

  /**
   * Cancellation cascade: cancel all active bookings for an event,
   * process refunds, send SMS notifications, and clean up waitlist.
   * Runs synchronously so the admin sees the result.
   */
  static async cancelEventBookings(params: {
    eventId: string
    eventName: string
    eventDate: string
    eventTime: string
    cancelledBy: string
    supabase: ReturnType<typeof createAdminClient>
  }): Promise<{
    bookingsCancelled: number
    refundsProcessed: number
    refundsFailed: number
    customersNotified: number
  }> {
    const { eventId, eventName, eventDate, eventTime, cancelledBy, supabase: db } = params
    let bookingsCancelled = 0
    let refundsProcessed = 0
    let refundsFailed = 0
    let customersNotified = 0

    // 1. Fetch all active bookings with customer data
    const { data: bookings } = await db
      .from('bookings')
      .select('id, customer_id, seats, status, customers!inner(id, first_name, mobile_number, sms_status)')
      .eq('event_id', eventId)
      .in('status', ['confirmed', 'pending_payment'])

    if (!bookings || bookings.length === 0) {
      // Still close booking_open and clean waitlist even if no active bookings
      await db.from('events').update({ booking_open: false }).eq('id', eventId)
      await db.from('waitlist_entries')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('event_id', eventId)
        .in('status', ['pending', 'offered'])
      await db.from('waitlist_offers')
        .update({ status: 'cancelled', expired_at: new Date().toISOString() })
        .eq('event_id', eventId)
        .in('status', ['pending', 'active'])
      return { bookingsCancelled, refundsProcessed, refundsFailed, customersNotified }
    }

    // 2. Cancel each booking, release holds, cancel table bookings
    for (const booking of bookings) {
      try {
        await db
          .from('bookings')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancelled_by: cancelledBy
          })
          .eq('id', booking.id)

        // Release active holds
        await db
          .from('booking_holds')
          .update({ status: 'released', released_at: new Date().toISOString() })
          .eq('event_booking_id', booking.id)
          .eq('status', 'active')

        // Cancel associated table bookings
        await db
          .from('table_bookings')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('event_booking_id', booking.id)
          .in('status', ['confirmed', 'pending_payment'])

        bookingsCancelled++
      } catch (err) {
        logger.error('Failed to cancel booking during event cancellation', {
          error: err instanceof Error ? err : new Error(String(err)),
          metadata: { bookingId: booking.id, eventId }
        })
      }
    }

    // 3. Process refunds for prepaid bookings
    const bookingIds = bookings.map(b => b.id)
    const { data: payments } = await db
      .from('payments')
      .select('id, event_booking_id, amount, status, stripe_payment_intent_id')
      .in('event_booking_id', bookingIds)
      .eq('status', 'succeeded')

    // Track refund results per booking for SMS
    const refundResults = new Map<string, { succeeded: boolean; amount: number }>()

    if (payments && payments.length > 0) {
      for (const payment of payments) {
        if (!payment.event_booking_id) continue
        // Find the customer_id for this booking
        const booking = bookings.find(b => b.id === payment.event_booking_id)
        const customer = booking?.customers as unknown as { id: string } | undefined

        try {
          await processEventRefund(db, {
            bookingId: payment.event_booking_id,
            customerId: customer?.id || '',
            eventId,
            amount: payment.amount,
            reason: 'event_cancelled',
            metadata: { cancelled_by: cancelledBy }
          })
          refundsProcessed++
          const existing = refundResults.get(payment.event_booking_id) || { succeeded: true, amount: 0 }
          existing.amount += payment.amount
          refundResults.set(payment.event_booking_id, existing)
        } catch (err) {
          refundsFailed++
          refundResults.set(payment.event_booking_id, { succeeded: false, amount: 0 })
          logger.error('Failed to process refund during event cancellation', {
            error: err instanceof Error ? err : new Error(String(err)),
            metadata: { paymentId: payment.id, bookingId: payment.event_booking_id, eventId }
          })
        }
      }
    }

    // 4. Send cancellation SMS
    const formattedDate = formatEventDateForSms(eventDate, eventTime)

    for (const booking of bookings) {
      const customer = booking.customers as unknown as {
        id: string
        first_name: string | null
        mobile_number: string | null
        sms_status: string | null
      }
      if (!customer?.sms_status || customer.sms_status !== 'active' || !customer.mobile_number) continue

      try {
        const refundResult = refundResults.get(booking.id)
        const isPrepaid = !!refundResult
        const refundNote = buildRefundNote({
          isPrepaid,
          refundSucceeded: refundResult?.succeeded ?? false,
          refundAmount: refundResult?.amount ?? null
        })

        const smsBody = buildEventCancelledSms({
          firstName: customer.first_name,
          eventName,
          eventDate: formattedDate,
          refundNote
        })

        await sendSMS(customer.mobile_number, smsBody, {
          customerId: customer.id,
          metadata: {
            template_key: 'event_cancelled',
            event_id: eventId,
            event_booking_id: booking.id
          }
        })
        customersNotified++
      } catch (err) {
        logger.error('Failed to send cancellation SMS', {
          error: err instanceof Error ? err : new Error(String(err)),
          metadata: { bookingId: booking.id, eventId }
        })
      }
    }

    // 5. Release waitlist entries and offers
    await db
      .from('waitlist_entries')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .in('status', ['pending', 'offered'])

    await db
      .from('waitlist_offers')
      .update({ status: 'cancelled', expired_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .in('status', ['pending', 'active'])

    // 6. Set booking_open = false
    await db
      .from('events')
      .update({ booking_open: false })
      .eq('id', eventId)

    return { bookingsCancelled, refundsProcessed, refundsFailed, customersNotified }
  }
}

/** Format event date/time for SMS display in London timezone. */
function formatEventDateForSms(date: string, time: string): string {
  try {
    const iso = `${date}T${time || '00:00'}:00`
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(iso))
  } catch {
    return 'the scheduled date'
  }
}
