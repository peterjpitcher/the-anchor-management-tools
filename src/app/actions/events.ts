'use server'

import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { logAuditEvent } from './audit'
import type { Event, EventFAQ } from '@/types/database'
import { checkUserPermission } from '@/app/actions/rbac'
import { EventService, eventSchema, CreateEventInput, UpdateEventInput } from '@/services/events'
import { EventBookingService } from '@/services/event-bookings'
import { createClient } from '@/lib/supabase/server' // Required for getting user in action
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import {
  createEventManageToken,
  getEventRefundPolicy,
  processEventRefund,
  updateEventBookingSeatsById,
  type EventRefundResult
} from '@/lib/events/manage-booking'
import { canIssueEventRefund } from '@/lib/events/refund-permissions'
import {
  sendEventBookingSeatUpdateSms,
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms
} from '@/lib/events/event-payments'
import {
  sendEventBookingCancelledEmail,
  sendEventPaymentConfirmationEmail,
  sendEventPaymentManualReviewEmail,
  sendEventTicketTransferredEmail,
} from '@/lib/email/event-ticket-emails'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  deletePubOpsEventCalendarEntryByEventId,
  syncPubOpsEventCalendarByEventId,
} from '@/lib/google-calendar-events'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { logger } from '@/lib/logger'
import { buildKeywordsUnion } from '@/lib/keywords'
import { normalizeEventPricingFields, resolveEventPriceAmount, resolveEventTicketPriceAmount } from '@/lib/events/pricing'
import {
  eventTicketTypesEnabled,
  buildTicketBreakdownLines,
  formatTicketBreakdownCompact,
  resolveBookingChargeAmount,
  resolveDoorChargeAmount,
  type BookingItemWithBasePrice,
  type BookingItemWithTypeRow,
  type TicketSelectionInput,
} from '@/lib/events/ticket-types'
import {
  loadBookingItems,
  loadBookingItemsWithTypes,
  loadBookingItemsWithBasePrices,
  getDefaultTicketTypeId,
  bookingItemsAreMultiType,
  decideTicketSelectionHandling,
} from '@/lib/events/ticket-type-queries'
import { normalizeAttendeeNames, MAX_ATTENDEE_NAME_LENGTH } from '@/lib/events/attendee-names'
import { jobQueue } from '@/lib/unified-job-queue'

export type EventBookingRow = {
  id: string
  customer_id: string
  event_id: string
  seats: number | null
  is_reminder_only: boolean
  notes: string | null
  created_at: string
  status?: string | null
  source?: string | null
  hold_expires_at?: string | null
  event_seating_type?: 'seated' | 'standing' | null
  attendee_names?: string[] | null
  paid_amount?: number | null
  payment_status_summary?: string | null
  payment_method_summary?: string | null
  /** Compact per-type summary (e.g. "1× Regular, 1× Non-Alcohol"); null for single-type bookings. */
  ticket_breakdown?: string | null
  /** Sum of the booking's line items (post-discount snapshots); null when it has none. */
  charge_total?: number | null
  customer?: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    email: string | null
  } | null
}

type CreateEventResult = { error: string } | { success: true; data: Event; warning?: string }
type EventFaqInput = NonNullable<CreateEventInput['faqs']>[number]
type PreparedEventData = Partial<CreateEventInput> & { faqs?: EventFaqInput[] }

type SmsSafetyMeta =
  | {
      success: boolean
      code: string | null
      logFailure: boolean
  }
  | null

type RequiredSmsSafetyMeta = NonNullable<SmsSafetyMeta>

type EventManualPaymentMethod = 'cash' | 'card_terminal' | 'comp'

function toMoney(value: number): number {
  return Number(value.toFixed(2))
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

const stringArrayFormFieldSchema = z.array(z.string().trim().min(1).max(300)).max(50)
const eventFaqFormFieldSchema = z.array(z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(2000),
  sort_order: z.number().int().min(0).max(1000).optional(),
})).max(25)

function parseJsonFormField<T>(
  rawValue: FormDataEntryValue | undefined,
  schema: z.ZodType<T>,
  fallback: T,
  fieldName: string
): T {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return fallback
  }

  try {
    const parsed = JSON.parse(rawValue)
    const result = schema.safeParse(parsed)
    if (result.success) {
      return result.data
    }
    logger.warn('Invalid JSON form field in event payload', {
      metadata: {
        fieldName,
        issue: result.error.issues[0]?.message,
      },
    })
    return fallback
  } catch (error) {
    logger.warn('Failed to parse JSON form field in event payload', {
      metadata: {
        fieldName,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return fallback
  }
}

async function recordEventAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
): Promise<void> {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record event analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

// Helper to extract event data from FormData and apply category defaults
async function prepareEventDataFromFormData(formData: FormData, _existingEventId?: string | null): Promise<PreparedEventData> {
  const supabase = await createClient(); // For fetching category defaults

  const categoryId = formData.get('category_id') as string || null;
  let categoryDefaults: Partial<CreateEventInput> = {};
  let categorySlug: string | null = null;

  if (categoryId) {
    const { data: category } = await supabase
      .from('event_categories')
      .select(`
        slug,
        default_start_time,
        default_end_time,
        default_duration_minutes,
        default_doors_time,
        default_last_entry_time,
        default_price,
        default_is_free,
        short_description,
        long_description,
        highlights,
        primary_keywords,
        secondary_keywords,
        local_seo_keywords,
        image_alt_text,
        cancellation_policy,
        accessibility_notes,
        meta_title,
        meta_description,
        default_image_url,
        promo_video_url,
        highlight_video_urls,
        gallery_image_urls,
        default_performer_type,
        default_event_status,
        default_booking_url,
        default_promo_sms_enabled,
        default_bookings_enabled
      `)
      .eq('id', categoryId)
      .single();

    if (category) {
      categorySlug = category.slug || null;
      categoryDefaults = {
        time: category.default_start_time,
        end_time: category.default_end_time,
        duration_minutes: category.default_duration_minutes,
        doors_time: category.default_doors_time,
        last_entry_time: category.default_last_entry_time,
        price: category.default_price,
        is_free: category.default_is_free,
        short_description: category.short_description,
        long_description: category.long_description,
        highlights: category.highlights,
        primary_keywords: category.primary_keywords,
        secondary_keywords: category.secondary_keywords,
        local_seo_keywords: category.local_seo_keywords,
        image_alt_text: category.image_alt_text,
        cancellation_policy: category.cancellation_policy,
        accessibility_notes: category.accessibility_notes,
        meta_title: category.meta_title,
        meta_description: category.meta_description,
        hero_image_url: category.default_image_url,
        promo_video_url: category.promo_video_url,
        highlight_video_urls: category.highlight_video_urls,
        gallery_image_urls: category.gallery_image_urls,
        performer_type: category.default_performer_type,
        event_status: category.default_event_status || 'scheduled',
        booking_url: category.default_booking_url,
        promo_sms_enabled: category.default_promo_sms_enabled,
        bookings_enabled: category.default_bookings_enabled
      };
    }
  }

  const rawData = Object.fromEntries(formData.entries());
  const rawIsFree = rawData.is_free
  const isFree =
    rawIsFree === undefined
      ? categoryDefaults.is_free ?? false
      : rawIsFree === 'true'

  const bookingModeInput = rawData.booking_mode
  const bookingMode: CreateEventInput['booking_mode'] =
    bookingModeInput === 'table' ||
    bookingModeInput === 'general' ||
    bookingModeInput === 'mixed' ||
    bookingModeInput === 'communal'
      ? bookingModeInput
      : 'table'

  // Handle specific fields from form data
  const data: Partial<CreateEventInput> = {
    name: rawData.name as string,
    date: rawData.date as string,
    time: rawData.time as string || categoryDefaults.time,
    ...(rawData.capacity !== undefined && rawData.capacity !== null && rawData.capacity !== ''
      ? { capacity: Number(rawData.capacity) || null }
      : {}),
    ...(rawData.seated_capacity !== undefined && rawData.seated_capacity !== null
      ? { seated_capacity: rawData.seated_capacity === '' ? null : Number(rawData.seated_capacity) || null }
      : {}),
    ...(rawData.standing_capacity !== undefined && rawData.standing_capacity !== null
      ? { standing_capacity: rawData.standing_capacity === '' ? null : Number(rawData.standing_capacity) || null }
      : {}),
    ...(rawData.payment_mode && ['free', 'cash_only', 'prepaid'].includes(rawData.payment_mode as string)
      ? { payment_mode: rawData.payment_mode as 'free' | 'cash_only' | 'prepaid' }
      : {}),
    booking_mode: bookingMode,
    event_type: categorySlug,
    category_id: categoryId,
    short_description: rawData.short_description as string || categoryDefaults.short_description || null,
    long_description: rawData.long_description as string || categoryDefaults.long_description || null,
    brief: (rawData.brief as string)?.trim() || null,
    highlights: parseJsonFormField(rawData.highlights, stringArrayFormFieldSchema, categoryDefaults.highlights || [], 'highlights'),
    keywords: parseJsonFormField(rawData.keywords, stringArrayFormFieldSchema, [], 'keywords'),
    primary_keywords: parseJsonFormField(rawData.primary_keywords, stringArrayFormFieldSchema, categoryDefaults.primary_keywords || [], 'primary_keywords'),
    secondary_keywords: parseJsonFormField(rawData.secondary_keywords, stringArrayFormFieldSchema, categoryDefaults.secondary_keywords || [], 'secondary_keywords'),
    local_seo_keywords: parseJsonFormField(rawData.local_seo_keywords, stringArrayFormFieldSchema, categoryDefaults.local_seo_keywords || [], 'local_seo_keywords'),
    image_alt_text: rawData.image_alt_text as string || null,
    social_copy_whatsapp: rawData.social_copy_whatsapp as string || null,
    previous_event_summary: rawData.previous_event_summary as string || null,
    attendance_note: rawData.attendance_note as string || null,
    cancellation_policy: rawData.cancellation_policy as string || categoryDefaults.cancellation_policy || null,
    accessibility_notes: rawData.accessibility_notes as string || categoryDefaults.accessibility_notes || null,
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
    ...(rawData.online_discount_type === 'fixed' || rawData.online_discount_type === 'percent'
      ? { online_discount_type: rawData.online_discount_type as 'fixed' | 'percent' }
      : { online_discount_type: null }),
    ...(rawData.online_discount_value !== undefined
      ? { online_discount_value: rawData.online_discount_value === '' ? null : Number(rawData.online_discount_value) }
      : {}),
    is_free: isFree,
    booking_url: rawData.booking_url as string || categoryDefaults.booking_url || null,
    hero_image_url: rawData.hero_image_url as string || categoryDefaults.hero_image_url || null,
    thumbnail_image_url: rawData.thumbnail_image_url as string || null,
    poster_image_url: rawData.poster_image_url as string || null,
    promo_video_url: rawData.promo_video_url as string || categoryDefaults.promo_video_url || null,
    highlight_video_urls: parseJsonFormField(rawData.highlight_video_urls, stringArrayFormFieldSchema, categoryDefaults.highlight_video_urls || [], 'highlight_video_urls'),
    gallery_image_urls: parseJsonFormField(rawData.gallery_image_urls, stringArrayFormFieldSchema, categoryDefaults.gallery_image_urls || [], 'gallery_image_urls'),
    promo_sms_enabled: rawData.promo_sms_enabled === 'true' ? true : rawData.promo_sms_enabled === 'false' ? false : categoryDefaults.promo_sms_enabled ?? true,
    bookings_enabled: rawData.bookings_enabled === 'true' ? true : rawData.bookings_enabled === 'false' ? false : categoryDefaults.bookings_enabled ?? true
  };

  const pricing = normalizeEventPricingFields({
    price: data.price,
    online_discount_type: data.online_discount_type,
    online_discount_value: data.online_discount_value,
    is_free: data.is_free,
    payment_mode: data.payment_mode,
  })
  data.price = pricing.price
  data.online_discount_type = pricing.online_discount_type
  data.online_discount_value = pricing.online_discount_value
  data.is_free = pricing.is_free
  data.payment_mode = pricing.payment_mode

  // Derive flat keywords as union of three tiers (primary > secondary > local)
  const primaryKw = (data.primary_keywords as string[]) || [];
  const secondaryKw = (data.secondary_keywords as string[]) || [];
  const localKw = (data.local_seo_keywords as string[]) || [];
  if (primaryKw.length > 0 || secondaryKw.length > 0 || localKw.length > 0) {
    data.keywords = buildKeywordsUnion(primaryKw, secondaryKw, localKw);
  }

  // Handle FAQs — undefined means "not provided, preserve existing"; array means "replace with these"
  const faqsJson = formData.get('faqs') as string | null;
  if (faqsJson !== null) {
    data.faqs = parseJsonFormField(faqsJson, eventFaqFormFieldSchema, [], 'faqs')
  }
  // If faqsJson was null (not in FormData), data.faqs remains undefined — service layer will skip FAQ replacement

  return data as PreparedEventData;
}

export async function createEvent(formData: FormData): Promise<CreateEventResult> {
  try {
    const supabase = await createClient();
    const [canManageEvents, { data: { user }, error: authError }] = await Promise.all([
      checkUserPermission('events', 'manage'),
      supabase.auth.getUser(),
    ]);

    if (!canManageEvents) {
      return { error: 'Insufficient permissions to create events' };
    }
    if (authError || !user) {
      return { error: 'Unauthorized' };
    }

    const rawData = await prepareEventDataFromFormData(formData);
    const validationResult = eventSchema.safeParse(rawData);

    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message };
    }

    const { marketingLinksWarning, ...event } = await EventService.createEvent(validationResult.data as CreateEventInput);

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
    revalidateTag('dashboard')
    return { success: true, data: event as Event, warning: marketingLinksWarning || undefined };
  } catch (error: unknown) {
    logger.error('Unexpected error creating event', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'An unexpected error occurred') };
  }
}

// ─── Update Event ───────────────────────────────────────────────────────────

export async function updateEvent(id: string, formData: FormData) {
  try {
    const supabase = await createClient();
    const [canManageEvents, { data: { user }, error: authError }] = await Promise.all([
      checkUserPermission('events', 'manage'),
      supabase.auth.getUser(),
    ]);

    if (!canManageEvents) {
      return { error: 'Insufficient permissions to update events' };
    }
    if (authError || !user) {
      return { error: 'Unauthorized' };
    }

    const rawData = await prepareEventDataFromFormData(formData, id); // Pass existingEventId if needed

    // For updates, we allow partial data, but still validate if fields are present
    const validationResult = eventSchema.partial().safeParse(rawData);
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message };
    }

    const eventResult = await EventService.updateEvent(id, validationResult.data as UpdateEventInput);

    // Extract old values and marketing warning returned by the service
    const { _oldDate, _oldTime, _oldName, _oldStatus, marketingLinksWarning, ...event } = eventResult
    const warnings = marketingLinksWarning ? [marketingLinksWarning] : []

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

    // Detect date/time change and queue reschedule notifications.
    const newDate = validationResult.data.date
    const newTime = validationResult.data.time
    const dateChanged =
      (newDate && newDate !== _oldDate) || (newTime && newTime !== _oldTime)

    if (dateChanged) {
      const enqueueResult = await jobQueue.enqueue(
        'send_event_reschedule_notifications',
        {
          eventId: id,
          eventName: event.name || _oldName || 'your event',
          oldDate: _oldDate,
          oldTime: _oldTime,
          newDate: newDate || _oldDate || '',
          newTime: newTime || _oldTime || '',
          userId: user.id,
        },
        {
          priority: 20,
          maxAttempts: 3,
          unique: `event_reschedule:${id}:${_oldDate ?? ''}:${_oldTime ?? ''}:${newDate ?? ''}:${newTime ?? ''}`,
        },
      )

      if (!enqueueResult.success) {
        logger.error('Failed to queue event reschedule notifications', {
          metadata: { eventId: id, error: enqueueResult.error },
        })
        warnings.push('Event saved, but reschedule notifications could not be queued.')
      }
    }

    // Detect cancellation and queue the cascade.
    const statusChangedToCancelled =
      validationResult.data.event_status === 'cancelled' && _oldStatus !== 'cancelled'

    if (statusChangedToCancelled) {
      const enqueueResult = await jobQueue.enqueue(
        'cancel_event_bookings',
        {
          eventId: id,
          eventName: validationResult.data.name || _oldName || 'Event',
          eventDate: _oldDate || validationResult.data.date || '',
          eventTime: _oldTime || validationResult.data.time || '',
          cancelledBy: user.id,
        },
        {
          priority: 30,
          maxAttempts: 3,
          unique: `cancel_event_bookings:${id}`,
        },
      )

      if (enqueueResult.success) {
        await logAuditEvent({
          user_id: user.id,
          operation_type: 'cancel_event_queued',
          resource_type: 'event',
          resource_id: id,
          operation_status: 'success',
          additional_info: { job_id: enqueueResult.jobId ?? null },
        })
      } else {
        logger.error('Failed to queue event cancellation cascade', {
          metadata: { eventId: id, error: enqueueResult.error },
        })
        warnings.push('Event saved as cancelled, but booking cancellation could not be queued.')
      }
    }

    const statusChangedToPostponed =
      validationResult.data.event_status === 'postponed' && _oldStatus !== 'postponed'

    if (statusChangedToPostponed && !dateChanged) {
      const enqueueResult = await jobQueue.enqueue(
        'send_event_postponed_notifications',
        {
          eventId: id,
          eventName: validationResult.data.name || _oldName || 'your event',
          userId: user.id,
        },
        {
          priority: 25,
          maxAttempts: 3,
          unique: `event_postponed:${id}:${_oldStatus ?? ''}:postponed`,
        },
      )

      if (!enqueueResult.success) {
        logger.error('Failed to queue event postponed notifications', {
          metadata: { eventId: id, error: enqueueResult.error },
        })
        warnings.push('Event saved as postponed, but postponed notifications could not be queued.')
      }
    }

    await syncPubOpsEventCalendarByEventId(createAdminClient(), id, {
      context: statusChangedToCancelled ? 'event_cancelled' : 'event_updated',
    })

    revalidatePath('/events');
    revalidatePath(`/events/${id}`);
    revalidatePath(`/events/${id}/edit`);
    revalidateTag('dashboard')
    return { success: true, data: event as Event, warning: warnings.length > 0 ? warnings.join(' ') : undefined };
  } catch (error: unknown) {
    logger.error('Unexpected error updating event', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId: id },
    })
    return { error: getErrorMessage(error, 'An unexpected error occurred') };
  }
}

export async function deleteEvent(id: string) {
  try {
    const supabase = await createClient();
    const [canDeleteEvents, canManageEvents, { data: { user }, error: authError }] = await Promise.all([
      checkUserPermission('events', 'delete'),
      checkUserPermission('events', 'manage'),
      supabase.auth.getUser(),
    ]);

    if (!canDeleteEvents && !canManageEvents) {
      return { error: 'Insufficient permissions to delete events' };
    }
    if (authError || !user) {
      return { error: 'Unauthorized' };
    }

    const result = await EventService.deleteEvent(id);

    if ('error' in result) {
      return { error: result.error }
    }

    const event = result

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

    await deletePubOpsEventCalendarEntryByEventId(id, {
      context: 'event_deleted',
    })

    revalidatePath('/events');
    revalidateTag('dashboard')
    return { success: true };
  } catch (error: unknown) {
    logger.error('Unexpected error deleting event', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId: id },
    })
    return { error: getErrorMessage(error, 'An unexpected error occurred') };
  }
}

async function getEventFAQs(eventId: string): Promise<{ data?: EventFAQ[], error?: string }> {
  try {
    const data = await EventService.getEventFAQs(eventId);
    return { data };
  } catch (error: unknown) {
    logger.error('Error fetching event FAQs', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: getErrorMessage(error, 'Failed to fetch FAQs') };
  }
}

export async function getEventById(eventId: string): Promise<{ data?: Event | null, error?: string }> {
  try {
    const data = await EventService.getEventById(eventId);
    return { data };
  } catch (error: unknown) {
    logger.error('Error fetching event by ID', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: getErrorMessage(error, 'Failed to fetch event') };
  }
}

export async function getEvents(options?: {
  status?: 'all' | 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'sold_out';
  searchTerm?: string;
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderAsc?: boolean;
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
}): Promise<{ data?: (Event & { booked_count: number; link_clicks: number })[], pagination?: { totalCount: number, currentPage: number, pageSize: number, totalPages: number }, error?: string }> {
  try {
    const { events, pagination } = await EventService.getEvents(options);
    return { data: events as (Event & { booked_count: number; link_clicks: number })[], pagination };
  } catch (error: unknown) {
    logger.error('Error fetching events', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to fetch events') };
  }
}

export async function getEventBookings(eventId: string): Promise<{ data?: EventBookingRow[], error?: string }> {
  try {
    const canView = await checkUserPermission('events', 'view')
    if (!canView) {
      return { error: 'Insufficient permissions to view event bookings' }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('bookings')
      .select('id, customer_id, event_id, seats, event_seating_type, is_reminder_only, notes, attendee_names, created_at, status, source, hold_expires_at, customer:customers(id, first_name, last_name, mobile_number, email)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })

    if (error) throw error

    const bookings = (data ?? []) as unknown as EventBookingRow[]
    const bookingIds = bookings.map((booking) => booking.id).filter(Boolean)

    if (bookingIds.length === 0) {
      return { data: bookings }
    }

    const { data: paymentRows, error: paymentsError } = await supabase
      .from('payments')
      .select('event_booking_id, amount, status, charge_type, payment_method, payment_provider')
      .in('event_booking_id', bookingIds)

    if (paymentsError) throw paymentsError

    type PaymentRow = {
      event_booking_id: string | null
      amount: number | null
      status: string | null
      charge_type: string | null
      payment_method: string | null
      payment_provider: string | null
    }

    const paymentsByBooking = new Map<string, PaymentRow[]>()
    for (const payment of (paymentRows ?? []) as PaymentRow[]) {
      if (!payment.event_booking_id) continue
      const current = paymentsByBooking.get(payment.event_booking_id) ?? []
      current.push(payment)
      paymentsByBooking.set(payment.event_booking_id, current)
    }

    // Per-type breakdown (display-only) for genuinely multi-type bookings, plus
    // each booking's line-item charge total (feeds the revenue stat). One batched
    // query for all bookings — never blocks the listing on failure.
    const breakdownByBooking = new Map<string, string>()
    const chargeTotalByBooking = new Map<string, number>()
    try {
      const itemsByBooking = await loadBookingItemsWithTypes(supabase, bookingIds)
      if (itemsByBooking.size > 0) {
        const defaultTypeId = await getDefaultTicketTypeId(supabase, eventId)
        const ticketTypesOn = eventTicketTypesEnabled()
        for (const [bookingId, items] of itemsByBooking) {
          chargeTotalByBooking.set(bookingId, resolveBookingChargeAmount(items))
          if (!ticketTypesOn) continue
          if (!bookingItemsAreMultiType(items, defaultTypeId)) continue
          breakdownByBooking.set(bookingId, formatTicketBreakdownCompact(buildTicketBreakdownLines(items)))
        }
      }
    } catch (breakdownError) {
      logger.warn('Failed to load ticket-type breakdown for event bookings', {
        metadata: {
          eventId,
          error: breakdownError instanceof Error ? breakdownError.message : String(breakdownError),
        },
      })
    }

    const paidStatuses = new Set(['succeeded', 'paid', 'partially_refunded', 'refunded'])
    const refundStatuses = new Set(['refunded', 'succeeded', 'pending'])
    const withPayments = bookings.map((booking) => {
      const payments = paymentsByBooking.get(booking.id) ?? []
      // Refund rows are money OUT — they must never be counted as paid.
      const chargeRows = payments.filter((payment) => String(payment.charge_type || '').toLowerCase() !== 'refund')
      const refundRows = payments.filter((payment) => String(payment.charge_type || '').toLowerCase() === 'refund')
      const paidRows = chargeRows.filter((payment) => paidStatuses.has(String(payment.status || '').toLowerCase()))
      const chargePaid = paidRows.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0)
      const refundedAmount = refundRows
        .filter((payment) => refundStatuses.has(String(payment.status || '').toLowerCase()))
        .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0)
      const paidAmount = Math.max(0, chargePaid - refundedAmount)
      const statuses = new Set(chargeRows.map((payment) => String(payment.status || '').toLowerCase()).filter(Boolean))
      // £0 comp confirmations (e.g. transfer credits) must not mask the method
      // that actually paid for the booking.
      const hasRealCharge = paidRows.some((payment) => Number(payment.amount || 0) > 0)
      const methods = new Set(
        chargeRows
          .filter((payment) => {
            const method = String(payment.payment_method || payment.payment_provider || '').toLowerCase()
            return !(method === 'comp' && Number(payment.amount || 0) <= 0 && hasRealCharge)
          })
          .map((payment) => String(payment.payment_method || payment.payment_provider || '').toLowerCase())
          .filter(Boolean)
      )
      const paymentStatusSummary =
        statuses.has('refunded')
          ? 'Refunded'
          : statuses.has('partially_refunded')
            ? 'Part refunded'
            : paidRows.length > 0
              ? 'Paid'
              : statuses.has('pending')
                ? 'Pending'
                : null
      const paymentMethodSummary =
        methods.has('comp')
          ? 'Comp'
          : methods.has('card_terminal')
            ? 'Card'
            : methods.has('cash')
              ? 'Cash'
              : methods.has('paypal')
                ? 'PayPal'
                : null

      return {
        ...booking,
        paid_amount: Number(paidAmount.toFixed(2)),
        payment_status_summary: paymentStatusSummary,
        payment_method_summary: paymentMethodSummary,
        ticket_breakdown: breakdownByBooking.get(booking.id) ?? null,
        charge_total: chargeTotalByBooking.get(booking.id) ?? null,
      }
    })

    return { data: withPayments }
  } catch (error: unknown) {
    logger.error('Error fetching event bookings', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: getErrorMessage(error, 'Failed to fetch event bookings') }
  }
}

const createEventManualBookingSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().trim().min(7).max(32),
  defaultCountryCode: z.string().regex(/^\d{1,4}$/).optional(),
  seats: z.number().int().min(1).max(20),
  seatingPreference: z.enum(['seated', 'standing']).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  // Optional per-seat names (index 0 = lead booker). When provided the count
  // must equal seats — enforced below via normalizeAttendeeNames.
  attendeeNames: z.array(z.string().trim().min(1).max(MAX_ATTENDEE_NAME_LENGTH)).max(20).optional(),
  // Optional multi-ticket-type basket (staff parity with the website).
  // Quantities must sum to seats — enforced below.
  ticketSelections: z.array(z.object({
    ticketTypeId: z.string().uuid(),
    quantity: z.number().int().min(1).max(20)
  })).min(1).max(20).optional()
})

type EventManualBookingResult =
  | {
    error: string
  }
  | {
    success: true
    data: {
      state: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
      reason: string | null
      booking_id: string | null
      manage_booking_url: string | null
      next_step_url: string | null
      table_booking_id: string | null
      table_name: string | null
      event_seating_type: 'seated' | 'standing' | null
    }
    meta?: {
      sms: SmsSafetyMeta
    }
  }

export async function createEventManualBooking(input: {
  eventId: string
  phone: string
  seats: number
  seatingPreference?: 'seated' | 'standing'
  defaultCountryCode?: string
  firstName?: string
  lastName?: string
  attendeeNames?: string[]
  ticketSelections?: Array<{ ticketTypeId: string; quantity: number }>
}): Promise<EventManualBookingResult> {
  try {
    // ── Admin-specific pre-checks ────────────────────────────────────────────
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to create event bookings.' }
    }

    const parsed = createEventManualBookingSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid booking details.' }
    }

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(parsed.data.phone, {
        defaultCountryCode: parsed.data.defaultCountryCode
      })
    } catch {
      return { error: 'Please enter a valid phone number.' }
    }

    const supabase = createAdminClient()
    const customerResolution = await ensureCustomerForPhone(supabase, normalizedPhone, {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName
    })

    if (!customerResolution.customerId) {
      return { error: 'Could not create or find customer for this phone number.' }
    }

    const customerId = customerResolution.customerId

    const { data: eventRow, error: eventError } = await supabase
      .from('events')
      .select('id, name, booking_mode')
      .eq('id', parsed.data.eventId)
      .maybeSingle()

    if (eventError || !eventRow) {
      return { error: 'Event not found.' }
    }

    const bookingMode = EventBookingService.normalizeBookingMode(eventRow.booking_mode)

    // Admin-specific duplicate booking pre-check (catches 23505 unique violation
    // before it reaches the RPC, giving a friendlier error message)
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('event_id', parsed.data.eventId)
      .eq('customer_id', customerId)
      .in('status', ['confirmed', 'pending_payment'])
      .maybeSingle()

    if (existingBooking) {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: 'customer_conflict',
          booking_id: null,
          manage_booking_url: null,
          next_step_url: null,
          table_booking_id: null,
          table_name: null,
          event_seating_type: null
        }
      }
    }

    // ── Optional per-seat names + multi-ticket-type basket ──────────────────
    // Staff parity with the website booking path: the service already accepts
    // both, this action just validates and maps them through.
    let attendeeNames: string[] | undefined
    if (parsed.data.attendeeNames && parsed.data.attendeeNames.length > 0) {
      const namesResult = normalizeAttendeeNames(parsed.data.attendeeNames, parsed.data.seats)
      if (!namesResult.ok) {
        return { error: namesResult.error }
      }
      attendeeNames = namesResult.names.length > 0 ? namesResult.names : undefined
    }

    let ticketSelections: TicketSelectionInput[] | undefined
    if (parsed.data.ticketSelections && parsed.data.ticketSelections.length > 0) {
      const selectionSeatTotal = parsed.data.ticketSelections.reduce((sum, line) => sum + line.quantity, 0)
      if (selectionSeatTotal !== parsed.data.seats) {
        return { error: `Ticket quantities (${selectionSeatTotal}) must match the total seats (${parsed.data.seats}).` }
      }

      let defaultTypeId: string | null = null
      try {
        defaultTypeId = await getDefaultTicketTypeId(supabase, parsed.data.eventId)
      } catch {
        return { error: 'Failed to load event ticket types.' }
      }

      // Distribute the flat per-seat names across the basket lines in order so
      // the v07 RPC stores per-line names and the aggregate list stays intact.
      let nameCursor = 0
      const mappedSelections: TicketSelectionInput[] = parsed.data.ticketSelections.map((line) => {
        const lineNames = attendeeNames ? attendeeNames.slice(nameCursor, nameCursor + line.quantity) : []
        nameCursor += line.quantity
        return {
          ticket_type_id: line.ticketTypeId,
          quantity: line.quantity,
          ...(lineNames.length === line.quantity ? { attendee_names: lineNames } : {})
        }
      })

      const decision = decideTicketSelectionHandling({
        selections: mappedSelections,
        flagEnabled: eventTicketTypesEnabled(),
        defaultTypeId
      })
      if (decision.kind === 'reject') {
        return { error: decision.error }
      }
      if (decision.kind === 'apply') {
        ticketSelections = mappedSelections
      }
    }

    // ── Delegate to shared service ───────────────────────────────────────────
    const result = await EventBookingService.createBooking({
      eventId: parsed.data.eventId,
      customerId,
      normalizedPhone: normalizedPhone || '',
      seats: parsed.data.seats,
      source: 'admin',
      bookingMode,
      seatingPreference: parsed.data.seatingPreference,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      shouldSendSms: true,
      supabaseClient: supabase,
      logTag: 'admin event booking',
      firstName: customerResolution.resolvedFirstName || parsed.data.firstName,
      attendeeNames,
      ticketSelections
    })

    // ── Handle the result ────────────────────────────────────────────────────
    if (result.rpcFailed) {
      return { error: 'Failed to create booking.' }
    }

    if (result.rollbackFailed) {
      return { error: 'Failed to rollback booking after table reservation failure.' }
    }

    if (result.paymentLinkFailed) {
      logger.error('Admin booking: payment link generation failed', {
        metadata: { bookingId: result.bookingId, eventId: parsed.data.eventId }
      })
      return { error: 'Booking could not be created because the payment link failed. Please try again.' }
    }

    const { resolvedState, resolvedReason, bookingId, nextStepUrl, manageUrl, tableBookingId, tableName, eventSeatingType, smsMeta } = result

    if (resolvedState === 'blocked') {
      // Return as success with blocked state to match existing UI contract
      revalidatePath(`/events/${parsed.data.eventId}`)
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: resolvedReason,
          booking_id: null,
          manage_booking_url: null,
          next_step_url: null,
          table_booking_id: null,
          table_name: null,
          event_seating_type: null
        }
      }
    }

    // Log audit event for successful bookings
    const authSupabase = await createClient()
    const { data: { user } } = await authSupabase.auth.getUser()
    if (user) {
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'create',
        resource_type: 'event_booking',
        resource_id: bookingId || undefined,
        operation_status: 'success',
        additional_info: {
          event_id: parsed.data.eventId,
          customer_id: customerId,
          seats: parsed.data.seats,
          event_seating_type: eventSeatingType,
          state: resolvedState,
          source: 'admin',
          attendee_names_provided: (attendeeNames?.length ?? 0) > 0,
          ticket_selections: ticketSelections?.map((line) => ({
            ticket_type_id: line.ticket_type_id,
            quantity: line.quantity
          })) ?? null
        }
      })
    }

    revalidatePath(`/events/${parsed.data.eventId}`)
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')
    revalidateTag('dashboard')

    return {
      success: true,
      data: {
        state: resolvedState,
        reason: resolvedReason,
        booking_id: bookingId,
        manage_booking_url: manageUrl,
        next_step_url: nextStepUrl,
        table_booking_id: tableBookingId,
        table_name: tableName,
        event_seating_type: eventSeatingType
      },
      meta: {
        sms: smsMeta,
      },
    }
  } catch (error) {
    logger.error('Unexpected createEventManualBooking error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to create booking.') }
  }
}

const cancelEventManualBookingSchema = z.object({
  bookingId: z.string().uuid(),
  sendSms: z.boolean().optional().default(true),
  // Manager-only: whether to refund and how much. 'full' refunds everything still
  // refundable; 'partial' uses refundAmount. Defaults to no refund.
  refundDecision: z.enum(['none', 'full', 'partial']).optional().default('none'),
  refundAmount: z.number().min(0).max(100000).optional()
})

const updateEventManualBookingSeatsSchema = z.object({
  bookingId: z.string().uuid(),
  seats: z.number().int().min(1).max(20),
  sendSms: z.boolean().optional().default(true)
})

type CancelEventManualBookingResult =
  | {
    error: string
  }
  | {
    success: true
    data: {
      state: 'cancelled' | 'already_cancelled' | 'blocked'
      reason: string | null
      booking_id: string
      sms_sent: boolean
      refund_status: EventRefundResult['status']
      refund_amount: number
      /** Set when the booking was cancelled but a follow-up update failed. */
      warning?: string | null
    }
    meta?: {
      sms: SmsSafetyMeta
    }
  }

type UpdateEventManualBookingSeatsResult =
  | {
    error: string
  }
  | {
    success: true
    data: {
      state: 'updated' | 'unchanged' | 'blocked'
      reason: string | null
      booking_id: string
      old_seats: number
      new_seats: number
      delta: number
      sms_sent: boolean
    }
    meta?: {
      sms: SmsSafetyMeta
      table_booking_sync?: {
        success: boolean
        error: string | null
      }
    }
  }

function formatEventDateTimeForSms(input: {
  startDatetime?: string | null
  date?: string | null
  time?: string | null
}): string {
  let parsed: Date | null = null
  if (input.startDatetime) {
    const fromStart = new Date(input.startDatetime)
    if (Number.isFinite(fromStart.getTime())) {
      parsed = fromStart
    }
  }

  if (!parsed && input.date) {
    const fallbackTime = (input.time || '00:00').slice(0, 5)
    const fallback = new Date(`${input.date}T${fallbackTime}:00`)
    if (Number.isFinite(fallback.getTime())) {
      parsed = fallback
    }
  }

  if (!parsed) return 'your event time'

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(parsed)
}

function buildEventBookingCancelledSms(input: {
  firstName: string
  eventName: string
  eventStartText: string
  seats: number
  isReminderOnly: boolean
  refundNote?: string | null
}): string {
  if (input.isReminderOnly) {
    return `The Anchor: ${input.firstName}, your reminder guest entry for ${input.eventName} on ${input.eventStartText} has been removed. Reply if you need help rejoining.`
  }

  const seatWord = input.seats === 1 ? 'seat' : 'seats'
  const refundPart = input.refundNote ? ` ${input.refundNote}` : ''
  return `The Anchor: ${input.firstName}, your booking for ${input.eventName} on ${input.eventStartText} has been cancelled (${input.seats} ${seatWord}).${refundPart} Reply if you need help rebooking.`
}

function buildStaffCancellationRefundNote(input: {
  refundStatus: EventRefundResult['status']
  refundAmount: number
}): string | null {
  if (input.refundAmount <= 0) return 'No refund is due under the event cancellation policy.'
  const formatted = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(input.refundAmount)
  if (input.refundStatus === 'succeeded') return `Refund issued: ${formatted}.`
  if (input.refundStatus === 'pending') return `Refund pending: ${formatted}.`
  if (input.refundStatus === 'manual_required' || input.refundStatus === 'failed') {
    return `Refund needs staff follow-up: ${formatted}.`
  }
  return null
}

export async function updateEventManualBookingSeats(input: {
  bookingId: string
  seats: number
  sendSms?: boolean
}): Promise<UpdateEventManualBookingSeatsResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to edit event bookings.' }
    }

    const parsed = updateEventManualBookingSeatsSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid seat count.' }
    }

    const supabase = createAdminClient()

    const { data: bookingRow, error: bookingError } = await supabase.from('bookings')
      .select('id, event_id, customer_id, status, seats, is_reminder_only, attendee_names, event:events(id, payment_mode)')
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow?.id) {
      return { error: 'Booking not found.' }
    }

    // Paid (prepaid + confirmed) bookings must not change size without money
    // moving — route staff to the refund/charge flows instead.
    const seatEditEventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const isPrepaidConfirmedBooking =
      bookingRow.status === 'confirmed' &&
      bookingRow.is_reminder_only !== true &&
      (seatEditEventRecord as { payment_mode?: string | null } | null)?.payment_mode === 'prepaid'

    if (isPrepaidConfirmedBooking) {
      return {
        error:
          'This booking has already been paid, so the seat count cannot be changed here. Cancel it with a refund to reduce seats, or take a payment for the extra seats instead.'
      }
    }

    // Multi-type bookings: the overall seat count is derived from the ticket
    // lines, and the default-item sync deliberately leaves them alone — editing
    // seats here would desync line items, charge and door lists.
    try {
      const bookingItems = await loadBookingItems(supabase, parsed.data.bookingId)
      if (bookingItems.length > 0 && bookingRow.event_id) {
        const defaultTypeId = await getDefaultTicketTypeId(supabase, bookingRow.event_id)
        if (bookingItemsAreMultiType(bookingItems, defaultTypeId)) {
          return {
            error:
              'This booking has multiple ticket options, so the overall seat count cannot be edited. Edit the ticket lines instead.'
          }
        }
      }
    } catch (itemsError) {
      logger.warn('Failed to check booking items before staff seat update', {
        metadata: {
          bookingId: parsed.data.bookingId,
          error: itemsError instanceof Error ? itemsError.message : String(itemsError),
        },
      })
    }

    const updateResult = await updateEventBookingSeatsById(supabase, {
      bookingId: parsed.data.bookingId,
      newSeats: parsed.data.seats,
      actor: 'admin'
    })

    if (!updateResult.booking_id) {
      return { error: 'Booking update failed.' }
    }

    if (updateResult.state === 'blocked') {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: updateResult.reason || 'unavailable',
          booking_id: updateResult.booking_id,
          old_seats: Math.max(1, Number(updateResult.old_seats ?? parsed.data.seats)),
          new_seats: Math.max(1, Number(updateResult.new_seats ?? parsed.data.seats)),
          delta: Number(updateResult.delta ?? 0),
          sms_sent: false
        }
      }
    }

    const oldSeats = Math.max(1, Number(updateResult.old_seats ?? parsed.data.seats))
    const newSeats = Math.max(1, Number(updateResult.new_seats ?? parsed.data.seats))
    const delta = Number(updateResult.delta ?? (newSeats - oldSeats))

    // Keep the attendee-name list no longer than the booking — a stale longer
    // list would put ghosts on door lists and confirmation emails.
    const existingAttendeeNames = Array.isArray(bookingRow.attendee_names)
      ? (bookingRow.attendee_names as string[])
      : null
    if (
      updateResult.state === 'updated' &&
      existingAttendeeNames &&
      existingAttendeeNames.length > newSeats
    ) {
      const { error: attendeeTrimError } = await supabase.from('bookings')
        .update({
          attendee_names: existingAttendeeNames.slice(0, newSeats),
          updated_at: new Date().toISOString()
        })
        .eq('id', updateResult.booking_id)

      if (attendeeTrimError) {
        logger.warn('Failed to trim attendee names after staff seat update', {
          metadata: {
            bookingId: updateResult.booking_id,
            error: attendeeTrimError.message,
          },
        })
      }
    }

    if (updateResult.state === 'updated' && delta !== 0) {
      const authSupabase = await createClient()
      const { data: { user: actingUser } } = await authSupabase.auth.getUser()
      await logAuditEvent({
        user_id: actingUser?.id,
        user_email: actingUser?.email ?? undefined,
        operation_type: 'update',
        resource_type: 'event_booking',
        resource_id: updateResult.booking_id,
        operation_status: 'success',
        additional_info: {
          action: 'update_seats',
          event_id: bookingRow.event_id,
          customer_id: bookingRow.customer_id,
          old_seats: oldSeats,
          new_seats: newSeats,
          delta
        }
      })
    }

    const tableSyncPromise = supabase.from('table_bookings')
      .update({
        party_size: newSeats,
        committed_party_size: newSeats,
        updated_at: new Date().toISOString()
      })
      .eq('event_booking_id', updateResult.booking_id)
      .not('status', 'in', '(cancelled,no_show)')
      .select('id')

    const analyticsPromise =
      delta !== 0 && bookingRow.event_id && updateResult.customer_id
        ? recordEventAnalyticsSafe(supabase, {
          customerId: updateResult.customer_id,
          eventBookingId: updateResult.booking_id,
          eventType: 'event_booking_updated',
          metadata: {
            event_id: bookingRow.event_id,
            source: 'admin',
            old_seats: oldSeats,
            new_seats: newSeats,
            delta
          }
        }, {
          customerId: updateResult.customer_id,
          eventId: bookingRow.event_id,
          eventBookingId: updateResult.booking_id,
          eventType: 'event_booking_updated'
        })
        : Promise.resolve()

    const [tableSyncOutcome, analyticsOutcome] = await Promise.allSettled([
      tableSyncPromise,
      analyticsPromise
    ])

    let tableBookingSyncMeta: { success: boolean; error: string | null } | null = null
    if (tableSyncOutcome.status === 'rejected') {
      const reason = tableSyncOutcome.reason instanceof Error ? tableSyncOutcome.reason.message : String(tableSyncOutcome.reason)
      tableBookingSyncMeta = { success: false, error: reason }
      logger.error('Linked table booking party-size sync task rejected unexpectedly', {
        metadata: {
          bookingId: updateResult.booking_id,
          error: reason,
        },
      })
    } else {
      const syncResult = tableSyncOutcome.value as {
        data?: Array<{ id?: string | null }> | null
        error?: { message?: string } | null
      } | null
      let tableSyncError: string | null = null

      if (syncResult?.error?.message) {
        tableSyncError = syncResult.error.message
      } else if (!Array.isArray(syncResult?.data)) {
        tableSyncError = 'mutation_result_unavailable'
      } else if (syncResult.data.length === 0) {
        const {
          data: remainingActiveLinkedBookings,
          error: remainingActiveLinkedBookingsError
        } = await supabase.from('table_bookings')
          .select('id')
          .eq('event_booking_id', updateResult.booking_id)
          .not('status', 'in', '(cancelled,no_show)')

        if (remainingActiveLinkedBookingsError?.message) {
          tableSyncError = `verification_error:${remainingActiveLinkedBookingsError.message}`
        } else if (!Array.isArray(remainingActiveLinkedBookings)) {
          tableSyncError = 'verification_result_unavailable'
        } else if (remainingActiveLinkedBookings.length > 0) {
          tableSyncError = `active_rows_remaining:${remainingActiveLinkedBookings.length}`
        }
      }

      if (tableSyncError) {
        tableBookingSyncMeta = { success: false, error: tableSyncError }
        logger.error('Failed to sync linked table booking party size after event booking seat update', {
          metadata: {
            bookingId: updateResult.booking_id,
            error: tableSyncError,
          },
        })
      } else {
        tableBookingSyncMeta = { success: true, error: null }
      }
    }

    if (analyticsOutcome.status === 'rejected') {
      const reason = analyticsOutcome.reason instanceof Error ? analyticsOutcome.reason.message : String(analyticsOutcome.reason)
      logger.warn('Event booking seat-update analytics task rejected unexpectedly', {
        metadata: {
          bookingId: updateResult.booking_id,
          error: reason,
        },
      })
    }

    if (bookingRow.event_id) {
      await syncPubOpsEventCalendarByEventId(supabase, bookingRow.event_id, {
        bookingId: updateResult.booking_id,
        context: 'admin_event_booking_seats_updated',
      })
    }

    let smsSent = false
    let smsMeta: SmsSafetyMeta = null
    if (parsed.data.sendSms !== false && delta !== 0) {
      try {
        const smsResult = await sendEventBookingSeatUpdateSms(supabase, {
          bookingId: updateResult.booking_id,
          eventName: updateResult.event_name || null,
          oldSeats,
          newSeats,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        })
        const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
        const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
        const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure
        smsSent = smsDeliveredOrUnknown
        smsMeta = {
          success: smsDeliveredOrUnknown,
          code: smsCode,
          logFailure: smsLogFailure,
        }
      } catch (smsError) {
        logger.warn('Failed to send seat update SMS', {
          metadata: {
            bookingId: updateResult.booking_id,
            error: smsError instanceof Error ? smsError.message : String(smsError),
          },
        })
        smsMeta = { success: false, code: 'unexpected_exception', logFailure: false }
      }
    }

    if (bookingRow.event_id) {
      revalidatePath(`/events/${bookingRow.event_id}`)
    }
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')
    revalidatePath('/table-bookings/boh')
    revalidateTag('dashboard')

    return {
      success: true,
      data: {
        state: updateResult.state,
        reason: null,
        booking_id: updateResult.booking_id,
        old_seats: oldSeats,
        new_seats: newSeats,
        delta,
        sms_sent: smsSent
      },
      meta: {
        sms: smsMeta,
        table_booking_sync: tableBookingSyncMeta,
      },
    }
  } catch (error) {
    logger.error('Unexpected updateEventManualBookingSeats error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to update booking seats.') }
  }
}

const updateEventBookingAttendeeNamesSchema = z.object({
  bookingId: z.string().uuid(),
  attendeeNames: z.array(z.string().trim().max(MAX_ATTENDEE_NAME_LENGTH)).max(50)
})

type UpdateEventBookingAttendeeNamesResult =
  | { error: string }
  | {
      success: true
      data: {
        booking_id: string
        attendee_names: string[]
      }
    }

/**
 * Staff edit of a booking's per-ticket attendee names (aggregate list on
 * `bookings.attendee_names`, index 0 = lead booker). Blank entries are dropped;
 * the stored list can never be longer than the booking's seats.
 */
export async function updateEventBookingAttendeeNames(input: {
  bookingId: string
  attendeeNames: string[]
}): Promise<UpdateEventBookingAttendeeNamesResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to edit event bookings.' }
    }

    const parsed = updateEventBookingAttendeeNamesSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid attendee names.' }
    }

    const names = parsed.data.attendeeNames
      .map((name) => name.trim())
      .filter((name) => name.length > 0)

    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase.from('bookings')
      .select('id, event_id, seats, status, is_reminder_only, attendee_names')
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }

    if (bookingRow.is_reminder_only === true) {
      return { error: 'Reminder-only entries have no tickets to name.' }
    }

    const seats = Math.max(0, Number(bookingRow.seats) || 0)
    if (names.length > seats) {
      return { error: `This booking has ${seats} seat${seats === 1 ? '' : 's'}, so you can enter at most ${seats} name${seats === 1 ? '' : 's'}.` }
    }

    const previousNames = Array.isArray(bookingRow.attendee_names)
      ? (bookingRow.attendee_names as string[]).filter((name) => typeof name === 'string' && name.trim().length > 0)
      : []

    const { error: updateError } = await supabase.from('bookings')
      .update({ attendee_names: names })
      .eq('id', bookingRow.id)

    if (updateError) {
      logger.error('Failed to update event booking attendee names', {
        error: new Error(updateError.message || 'Failed to update attendee names'),
        metadata: { bookingId: bookingRow.id }
      })
      return { error: 'Failed to update attendee names.' }
    }

    const authSupabase = await createClient()
    const { data: { user } } = await authSupabase.auth.getUser()
    await logAuditEvent({
      user_id: user?.id ?? undefined,
      operation_type: 'update',
      resource_type: 'event_booking',
      resource_id: bookingRow.id,
      operation_status: 'success',
      additional_info: {
        event_id: bookingRow.event_id,
        field: 'attendee_names',
        old_count: previousNames.length,
        new_count: names.length,
        seats
      }
    })

    if (bookingRow.event_id) {
      revalidatePath(`/events/${bookingRow.event_id}`)
    }

    return {
      success: true,
      data: {
        booking_id: bookingRow.id,
        attendee_names: names
      }
    }
  } catch (error) {
    logger.error('Unexpected updateEventBookingAttendeeNames error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to update attendee names.') }
  }
}

async function resolveEventRefundActor(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ userId: string | null; email: string | null; mayRefund: boolean }> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  let roleNames: string[] = []
  if (user?.id) {
    const { data: roleRows } = await supabase.rpc('get_user_roles', { p_user_id: user.id })
    roleNames = ((roleRows as Array<{ role_name?: string }> | null) ?? [])
      .map((row) => row.role_name)
      .filter((name): name is string => typeof name === 'string')
  }
  return {
    userId: user?.id ?? null,
    email: user?.email ?? null,
    mayRefund: canIssueEventRefund({ email: user?.email, roleNames })
  }
}

async function computeEventBookingRefundable(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<{ amountPaid: number; alreadyRefunded: number; maxRefundable: number }> {
  const [paidResult, refundResult] = await Promise.all([
    supabase.from('payments').select('amount')
      .eq('event_booking_id', bookingId)
      .in('charge_type', ['prepaid_event', 'seat_increase'])
      .in('status', ['succeeded', 'partially_refunded']),
    supabase.from('payments').select('amount')
      .eq('event_booking_id', bookingId)
      .eq('charge_type', 'refund')
      .in('status', ['refunded', 'pending', 'succeeded'])
  ])
  if (paidResult.error) throw paidResult.error
  if (refundResult.error) throw refundResult.error
  const amountPaid = (paidResult.data || []).reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0)
  const alreadyRefunded = (refundResult.data || []).reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0)
  return {
    amountPaid: toMoney(amountPaid),
    alreadyRefunded: toMoney(alreadyRefunded),
    maxRefundable: toMoney(Math.max(0, amountPaid - alreadyRefunded))
  }
}

export async function cancelEventManualBooking(input: {
  bookingId: string
  sendSms?: boolean
  refundDecision?: 'none' | 'full' | 'partial'
  refundAmount?: number
}): Promise<CancelEventManualBookingResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to cancel event bookings.' }
    }

    const parsed = cancelEventManualBookingSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid booking id.' }
    }

    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase.from('bookings')
      .select(`
        id,
        event_id,
        customer_id,
        seats,
        status,
        is_reminder_only,
        event:events(id, name, start_datetime, date, time, payment_mode, price, price_per_seat, online_discount_type, online_discount_value, is_free),
        customer:customers(id, first_name, mobile_number, sms_status)
      `)
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }

    const bookingStatus = typeof bookingRow.status === 'string' ? bookingRow.status : null
    if (bookingStatus === 'cancelled' || bookingStatus === 'expired') {
      return {
        success: true,
        data: {
          state: 'already_cancelled',
          reason: bookingStatus,
          booking_id: bookingRow.id,
          sms_sent: false,
          refund_status: 'none',
          refund_amount: 0
        }
      }
    }

    if (bookingStatus && !['confirmed', 'pending_payment'].includes(bookingStatus)) {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: 'status_not_cancellable',
          booking_id: bookingRow.id,
          sms_sent: false,
          refund_status: 'none',
          refund_amount: 0
        }
      }
    }

    // ── Manager refund decision (money actions are manager-only) ───────────────
    const eventForRefund = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const isPrepaidConfirmed =
      bookingStatus === 'confirmed' &&
      bookingRow.is_reminder_only !== true &&
      Boolean(bookingRow.customer_id) &&
      Boolean(bookingRow.event_id) &&
      Boolean(eventForRefund) &&
      (eventForRefund as any).payment_mode === 'prepaid'

    const { maxRefundable } = isPrepaidConfirmed
      ? await computeEventBookingRefundable(supabase, bookingRow.id)
      : { maxRefundable: 0 }

    const { userId: actingUserId, mayRefund } = await resolveEventRefundActor(supabase)
    const refundDecision = parsed.data.refundDecision ?? 'none'

    // A paid booking can only be cancelled by a manager — it entails a refund decision.
    if (maxRefundable > 0 && !mayRefund) {
      return { error: 'Only a manager can cancel a paid booking. Please ask a manager to do this.' }
    }
    if (refundDecision !== 'none' && !mayRefund) {
      return { error: 'Only a manager can issue refunds.' }
    }

    let resolvedRefundAmount = 0
    if (refundDecision === 'full') {
      resolvedRefundAmount = maxRefundable
    } else if (refundDecision === 'partial') {
      const requested = toMoney(Math.max(0, Number(parsed.data.refundAmount ?? 0)))
      if (requested <= 0) {
        return { error: 'Enter a refund amount, or choose “No refund”.' }
      }
      if (requested > maxRefundable) {
        return { error: `Refund cannot exceed the amount paid (£${maxRefundable.toFixed(2)}).` }
      }
      resolvedRefundAmount = requested
    }

    const nowIso = new Date().toISOString()
    const { data: cancelledBooking, error: cancelError } = await supabase.from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'admin',
        updated_at: nowIso
      })
      .eq('id', bookingRow.id)
      .select('id')
      .maybeSingle()

    if (cancelError) {
      return { error: cancelError.message || 'Failed to cancel booking.' }
    }

    if (!cancelledBooking) {
      return { error: 'Booking not found.' }
    }

    const [holdReleaseResult, tableBookingCancelResult] = await Promise.all([
      supabase.from('booking_holds')
        .update({
          status: 'released',
          released_at: nowIso,
          updated_at: nowIso
        })
        .eq('event_booking_id', bookingRow.id)
        .eq('status', 'active')
        .select('id'),
      supabase.from('table_bookings')
        .update({
          status: 'cancelled',
          cancellation_reason: 'event_booking_cancelled_admin',
          cancelled_at: nowIso,
          updated_at: nowIso
        })
        .eq('event_booking_id', bookingRow.id)
        .not('status', 'in', '(cancelled,no_show)')
        .select('id')
    ])

    const followupFailureSet = new Set<string>()
    let holdReleaseVerification: string | null = null
    let tableBookingCancelVerification: string | null = null
    let holdReleaseRemainingCount: number | null = null
    let tableBookingCancelRemainingCount: number | null = null

    if (holdReleaseResult?.error) {
      followupFailureSet.add('booking_holds_release')
    }
    if (tableBookingCancelResult?.error) {
      followupFailureSet.add('table_bookings_cancel')
    }

    const holdReleaseRows = Array.isArray(holdReleaseResult?.data) ? holdReleaseResult.data : null
    const tableBookingCancelRows = Array.isArray(tableBookingCancelResult?.data)
      ? tableBookingCancelResult.data
      : null

    if (!holdReleaseResult?.error && !holdReleaseRows) {
      followupFailureSet.add('booking_holds_release')
      holdReleaseVerification = 'mutation_result_unavailable'
    }

    if (!tableBookingCancelResult?.error && !tableBookingCancelRows) {
      followupFailureSet.add('table_bookings_cancel')
      tableBookingCancelVerification = 'mutation_result_unavailable'
    }

    if (followupFailureSet.size === 0) {
      if (holdReleaseRows && holdReleaseRows.length === 0) {
        const { data: remainingActiveHolds, error: remainingActiveHoldsError } = await (
          supabase.from('booking_holds')
        )
          .select('id')
          .eq('event_booking_id', bookingRow.id)
          .eq('status', 'active')

        if (remainingActiveHoldsError) {
          followupFailureSet.add('booking_holds_release')
          holdReleaseVerification = `verification_error:${remainingActiveHoldsError.message || 'unknown_error'}`
        } else if (!Array.isArray(remainingActiveHolds)) {
          followupFailureSet.add('booking_holds_release')
          holdReleaseVerification = 'verification_result_unavailable'
        } else if (remainingActiveHolds.length > 0) {
          followupFailureSet.add('booking_holds_release')
          holdReleaseVerification = 'active_rows_remaining'
          holdReleaseRemainingCount = remainingActiveHolds.length
        }
      }

      if (tableBookingCancelRows && tableBookingCancelRows.length === 0) {
        const {
          data: remainingActiveTableBookings,
          error: remainingActiveTableBookingsError
        } = await supabase.from('table_bookings')
          .select('id')
          .eq('event_booking_id', bookingRow.id)
          .not('status', 'in', '(cancelled,no_show)')

        if (remainingActiveTableBookingsError) {
          followupFailureSet.add('table_bookings_cancel')
          tableBookingCancelVerification = `verification_error:${remainingActiveTableBookingsError.message || 'unknown_error'}`
        } else if (!Array.isArray(remainingActiveTableBookings)) {
          followupFailureSet.add('table_bookings_cancel')
          tableBookingCancelVerification = 'verification_result_unavailable'
        } else if (remainingActiveTableBookings.length > 0) {
          followupFailureSet.add('table_bookings_cancel')
          tableBookingCancelVerification = 'active_rows_remaining'
          tableBookingCancelRemainingCount = remainingActiveTableBookings.length
        }
      }
    }

    const followupFailures = Array.from(followupFailureSet)

    if (bookingRow.event_id) {
      await syncPubOpsEventCalendarByEventId(supabase, bookingRow.event_id, {
        bookingId: bookingRow.id,
        context: 'admin_event_booking_cancelled',
      })
    }

    // The booking is already cancelled at this point, so follow-up failures must
    // NOT abort the flow — the manager's refund decision, customer notifications
    // and the audit trail still have to happen. Surface a warning instead.
    let followupWarning: string | null = null
    if (followupFailures.length > 0) {
      logger.warn('Event booking cancellation follow-up updates failed', {
        metadata: {
          bookingId: bookingRow.id,
          failures: followupFailures,
          holdReleaseError: holdReleaseResult?.error?.message,
          tableBookingCancelError: tableBookingCancelResult?.error?.message,
          holdReleaseVerification,
          tableBookingCancelVerification,
          holdReleaseRemainingCount,
          tableBookingCancelRemainingCount
        }
      })

      const warningParts: string[] = []
      if (followupFailureSet.has('booking_holds_release')) {
        warningParts.push('booking holds could not be released')
      }
      if (followupFailureSet.has('table_bookings_cancel')) {
        warningParts.push('linked table bookings could not be cancelled')
      }
      followupWarning = `Booking cancelled, but ${warningParts.join(' and ')}. Please refresh and contact engineering if this persists.`
    }

    const eventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const customerRecord = Array.isArray(bookingRow.customer) ? bookingRow.customer[0] : bookingRow.customer
    let refundStatus: EventRefundResult['status'] = 'none'
    let refundAmount = 0

    if (resolvedRefundAmount > 0 && bookingRow.customer_id && bookingRow.event_id) {
      try {
        const refundResult = await processEventRefund(supabase, {
          bookingId: bookingRow.id,
          customerId: bookingRow.customer_id,
          eventId: bookingRow.event_id,
          amount: resolvedRefundAmount,
          reason: 'staff_cancel_refund',
          metadata: {
            idempotency_key: `staff-cancel-refund:${bookingRow.id}`,
            cancelled_by: 'admin',
            initiated_by: actingUserId,
            decision: refundDecision,
            max_refundable: maxRefundable
          }
        })
        refundStatus = refundResult.status
        refundAmount = refundResult.amount
      } catch (refundError) {
        refundStatus = 'manual_required'
        refundAmount = resolvedRefundAmount
        logger.error('Failed to process event refund during staff cancellation', {
          error: refundError instanceof Error ? refundError : new Error(String(refundError)),
          metadata: {
            bookingId: bookingRow.id,
            customerId: bookingRow.customer_id,
            eventId: bookingRow.event_id,
            refundAmount: resolvedRefundAmount
          }
        })
      }
    }

    let smsSent = false
    let smsMeta: SmsSafetyMeta = null
    const shouldSendSms = parsed.data.sendSms !== false
    if (
      shouldSendSms &&
      customerRecord?.id &&
      typeof customerRecord.mobile_number === 'string' &&
      customerRecord.mobile_number.trim() &&
      customerRecord.sms_status === 'active'
    ) {
      const smsBody = ensureReplyInstruction(
        buildEventBookingCancelledSms({
          firstName: getSmartFirstName(customerRecord.first_name),
          eventName: eventRecord?.name || 'your event',
          eventStartText: formatEventDateTimeForSms({
            startDatetime: eventRecord?.start_datetime ?? null,
            date: eventRecord?.date ?? null,
            time: eventRecord?.time ?? null
          }),
          seats: Math.max(0, Number(bookingRow.seats || 0)),
          isReminderOnly: bookingRow.is_reminder_only === true,
          refundNote: buildStaffCancellationRefundNote({ refundStatus, refundAmount })
        }),
        process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
      )

      try {
        const smsResult = await sendSMS(customerRecord.mobile_number, smsBody, {
          customerId: customerRecord.id,
          metadata: {
            event_booking_id: bookingRow.id,
            event_id: bookingRow.event_id,
            template_key: 'event_booking_cancelled_admin'
          }
        })

        const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
        const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
        const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure
        smsSent = smsDeliveredOrUnknown
        smsMeta = { success: smsDeliveredOrUnknown, code: smsCode, logFailure: smsLogFailure }

        if (smsLogFailure) {
          logger.error('Event booking cancellation SMS sent but outbound message logging failed', {
            metadata: {
              bookingId: bookingRow.id,
              customerId: customerRecord.id,
              code: smsCode,
              logFailure: smsLogFailure,
            },
          })
        }
      } catch (smsError) {
        logger.warn('Event booking cancellation SMS threw unexpectedly', {
          metadata: {
            bookingId: bookingRow.id,
            customerId: customerRecord.id,
            error: smsError instanceof Error ? smsError.message : String(smsError)
          }
        })
        smsMeta = { success: false, code: 'unexpected_exception', logFailure: false }
      }
    }

    await sendEventBookingCancelledEmail(supabase, {
      bookingId: bookingRow.id,
      refundStatus,
      refundAmount,
      currency: 'GBP',
      reason: 'staff_cancel'
    })

    await logAuditEvent({
      user_id: actingUserId ?? undefined,
      operation_type: 'update',
      resource_type: 'event_booking',
      resource_id: bookingRow.id,
      operation_status: 'success',
      additional_info: {
        action: 'cancel',
        refund_decision: refundDecision,
        refund_status: refundStatus,
        refund_amount: refundAmount,
        max_refundable: maxRefundable,
        followup_failures: followupFailures.length > 0 ? followupFailures : undefined
      }
    })

    if (bookingRow.customer_id) {
      await recordEventAnalyticsSafe(supabase, {
        customerId: bookingRow.customer_id,
        eventBookingId: bookingRow.id,
        eventType: 'event_booking_cancelled',
        metadata: {
          event_id: bookingRow.event_id,
          seats: bookingRow.seats,
          source: 'admin',
          sms_sent: smsSent,
          refund_status: refundStatus,
          refund_amount: refundAmount
        }
      }, {
        customerId: bookingRow.customer_id,
        eventId: bookingRow.event_id,
        eventBookingId: bookingRow.id,
        eventType: 'event_booking_cancelled'
      })
    }

    revalidatePath(`/events/${bookingRow.event_id}`)
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')
    revalidateTag('dashboard')

    return {
      success: true,
      data: {
        state: 'cancelled',
        reason: null,
        booking_id: bookingRow.id,
        sms_sent: smsSent,
        refund_status: refundStatus,
        refund_amount: refundAmount,
        warning: followupWarning
      },
      meta: {
        sms: smsMeta,
      },
    }
  } catch (error) {
    logger.error('Unexpected cancelEventManualBooking error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to cancel booking.') }
  }
}

type EventBookingRefundInfo =
  | { error: string }
  | {
      success: true
      data: {
        canRefund: boolean
        amountPaid: number
        alreadyRefunded: number
        maxRefundable: number
        policySuggestion: number
      }
    }

/** Refund context for the staff cancel dialog: how much is refundable, a policy
 *  suggestion, and whether the current user may issue refunds. */
export async function getEventBookingRefundInfo(bookingId: string): Promise<EventBookingRefundInfo> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to view this.' }
    }
    const parsedId = z.string().uuid().safeParse(bookingId)
    if (!parsedId.success) {
      return { error: 'Invalid booking id.' }
    }

    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase.from('bookings')
      .select('id, status, is_reminder_only, event:events(payment_mode, start_datetime, date, time)')
      .eq('id', parsedId.data)
      .maybeSingle()

    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }

    const eventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const isPrepaidConfirmed =
      bookingRow.status === 'confirmed' &&
      bookingRow.is_reminder_only !== true &&
      Boolean(eventRecord) &&
      (eventRecord as any).payment_mode === 'prepaid'

    const { amountPaid, alreadyRefunded, maxRefundable } = isPrepaidConfirmed
      ? await computeEventBookingRefundable(supabase, bookingRow.id)
      : { amountPaid: 0, alreadyRefunded: 0, maxRefundable: 0 }

    let policySuggestion = 0
    if (maxRefundable > 0 && eventRecord) {
      const startIso =
        (eventRecord as any).start_datetime ||
        ((eventRecord as any).date
          ? `${(eventRecord as any).date}T${(((eventRecord as any).time || '00:00') as string).slice(0, 5)}:00`
          : null)
      const policy = startIso ? getEventRefundPolicy(startIso) : { refundRate: 0 }
      policySuggestion = toMoney(maxRefundable * policy.refundRate)
    }

    const { mayRefund } = await resolveEventRefundActor(supabase)

    return {
      success: true,
      data: { canRefund: mayRefund, amountPaid, alreadyRefunded, maxRefundable, policySuggestion }
    }
  } catch (error) {
    logger.error('Failed to load event booking refund info', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return { error: getErrorMessage(error, 'Failed to load refund details.') }
  }
}

const refundEventBookingManualSchema = z.object({
  bookingId: z.string().uuid(),
  // Omitted → refund everything still refundable.
  amount: z.number().min(0.01).max(100000).optional(),
  reason: z.string().trim().max(200).optional()
})

type RefundEventBookingManualResult =
  | { error: string }
  | {
      success: true
      data: {
        booking_id: string
        refund_status: EventRefundResult['status']
        refund_amount: number
        max_refundable: number
      }
    }

/**
 * After-the-fact refund for an event booking (cancelled OR still-confirmed paid
 * bookings). Managers only — reuses the cancel flow's refund machinery with a
 * stable idempotency key so retries never double-refund.
 */
export async function refundEventBookingManual(input: {
  bookingId: string
  amount?: number
  reason?: string
}): Promise<RefundEventBookingManualResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to refund event bookings.' }
    }

    const parsed = refundEventBookingManualSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid refund details.' }
    }

    const supabase = createAdminClient()
    const { userId: actingUserId, email: actingUserEmail, mayRefund } = await resolveEventRefundActor(supabase)
    if (!mayRefund) {
      return { error: 'Only a manager can issue refunds.' }
    }

    const { data: bookingRow, error: bookingError } = await supabase.from('bookings')
      .select('id, event_id, customer_id, status, is_reminder_only')
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }

    if (bookingRow.is_reminder_only === true) {
      return { error: 'Reminder-only entries have no payments to refund.' }
    }

    const bookingStatus = typeof bookingRow.status === 'string' ? bookingRow.status : null
    if (bookingStatus !== 'confirmed' && bookingStatus !== 'cancelled') {
      return { error: 'Only paid or cancelled bookings can be refunded.' }
    }

    if (!bookingRow.customer_id || !bookingRow.event_id) {
      return { error: 'This booking is missing customer or event details, so it cannot be refunded here.' }
    }

    const { maxRefundable } = await computeEventBookingRefundable(supabase, bookingRow.id)
    if (maxRefundable <= 0) {
      return { error: 'There is nothing left to refund on this booking.' }
    }

    let resolvedAmount = maxRefundable
    if (typeof parsed.data.amount === 'number') {
      const requested = toMoney(Math.max(0, parsed.data.amount))
      if (requested <= 0) {
        return { error: 'Enter a refund amount greater than zero.' }
      }
      if (requested > maxRefundable) {
        return { error: `Refund cannot exceed the amount paid (£${maxRefundable.toFixed(2)}).` }
      }
      resolvedAmount = requested
    }

    let refundResult: EventRefundResult
    try {
      refundResult = await processEventRefund(supabase, {
        bookingId: bookingRow.id,
        customerId: bookingRow.customer_id,
        eventId: bookingRow.event_id,
        amount: resolvedAmount,
        reason: 'staff_manual_refund',
        metadata: {
          idempotency_key: `staff-manual-refund:${bookingRow.id}`,
          initiated_by: actingUserId,
          note: parsed.data.reason || null,
          max_refundable: maxRefundable
        }
      })
    } catch (refundError) {
      logger.error('Failed to process manual event refund', {
        error: refundError instanceof Error ? refundError : new Error(String(refundError)),
        metadata: {
          bookingId: bookingRow.id,
          customerId: bookingRow.customer_id,
          eventId: bookingRow.event_id,
          refundAmount: resolvedAmount
        }
      })
      return { error: 'The refund could not be processed. Please try again, or handle it in PayPal.' }
    }

    await logAuditEvent({
      user_id: actingUserId ?? undefined,
      user_email: actingUserEmail ?? undefined,
      operation_type: 'refund_event_booking',
      resource_type: 'event_booking',
      resource_id: bookingRow.id,
      operation_status: 'success',
      additional_info: {
        event_id: bookingRow.event_id,
        customer_id: bookingRow.customer_id,
        booking_status: bookingStatus,
        requested_amount: resolvedAmount,
        refund_status: refundResult.status,
        refund_amount: refundResult.amount,
        max_refundable: maxRefundable,
        reason: parsed.data.reason || null
      }
    })

    if (bookingRow.event_id) {
      revalidatePath(`/events/${bookingRow.event_id}`)
    }
    revalidatePath('/events')
    revalidateTag('dashboard')

    return {
      success: true,
      data: {
        booking_id: bookingRow.id,
        refund_status: refundResult.status,
        refund_amount: refundResult.amount,
        max_refundable: maxRefundable
      }
    }
  } catch (error) {
    logger.error('Unexpected refundEventBookingManual error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to refund booking.') }
  }
}

const markEventBookingPaidSchema = z.object({
  bookingId: z.string().uuid(),
  method: z.enum(['cash', 'card_terminal', 'comp']),
  note: z.string().trim().max(500).optional(),
  sendSms: z.boolean().optional().default(true)
})

type MarkEventBookingPaidResult =
  | { error: string }
  | {
      success: true
      data: {
        state: 'confirmed' | 'already_confirmed' | 'manual_review' | 'blocked'
        reason: string | null
        booking_id: string
        payment_id: string | null
        sms_sent: boolean
      }
      meta?: { sms: SmsSafetyMeta }
    }

export async function markEventBookingPaidManually(input: {
  bookingId: string
  method: EventManualPaymentMethod
  note?: string
  sendSms?: boolean
}): Promise<MarkEventBookingPaidResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to mark event bookings paid.' }
    }

    const parsed = markEventBookingPaidSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid payment details.' }
    }

    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase
      .from('bookings')
      .select('id, event_id, customer_id, seats, status, event:events(id, name, payment_mode, price, price_per_seat, online_discount_type, online_discount_value, is_free)')
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }

    if (bookingRow.status === 'cancelled' || bookingRow.status === 'expired') {
      return { error: 'This booking is no longer payable.' }
    }

    const eventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const seatCount = Math.max(1, Number(bookingRow.seats || 1))

    // Door payments charge the booking's real composition at FULL per-type price
    // — the online discount never applies at the venue. Legacy bookings without
    // line items fall back to the event's full ticket price × seats.
    let doorItems: BookingItemWithBasePrice[] = []
    if (parsed.data.method !== 'comp') {
      try {
        doorItems = await loadBookingItemsWithBasePrices(supabase, parsed.data.bookingId)
      } catch (itemsError) {
        logger.warn('Failed to load booking items for door charge; falling back to event price', {
          metadata: {
            bookingId: parsed.data.bookingId,
            error: itemsError instanceof Error ? itemsError.message : String(itemsError),
          },
        })
      }
    }
    const expectedAmount = parsed.data.method === 'comp'
      ? 0
      : resolveDoorChargeAmount({
        items: doorItems,
        eventFullUnitPrice: resolveEventTicketPriceAmount(eventRecord as unknown as Event),
        seats: seatCount
      })

    const { data: confirmRaw, error: confirmError } = await supabase.rpc(
      'confirm_event_manual_payment_v01',
      {
        p_event_booking_id: parsed.data.bookingId,
        p_payment_method: parsed.data.method,
        p_amount: expectedAmount,
        p_currency: 'GBP',
        p_performed_by: user.id,
        p_note: parsed.data.note || null
      }
    )

    if (confirmError) {
      return { error: confirmError.message || 'Failed to confirm manual payment.' }
    }

    const confirm = (confirmRaw || {}) as Record<string, unknown>
    const state = typeof confirm.state === 'string' ? confirm.state : 'blocked'
    const reason = typeof confirm.reason === 'string' ? confirm.reason : null
    const paymentId = typeof confirm.payment_id === 'string' ? confirm.payment_id : null
    const typedState: 'confirmed' | 'already_confirmed' | 'manual_review' | 'blocked' =
      state === 'confirmed' ||
      state === 'already_confirmed' ||
      state === 'manual_review'
        ? state
        : 'blocked'

    if (state === 'blocked') {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: reason || 'confirmation_blocked',
          booking_id: parsed.data.bookingId,
          payment_id: paymentId,
          sms_sent: false
        }
      }
    }

    let smsSent = false
    let smsMeta: SmsSafetyMeta = null
    if (parsed.data.sendSms !== false && (state === 'confirmed' || state === 'already_confirmed')) {
      const smsResult = await sendEventPaymentConfirmationSms(supabase, {
        bookingId: parsed.data.bookingId,
        eventName: typeof confirm.event_name === 'string' ? confirm.event_name : 'your event',
        seats: typeof confirm.seats === 'number' ? confirm.seats : seatCount,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      })
      smsSent = smsResult.success === true || smsResult.logFailure === true
      smsMeta = smsResult
    } else if (state === 'manual_review') {
      const smsResult = await sendEventPaymentManualReviewSms(supabase, { bookingId: parsed.data.bookingId })
      smsSent = smsResult.success === true || smsResult.logFailure === true
      smsMeta = smsResult
    }

    if (state === 'confirmed' || state === 'already_confirmed') {
      await sendEventPaymentConfirmationEmail(supabase, {
        bookingId: parsed.data.bookingId,
        amount: expectedAmount,
        currency: 'GBP',
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      })
    } else if (state === 'manual_review') {
      await sendEventPaymentManualReviewEmail(supabase, {
        bookingId: parsed.data.bookingId,
        amount: expectedAmount,
        currency: 'GBP'
      })
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'mark_event_booking_paid',
      resource_type: 'event_booking',
      resource_id: parsed.data.bookingId,
      operation_status: 'success',
      additional_info: {
        event_id: bookingRow.event_id,
        method: parsed.data.method,
        amount: expectedAmount,
        state,
        reason
      }
    })

    if (bookingRow.event_id) {
      await syncPubOpsEventCalendarByEventId(supabase, bookingRow.event_id, {
        bookingId: parsed.data.bookingId,
        context: 'admin_event_booking_marked_paid',
      })
      revalidatePath(`/events/${bookingRow.event_id}`)
    }
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')
    revalidateTag('dashboard')

    return {
      success: true,
      data: {
        state: typedState,
        reason,
        booking_id: parsed.data.bookingId,
        payment_id: paymentId,
        sms_sent: smsSent
      },
      meta: { sms: smsMeta }
    }
  } catch (error) {
    logger.error('Unexpected markEventBookingPaidManually error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to mark booking paid.') }
  }
}

async function sendEventTransferSms(input: {
  supabase: ReturnType<typeof createAdminClient>
  bookingId: string
  customerId: string
  fromEventName: string
  toEventName: string
  eventStartIso?: string | null
  appBaseUrl?: string
  /** Amount the customer overpaid vs the new event; mentioned calmly when > 0. */
  overpayment?: number
}): Promise<RequiredSmsSafetyMeta> {
  const { data: customer, error: customerError } = await input.supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', input.customerId)
    .maybeSingle()

  if (customerError || !customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return { success: false, code: customerError ? 'safety_unavailable' : null, logFailure: false }
  }

  let manageLink: string | null = null
  try {
    const token = await createEventManageToken(input.supabase, {
      customerId: input.customerId,
      bookingId: input.bookingId,
      eventStartIso: input.eventStartIso,
      appBaseUrl: input.appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    })
    manageLink = token.url
  } catch {
    manageLink = null
  }

  const firstName = getSmartFirstName(customer.first_name)
  const overpaymentPart =
    typeof input.overpayment === 'number' && input.overpayment > 0
      ? ` We owe you £${input.overpayment.toFixed(2)} — we'll be in touch about your refund.`
      : ''
  const body = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, your tickets have been transferred from ${input.fromEventName} to ${input.toEventName}.${overpaymentPart}${manageLink ? ` Manage booking: ${manageLink}` : ''}`,
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  )

  try {
    const smsResult = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: {
        event_booking_id: input.bookingId,
        template_key: 'event_ticket_transferred'
      }
    })
    const code = typeof smsResult.code === 'string' ? smsResult.code : null
    const logFailure = smsResult.logFailure === true || code === 'logging_failed'
    return { success: smsResult.success === true, code, logFailure }
  } catch (smsError) {
    logger.warn('Event transfer SMS send failed', {
      metadata: {
        bookingId: input.bookingId,
        customerId: input.customerId,
        error: smsError instanceof Error ? smsError.message : String(smsError)
      }
    })
    return { success: false, code: 'unexpected_exception', logFailure: false }
  }
}

/**
 * Copy a multi-type booking's ticket-line composition onto its transfer
 * replacement by matching ticket-type names on the target event. Preserves the
 * original unit-price snapshots (they are what the customer actually paid) and
 * per-line attendee names. Best-effort: when the target has no matching types,
 * the replacement keeps its default line and we report `copied: false`.
 */
async function copyTransferComposition(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    originalItems: BookingItemWithTypeRow[]
    newBookingId: string
    targetEventId: string
  }
): Promise<{ copied: boolean; reason: string | null }> {
  if (input.originalItems.length === 0) {
    return { copied: false, reason: 'no_original_items' }
  }

  const { data: targetTypes, error: targetTypesError } = await supabase
    .from('event_ticket_types')
    .select('id, name')
    .eq('event_id', input.targetEventId)
    .eq('is_active', true)

  if (targetTypesError) {
    return { copied: false, reason: targetTypesError.message || 'target_types_unavailable' }
  }

  const typeIdByName = new Map(
    ((targetTypes ?? []) as Array<{ id: string; name: string | null }>)
      .filter((row) => typeof row.name === 'string' && row.name.trim())
      .map((row) => [String(row.name).trim().toLowerCase(), row.id])
  )

  const mappedLines = input.originalItems.map((item) => ({
    targetTypeId: typeIdByName.get(item.ticket_type_name.trim().toLowerCase()) ?? null,
    quantity: Math.max(1, Number(item.quantity) || 1),
    unitPrice: Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : 0,
    attendeeNames: item.attendee_names ?? null
  }))

  if (mappedLines.some((line) => !line.targetTypeId)) {
    return { copied: false, reason: 'ticket_types_not_matched_on_target' }
  }

  const { error: deleteError } = await supabase
    .from('booking_items')
    .delete()
    .eq('booking_id', input.newBookingId)

  if (deleteError) {
    return { copied: false, reason: deleteError.message || 'existing_items_delete_failed' }
  }

  const { error: insertError } = await supabase
    .from('booking_items')
    .insert(mappedLines.map((line) => ({
      booking_id: input.newBookingId,
      ticket_type_id: line.targetTypeId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      attendee_names: line.attendeeNames
    })))

  if (insertError) {
    return { copied: false, reason: insertError.message || 'items_insert_failed' }
  }

  return { copied: true, reason: null }
}

const transferEventBookingSchema = z.object({
  bookingId: z.string().uuid(),
  targetEventId: z.string().uuid(),
  sendSms: z.boolean().optional().default(true)
})

type TransferEventBookingResult =
  | { error: string }
  | {
      success: true
      data: {
        state: 'transferred' | 'blocked'
        reason: string | null
        original_booking_id: string
        new_booking_id: string | null
        sms_sent: boolean
      }
      meta?: { sms: SmsSafetyMeta }
    }

export async function transferEventBooking(input: {
  bookingId: string
  targetEventId: string
  sendSms?: boolean
}): Promise<TransferEventBookingResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to transfer event bookings.' }
    }

    const parsed = transferEventBookingSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid transfer details.' }
    }

    if (parsed.data.bookingId === parsed.data.targetEventId) {
      return { error: 'Choose a different event.' }
    }

    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        id,
        event_id,
        customer_id,
        seats,
        status,
        event_seating_type,
        attendee_names,
        customer:customers(id, first_name, mobile_number, sms_status),
        event:events(id, name, payment_mode, price, price_per_seat, online_discount_type, online_discount_value, is_free)
      `)
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }

    if (bookingRow.status !== 'confirmed') {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: 'booking_not_confirmed',
          original_booking_id: parsed.data.bookingId,
          new_booking_id: null,
          sms_sent: false
        }
      }
    }

    if (bookingRow.event_id === parsed.data.targetEventId) {
      return { error: 'Choose a different event.' }
    }

    const { data: existingTransfer, error: existingTransferError } = await (supabase.from('event_ticket_transfers') as any)
      .select('id')
      .eq('original_booking_id', parsed.data.bookingId)
      .in('status', ['pending', 'completed'])
      .maybeSingle()

    if (existingTransferError) {
      throw existingTransferError
    }

    if (existingTransfer) {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: 'transfer_already_used',
          original_booking_id: parsed.data.bookingId,
          new_booking_id: null,
          sms_sent: false
        }
      }
    }

    const { data: targetEvent, error: targetEventError } = await supabase
      .from('events')
      .select('id, name, booking_mode, payment_mode, price, price_per_seat, online_discount_type, online_discount_value, is_free, event_status, start_datetime, date, time')
      .eq('id', parsed.data.targetEventId)
      .maybeSingle()

    if (targetEventError || !targetEvent) {
      return { error: 'Target event not found.' }
    }

    if (['cancelled', 'draft'].includes(String(targetEvent.event_status || ''))) {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: 'target_event_not_bookable',
          original_booking_id: parsed.data.bookingId,
          new_booking_id: null,
          sms_sent: false
        }
      }
    }

    const customerRecord = Array.isArray(bookingRow.customer) ? bookingRow.customer[0] : bookingRow.customer
    const fromEvent = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const seats = Math.max(1, Number(bookingRow.seats || 1))
    const originalAttendeeNames = Array.isArray(bookingRow.attendee_names)
      ? (bookingRow.attendee_names as string[]).filter((name) => typeof name === 'string' && name.trim())
      : []

    // Snapshot the original ticket-line composition so per-type door lists and
    // name lists survive the transfer (best-effort — see copyTransferComposition).
    let originalItems: BookingItemWithTypeRow[] = []
    let originalItemsMultiType = false
    try {
      const itemsMap = await loadBookingItemsWithTypes(supabase, [parsed.data.bookingId])
      originalItems = itemsMap.get(parsed.data.bookingId) ?? []
      if (originalItems.length > 0 && bookingRow.event_id) {
        const originalDefaultTypeId = await getDefaultTicketTypeId(supabase, bookingRow.event_id)
        originalItemsMultiType = bookingItemsAreMultiType(originalItems, originalDefaultTypeId)
      }
    } catch (itemsError) {
      logger.warn('Failed to load original booking items for transfer', {
        metadata: {
          bookingId: parsed.data.bookingId,
          error: itemsError instanceof Error ? itemsError.message : String(itemsError),
        },
      })
    }

    const { data: paymentRows, error: paymentsError } = await supabase
      .from('payments')
      .select('id, amount, charge_type, status')
      .eq('event_booking_id', parsed.data.bookingId)
      .in('charge_type', ['prepaid_event', 'seat_increase'])
      .in('status', ['succeeded', 'partially_refunded'])

    if (paymentsError) {
      throw paymentsError
    }

    const paidTotal = (paymentRows || []).reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0)
    const targetAmount = toMoney(resolveEventPriceAmount(targetEvent as unknown as Event) * seats)
    // Money the customer has paid beyond what the new event costs — owed back.
    const targetChargeable = targetEvent.payment_mode === 'prepaid' ? targetAmount : 0
    const overpayment = toMoney(Math.max(0, paidTotal - targetChargeable))

    if (targetEvent.payment_mode === 'prepaid' && paidTotal + 0.004 < targetAmount) {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: 'target_event_costs_more',
          original_booking_id: parsed.data.bookingId,
          new_booking_id: null,
          sms_sent: false
        }
      }
    }

    const bookingMode = EventBookingService.normalizeBookingMode(targetEvent.booking_mode)
    const createResult = await EventBookingService.createBooking({
      eventId: parsed.data.targetEventId,
      customerId: bookingRow.customer_id,
      normalizedPhone: customerRecord?.mobile_number || '',
      seats,
      source: 'admin',
      bookingMode,
      seatingPreference: bookingRow.event_seating_type === 'standing' ? 'standing' : 'seated',
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      shouldSendSms: false,
      supabaseClient: supabase,
      logTag: 'admin event transfer',
      firstName: customerRecord?.first_name || undefined
    })

    if (createResult.rpcFailed || createResult.rollbackFailed || createResult.paymentLinkFailed) {
      return { error: 'Could not create the replacement booking.' }
    }

    if (!createResult.bookingId || !['confirmed', 'pending_payment'].includes(createResult.resolvedState)) {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: createResult.resolvedReason || 'target_event_unavailable',
          original_booking_id: parsed.data.bookingId,
          new_booking_id: null,
          sms_sent: false
        }
      }
    }

    if (createResult.resolvedState === 'pending_payment') {
      const { data: confirmRaw, error: confirmError } = await supabase.rpc(
        'confirm_event_manual_payment_v01',
        {
          p_event_booking_id: createResult.bookingId,
          p_payment_method: 'comp',
          p_amount: 0,
          p_currency: 'GBP',
          p_performed_by: user.id,
          p_note: `Transfer credit from booking ${parsed.data.bookingId}`
        }
      )

      if (confirmError) {
        return { error: confirmError.message || 'Could not confirm replacement booking.' }
      }

      const state = typeof (confirmRaw as any)?.state === 'string' ? (confirmRaw as any).state : 'blocked'
      if (state !== 'confirmed' && state !== 'already_confirmed') {
        return {
          success: true,
          data: {
            state: 'blocked',
            reason: typeof (confirmRaw as any)?.reason === 'string' ? (confirmRaw as any).reason : 'replacement_confirmation_failed',
            original_booking_id: parsed.data.bookingId,
            new_booking_id: createResult.bookingId,
            sms_sent: false
          }
        }
      }
    }

    // Carry the composition + attendee names over to the replacement booking so
    // door lists and per-type breakdowns stay correct.
    let compositionCopied: boolean | null = null
    let compositionCopyReason: string | null = null
    if (originalItemsMultiType) {
      const copyResult = await copyTransferComposition(supabase, {
        originalItems,
        newBookingId: createResult.bookingId,
        targetEventId: parsed.data.targetEventId
      })
      compositionCopied = copyResult.copied
      compositionCopyReason = copyResult.reason
      if (!copyResult.copied) {
        logger.warn('Transfer could not copy ticket-line composition to the new booking', {
          metadata: {
            bookingId: parsed.data.bookingId,
            newBookingId: createResult.bookingId,
            reason: copyResult.reason,
          },
        })
      }
    }

    if (originalAttendeeNames.length > 0) {
      const { error: attendeeCopyError } = await supabase
        .from('bookings')
        .update({ attendee_names: originalAttendeeNames })
        .eq('id', createResult.bookingId)

      if (attendeeCopyError) {
        logger.warn('Transfer could not copy attendee names to the new booking', {
          metadata: {
            bookingId: parsed.data.bookingId,
            newBookingId: createResult.bookingId,
            error: attendeeCopyError.message,
          },
        })
      }
    }

    const nowIso = new Date().toISOString()

    // Capture exactly which payment rows are moved so a failed step can move
    // them back — without touching rows created on the new booking (e.g. the £0
    // comp confirmation above).
    const { data: paymentsToMove, error: paymentsToMoveError } = await supabase
      .from('payments')
      .select('id')
      .eq('event_booking_id', parsed.data.bookingId)
      .in('charge_type', ['prepaid_event', 'seat_increase', 'refund'])

    if (paymentsToMoveError) {
      throw paymentsToMoveError
    }

    const movedPaymentIds = ((paymentsToMove ?? []) as Array<{ id: string }>).map((row) => row.id)

    if (movedPaymentIds.length > 0) {
      const { error: movePaymentsError } = await supabase
        .from('payments')
        .update({
          event_booking_id: createResult.bookingId,
          updated_at: nowIso
        })
        .in('id', movedPaymentIds)

      if (movePaymentsError) {
        throw movePaymentsError
      }
    }

    const { error: cancelOriginalError } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'admin_transfer',
        updated_at: nowIso
      })
      .eq('id', parsed.data.bookingId)

    if (cancelOriginalError) {
      // Compensate: put the payments back on the original and withdraw the
      // replacement so the customer never holds two live bookings.
      logger.error('Transfer failed to cancel the original booking; compensating', {
        error: new Error(cancelOriginalError.message || 'cancel_original_failed'),
        metadata: {
          bookingId: parsed.data.bookingId,
          newBookingId: createResult.bookingId,
        },
      })

      const compensationErrors: string[] = []

      if (movedPaymentIds.length > 0) {
        const { error: restorePaymentsError } = await supabase
          .from('payments')
          .update({
            event_booking_id: parsed.data.bookingId,
            updated_at: new Date().toISOString()
          })
          .in('id', movedPaymentIds)

        if (restorePaymentsError) {
          compensationErrors.push(`restore_payments: ${restorePaymentsError.message}`)
        }
      }

      const [revertNewBookingResult, releaseNewHoldsResult, cancelNewTablesResult] = await Promise.all([
        supabase.from('bookings')
          .update({
            status: 'cancelled',
            cancelled_at: nowIso,
            cancelled_by: 'system',
            updated_at: nowIso
          })
          .eq('id', createResult.bookingId),
        supabase.from('booking_holds')
          .update({ status: 'released', released_at: nowIso, updated_at: nowIso })
          .eq('event_booking_id', createResult.bookingId)
          .eq('status', 'active'),
        supabase.from('table_bookings')
          .update({
            status: 'cancelled',
            cancellation_reason: 'event_booking_transfer_reverted',
            cancelled_at: nowIso,
            updated_at: nowIso
          })
          .eq('event_booking_id', createResult.bookingId)
          .not('status', 'in', '(cancelled,no_show)')
      ])

      if (revertNewBookingResult.error) {
        compensationErrors.push(`revert_new_booking: ${revertNewBookingResult.error.message}`)
      }
      if (releaseNewHoldsResult.error) {
        compensationErrors.push(`release_new_holds: ${releaseNewHoldsResult.error.message}`)
      }
      if (cancelNewTablesResult.error) {
        compensationErrors.push(`cancel_new_tables: ${cancelNewTablesResult.error.message}`)
      }

      if (compensationErrors.length > 0) {
        logger.error('Transfer compensation incomplete', {
          metadata: {
            bookingId: parsed.data.bookingId,
            newBookingId: createResult.bookingId,
            compensationErrors,
          },
        })
        return {
          error:
            'The transfer failed part-way and could not be fully reverted. Please contact engineering before retrying.'
        }
      }

      return {
        error:
          'The original booking could not be cancelled, so the transfer was reverted. Nothing has changed — please try again.'
      }
    }

    const [releaseHoldsResult, cancelTablesResult] = await Promise.all([
      supabase.from('booking_holds')
        .update({ status: 'released', released_at: nowIso, updated_at: nowIso })
        .eq('event_booking_id', parsed.data.bookingId)
        .eq('status', 'active'),
      supabase.from('table_bookings')
        .update({
          status: 'cancelled',
          cancellation_reason: 'event_booking_transferred',
          cancelled_at: nowIso,
          updated_at: nowIso
        })
        .eq('event_booking_id', parsed.data.bookingId)
        .not('status', 'in', '(cancelled,no_show)')
    ])

    if (releaseHoldsResult.error) {
      throw releaseHoldsResult.error
    }
    if (cancelTablesResult.error) {
      throw cancelTablesResult.error
    }

    const { error: transferInsertError } = await (supabase.from('event_ticket_transfers') as any)
      .insert({
        original_booking_id: parsed.data.bookingId,
        new_booking_id: createResult.bookingId,
        from_event_id: bookingRow.event_id,
        to_event_id: parsed.data.targetEventId,
        status: 'completed',
        requested_by: 'staff',
        approved_by: user.id,
        metadata: {
          seats,
          paid_total: paidTotal,
          target_amount: targetAmount,
          overpayment,
          composition_copied: compositionCopied,
          composition_copy_reason: compositionCopyReason,
          attendee_names_copied: originalAttendeeNames.length > 0
        },
        completed_at: nowIso
      })

    if (transferInsertError) {
      throw transferInsertError
    }

    let smsSent = false
    let smsMeta: SmsSafetyMeta = null
    if (parsed.data.sendSms !== false) {
      const transferSmsMeta = await sendEventTransferSms({
        supabase,
        bookingId: createResult.bookingId,
        customerId: bookingRow.customer_id,
        fromEventName: fromEvent?.name || 'your original event',
        toEventName: targetEvent.name || 'your new event',
        eventStartIso: targetEvent.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        overpayment
      })
      smsMeta = transferSmsMeta
      smsSent = transferSmsMeta.success === true || transferSmsMeta.logFailure === true
    }

    await sendEventTicketTransferredEmail(supabase, {
      bookingId: createResult.bookingId,
      fromEventName: fromEvent?.name || 'your original event',
      toEventName: targetEvent.name || 'your new event',
      eventStartIso: targetEvent.start_datetime || null,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      overpayment
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'transfer_event_booking',
      resource_type: 'event_booking',
      resource_id: parsed.data.bookingId,
      operation_status: 'success',
      additional_info: {
        new_booking_id: createResult.bookingId,
        from_event_id: bookingRow.event_id,
        to_event_id: parsed.data.targetEventId,
        paid_total: paidTotal,
        target_amount: targetAmount,
        overpayment,
        composition_copied: compositionCopied,
        composition_copy_reason: compositionCopyReason
      }
    })

    await Promise.allSettled([
      syncPubOpsEventCalendarByEventId(supabase, bookingRow.event_id, {
        bookingId: parsed.data.bookingId,
        context: 'admin_event_booking_transferred_from',
      }),
      syncPubOpsEventCalendarByEventId(supabase, parsed.data.targetEventId, {
        bookingId: createResult.bookingId,
        context: 'admin_event_booking_transferred_to',
      })
    ])

    revalidatePath(`/events/${bookingRow.event_id}`)
    revalidatePath(`/events/${parsed.data.targetEventId}`)
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')
    revalidateTag('dashboard')

    return {
      success: true,
      data: {
        state: 'transferred',
        reason: null,
        original_booking_id: parsed.data.bookingId,
        new_booking_id: createResult.bookingId,
        sms_sent: smsSent
      },
      meta: { sms: smsMeta }
    }
  } catch (error) {
    logger.error('Unexpected transferEventBooking error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to transfer booking.') }
  }
}
