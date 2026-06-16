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
import {
  sendEventBookingSeatUpdateSms,
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms
} from '@/lib/events/event-payments'
import { sendEventPaymentConfirmationEmail } from '@/lib/email/event-ticket-emails'
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
import { normalizeEventPricingFields, resolveEventPriceAmount } from '@/lib/events/pricing'
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
  paid_amount?: number | null
  payment_status_summary?: string | null
  payment_method_summary?: string | null
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
    highlights: rawData.highlights ? JSON.parse(rawData.highlights as string) : categoryDefaults.highlights || [],
    keywords: rawData.keywords ? JSON.parse(rawData.keywords as string) : [],
    primary_keywords: rawData.primary_keywords ? JSON.parse(rawData.primary_keywords as string) : categoryDefaults.primary_keywords || [],
    secondary_keywords: rawData.secondary_keywords ? JSON.parse(rawData.secondary_keywords as string) : categoryDefaults.secondary_keywords || [],
    local_seo_keywords: rawData.local_seo_keywords ? JSON.parse(rawData.local_seo_keywords as string) : categoryDefaults.local_seo_keywords || [],
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
    highlight_video_urls: rawData.highlight_video_urls ? JSON.parse(rawData.highlight_video_urls as string) : categoryDefaults.highlight_video_urls || [],
    gallery_image_urls: rawData.gallery_image_urls ? JSON.parse(rawData.gallery_image_urls as string) : categoryDefaults.gallery_image_urls || [],
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
    try {
      const parsed = JSON.parse(faqsJson);
      if (Array.isArray(parsed)) {
        data.faqs = parsed.filter((faq: EventFaqInput) => faq.question && faq.answer);
      }
    } catch (e) {
      logger.warn('Failed to parse FAQs from event form data', {
        metadata: {
          error: e instanceof Error ? e.message : String(e),
        },
      })
    }
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

export async function getEventFAQs(eventId: string): Promise<{ data?: EventFAQ[], error?: string }> {
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
      .select('id, customer_id, event_id, seats, event_seating_type, is_reminder_only, notes, created_at, status, source, hold_expires_at, customer:customers(id, first_name, last_name, mobile_number, email)')
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
      .select('event_booking_id, amount, status, payment_method, payment_provider')
      .in('event_booking_id', bookingIds)

    if (paymentsError) throw paymentsError

    type PaymentRow = {
      event_booking_id: string | null
      amount: number | null
      status: string | null
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

    const paidStatuses = new Set(['succeeded', 'paid', 'partially_refunded', 'refunded'])
    const withPayments = bookings.map((booking) => {
      const payments = paymentsByBooking.get(booking.id) ?? []
      const paidRows = payments.filter((payment) => paidStatuses.has(String(payment.status || '').toLowerCase()))
      const paidAmount = paidRows.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0)
      const statuses = new Set(payments.map((payment) => String(payment.status || '').toLowerCase()).filter(Boolean))
      const methods = new Set(payments.map((payment) => String(payment.payment_method || payment.payment_provider || '').toLowerCase()).filter(Boolean))
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
  lastName: z.string().trim().max(80).optional()
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
      firstName: customerResolution.resolvedFirstName || parsed.data.firstName
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
          source: 'admin'
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
  sendSms: z.boolean().optional().default(true)
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
      .select('id, event_id')
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow?.id) {
      return { error: 'Booking not found.' }
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

export async function cancelEventManualBooking(input: {
  bookingId: string
  sendSms?: boolean
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

      if (
        followupFailures.length === 1 &&
        followupFailures[0] === 'booking_holds_release'
      ) {
        return {
          error:
            'Booking cancelled but failed to release booking holds. Please refresh and contact engineering.'
        }
      }

      if (
        followupFailures.length === 1 &&
        followupFailures[0] === 'table_bookings_cancel'
      ) {
        return {
          error:
            'Booking cancelled but failed to cancel linked table bookings. Please refresh and contact engineering.'
        }
      }

      return {
        error:
          'Booking cancelled but follow-up updates failed. Please refresh and contact engineering.'
      }
    }

    const eventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const customerRecord = Array.isArray(bookingRow.customer) ? bookingRow.customer[0] : bookingRow.customer
    let refundStatus: EventRefundResult['status'] = 'none'
    let refundAmount = 0

    if (
      bookingStatus === 'confirmed' &&
      bookingRow.is_reminder_only !== true &&
      bookingRow.customer_id &&
      bookingRow.event_id &&
      eventRecord &&
      (eventRecord as any).payment_mode === 'prepaid'
    ) {
      const eventStartIso =
        (eventRecord as any).start_datetime ||
        ((eventRecord as any).date ? `${(eventRecord as any).date}T${((eventRecord as any).time || '00:00').slice(0, 5)}:00` : null)
      const policy = eventStartIso
        ? getEventRefundPolicy(eventStartIso)
        : { refundRate: 0, policyBand: 'none' as const }
      const seatCount = Math.max(1, Number(bookingRow.seats || 1))
      const pricePerSeat = resolveEventPriceAmount(eventRecord as unknown as Event)
      const candidateRefundAmount = toMoney(seatCount * pricePerSeat * policy.refundRate)

      if (candidateRefundAmount > 0) {
        try {
          const refundResult = await processEventRefund(supabase, {
            bookingId: bookingRow.id,
            customerId: bookingRow.customer_id,
            eventId: bookingRow.event_id,
            amount: candidateRefundAmount,
            reason: `staff_cancel_${policy.policyBand}`,
            metadata: {
              cancelled_by: 'admin',
              policy_band: policy.policyBand,
              seats: seatCount
            }
          })
          refundStatus = refundResult.status
          refundAmount = refundResult.amount
        } catch (refundError) {
          refundStatus = 'manual_required'
          refundAmount = candidateRefundAmount
          logger.error('Failed to process event refund during staff cancellation', {
            error: refundError instanceof Error ? refundError : new Error(String(refundError)),
            metadata: {
              bookingId: bookingRow.id,
              customerId: bookingRow.customer_id,
              eventId: bookingRow.event_id,
              refundAmount: candidateRefundAmount
            }
          })
        }
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
        refund_amount: refundAmount
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
    const expectedAmount = parsed.data.method === 'comp'
      ? 0
      : toMoney(resolveEventPriceAmount(eventRecord as unknown as Event) * seatCount)

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
  const body = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, your tickets have been transferred from ${input.fromEventName} to ${input.toEventName}.${manageLink ? ` Manage booking: ${manageLink}` : ''}`,
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

    const nowIso = new Date().toISOString()

    const { error: movePaymentsError } = await supabase
      .from('payments')
      .update({
        event_booking_id: createResult.bookingId,
        updated_at: nowIso
      })
      .eq('event_booking_id', parsed.data.bookingId)
      .in('charge_type', ['prepaid_event', 'seat_increase', 'refund'])

    if (movePaymentsError) {
      throw movePaymentsError
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
      throw cancelOriginalError
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
          target_amount: targetAmount
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
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      })
      smsMeta = transferSmsMeta
      smsSent = transferSmsMeta.success === true || transferSmsMeta.logFailure === true
    }

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
        target_amount: targetAmount
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
