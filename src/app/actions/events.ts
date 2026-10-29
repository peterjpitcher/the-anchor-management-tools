'use server'

import { buildStaffCancellationRefundNote } from '@/lib/events/staff-cancellation-refund-note'
import { isSundayLunchOnlyEvent, SUNDAY_LUNCH_ONLY_EVENT_MESSAGE } from '@/lib/events/sunday-lunch-only-policy'
import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { logAuditEvent } from './audit'
import type { Event, EventFAQ } from '@/types/database'
import { checkUserPermission } from '@/app/actions/rbac'
import { EventService, eventSchema, CreateEventInput, UpdateEventInput } from '@/services/events'
import { EventBookingService } from '@/services/event-bookings'
import { createClient } from '@/lib/supabase/server' // Required for getting user in action
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { getTodayIsoDate, londonLocalInputToUtcIso } from '@/lib/dateUtils'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { recordStaffReadOutConsent } from '@/lib/consent/staff-capture'
import {
  createEventManageToken,
  getEventRefundPolicy,
  processEventRefund,
  recordManualEventRefund,
  updateEventBookingSeatsById,
  type EventManualRefundMethod,
  type EventRefundResult
} from '@/lib/events/manage-booking'
import {
  alertEventRefundRequest,
  describeEventRefundRequestKind,
  loadOpenEventRefundRequests,
  resolveEventRefundRequestRow,
  type EventRefundRequest,
  type EventRefundRequestKind
} from '@/lib/events/refund-requests'
import { canIssueEventRefund } from '@/lib/events/refund-permissions'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import { notifyEventPaymentOutcome } from '@/lib/events/event-payment-notify'
import {
  sendEventBookingCancelledEmail,
  sendEventBookingTicketsChangedEmail,
  sendEventTicketTransferredEmail,
  type EventTicketsChange,
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
import { resolveEventStartIso, type EventWhenSource } from '@/lib/events/event-when'
import { buildEventBookingCancelledText, formatEventTextWhen } from '@/lib/events/event-guest-texts'
import { sendEventMessageEmailFirst, type EventTextAttempt } from '@/lib/events/event-guest-notify'
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
import {
  INVALID_GUEST_PHONE_MESSAGE,
  normaliseAttendeePhones,
  staffEventAttendeesInputSchema,
  type BookingQuestion,
  type StaffEventAttendeeInput
} from '@/lib/events/booking-questions'
import { prepareStaffEventBooking } from '@/lib/events/staff-booking-guest-details'
import type { StoredEventAttendee } from '@/lib/events/booking-questions'
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
  attendees?: StoredEventAttendee[]
  attendee_names?: string[] | null
  paid_amount?: number | null
  payment_status_summary?: string | null
  payment_method_summary?: string | null
  /** Compact per-type summary (e.g. "1× Regular, 1× Non-Alcohol"); null for single-type bookings. */
  ticket_breakdown?: string | null
  /** Sum of the booking's line items (post-discount snapshots); null when it has none. */
  charge_total?: number | null
  /** The guest's check-in for this event, from the door or the staff list (BK-130); null when none. */
  check_in?: { id: string; check_in_method: string | null } | null
  /** The email typed for this booking when the customer record holds a different one (BK-078). */
  contact_email?: string | null
  /** Refunds waiting for a manager after staff changed the booking (owner decision D7). */
  refund_requests?: Array<{ id: string; kind: EventRefundRequestKind; amount: number; label: string }>
  customer?: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    email: string | null
  } | null
}

type CreateEventResult = { error: string; fieldErrors?: Record<string, string> } | { success: true; data: Event; warning?: string }
function eventValidationFailure(error: z.ZodError): { error: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {}
  const messages = error.errors.map(issue => {
    const field = (issue.path ?? []).join('.')
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message
    const label = field.replace(/_/g, ' ')
    return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${issue.message}` : issue.message
  })
  return { error: messages.join('; '), fieldErrors }
}

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
        default_capacity,
        default_price,
        default_is_free,
        default_booking_mode,
        default_payment_mode,
        short_description,
        long_description,
        highlights,
        primary_keywords,
        secondary_keywords,
        local_seo_keywords,
        keywords,
        image_alt_text,
        cancellation_policy,
        accessibility_notes,
        meta_title,
        meta_description,
        default_image_url,
        poster_image_url,
        thumbnail_image_url,
        promo_video_url,
        highlight_video_urls,
        gallery_image_urls,
        default_performer_type,
        default_performer_name,
        default_event_status,
        default_booking_url,
        default_promo_sms_enabled,
        default_bookings_enabled,
        faqs
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
        capacity: category.default_capacity,
        price: category.default_price,
        is_free: category.default_is_free,
        booking_mode: category.default_booking_mode,
        payment_mode: category.default_payment_mode,
        short_description: category.short_description,
        long_description: category.long_description,
        highlights: category.highlights,
        primary_keywords: category.primary_keywords,
        secondary_keywords: category.secondary_keywords,
        local_seo_keywords: category.local_seo_keywords,
        keywords: category.keywords,
        image_alt_text: category.image_alt_text,
        cancellation_policy: category.cancellation_policy,
        accessibility_notes: category.accessibility_notes,
        meta_title: category.meta_title,
        meta_description: category.meta_description,
        hero_image_url: category.default_image_url,
        poster_image_url: category.poster_image_url || category.default_image_url,
        thumbnail_image_url: category.thumbnail_image_url || category.default_image_url,
        promo_video_url: category.promo_video_url,
        highlight_video_urls: category.highlight_video_urls,
        gallery_image_urls: category.gallery_image_urls,
        performer_type: category.default_performer_type,
        performer_name: category.default_performer_name,
        event_status: category.default_event_status || 'scheduled',
        booking_url: category.default_booking_url,
        promo_sms_enabled: category.default_promo_sms_enabled,
        bookings_enabled: category.default_bookings_enabled,
        faqs: Array.isArray(category.faqs) ? category.faqs : []
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
      : categoryDefaults.booking_mode || 'table'

  // Handle specific fields from form data
  const data: Partial<CreateEventInput> = {
    name: rawData.name as string,
    date: rawData.date as string,
    time: rawData.time as string || categoryDefaults.time,
    ...(rawData.capacity !== undefined && rawData.capacity !== null
      ? { capacity: rawData.capacity === '' ? null : Number(rawData.capacity) }
      : !_existingEventId && bookingMode === 'general' && categoryDefaults.capacity
        ? { capacity: categoryDefaults.capacity }
      : {}),
    ...(rawData.seated_capacity !== undefined && rawData.seated_capacity !== null
      ? { seated_capacity: rawData.seated_capacity === '' ? null : Number(rawData.seated_capacity) || null }
      : {}),
    ...(rawData.standing_capacity !== undefined && rawData.standing_capacity !== null
      ? { standing_capacity: rawData.standing_capacity === '' ? null : Number(rawData.standing_capacity) }
      : {}),
    ...(rawData.payment_mode && ['free', 'cash_only', 'prepaid'].includes(rawData.payment_mode as string)
      ? { payment_mode: rawData.payment_mode as 'free' | 'cash_only' | 'prepaid' }
      : categoryDefaults.payment_mode
        ? { payment_mode: categoryDefaults.payment_mode }
        : {}),
    booking_mode: bookingMode,
    event_type: categorySlug,
    category_id: categoryId,
    short_description: rawData.short_description as string || categoryDefaults.short_description || null,
    long_description: rawData.long_description as string || categoryDefaults.long_description || null,
    brief: (rawData.brief as string)?.trim() || null,
    highlights: parseJsonFormField(rawData.highlights, stringArrayFormFieldSchema, categoryDefaults.highlights || [], 'highlights'),
    keywords: parseJsonFormField(rawData.keywords, stringArrayFormFieldSchema, categoryDefaults.keywords || [], 'keywords'),
    primary_keywords: parseJsonFormField(rawData.primary_keywords, stringArrayFormFieldSchema, categoryDefaults.primary_keywords || [], 'primary_keywords'),
    secondary_keywords: parseJsonFormField(rawData.secondary_keywords, stringArrayFormFieldSchema, categoryDefaults.secondary_keywords || [], 'secondary_keywords'),
    local_seo_keywords: parseJsonFormField(rawData.local_seo_keywords, stringArrayFormFieldSchema, categoryDefaults.local_seo_keywords || [], 'local_seo_keywords'),
    image_alt_text: rawData.image_alt_text as string || categoryDefaults.image_alt_text || null,
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
    performer_name: rawData.performer_name as string || categoryDefaults.performer_name || null,
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
    thumbnail_image_url: rawData.thumbnail_image_url as string || categoryDefaults.thumbnail_image_url || null,
    poster_image_url: rawData.poster_image_url as string || categoryDefaults.poster_image_url || null,
    promo_video_url: rawData.promo_video_url as string || categoryDefaults.promo_video_url || null,
    highlight_video_urls: parseJsonFormField(rawData.highlight_video_urls, stringArrayFormFieldSchema, categoryDefaults.highlight_video_urls || [], 'highlight_video_urls'),
    gallery_image_urls: parseJsonFormField(rawData.gallery_image_urls, stringArrayFormFieldSchema, categoryDefaults.gallery_image_urls || [], 'gallery_image_urls'),
    promo_sms_enabled: rawData.promo_sms_enabled === 'true' ? true : rawData.promo_sms_enabled === 'false' ? false : categoryDefaults.promo_sms_enabled ?? true,
    bookings_enabled: rawData.bookings_enabled === 'true' ? true : rawData.bookings_enabled === 'false' ? false : categoryDefaults.bookings_enabled ?? true,
    // London wall-time (from the datetime-local input) → UTC ISO instant, or null when blank.
    booking_cutoff_at: londonLocalInputToUtcIso(typeof rawData.booking_cutoff_at === 'string' ? rawData.booking_cutoff_at : '')
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

  // Ordinary drawer edits must not overwrite settings owned by the Tickets tab.
  if (_existingEventId && !formData.has('price') && !formData.has('payment_mode')) {
    delete data.price
    delete data.is_free
    delete data.payment_mode
    delete data.online_discount_type
    delete data.online_discount_value
  }

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
  } else if (!_existingEventId && categoryDefaults.faqs) {
    data.faqs = categoryDefaults.faqs
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
      return eventValidationFailure(validationResult.error);
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

    // Push the new event to the Pub Ops Google Calendar immediately so it does not
    // have to wait for the first booking, an edit, or the reconciliation cron.
    await syncPubOpsEventCalendarByEventId(createAdminClient(), event.id, {
      context: 'event_created',
    })

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
      return eventValidationFailure(validationResult.error);
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
      .select('id, customer_id, event_id, seats, event_seating_type, is_reminder_only, notes, attendee_names, attendees, created_at, status, source, hold_expires_at, contact_email, customer:customers(id, first_name, last_name, mobile_number, email)')
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

    // Who came (BK-130): a check-in from the door kiosk or ticked from the staff list. One per guest
    // per event; older rows without a booking are matched to the guest's bookings.
    const { data: checkInRows, error: checkInsError } = await supabase
      .from('event_check_ins')
      .select('id, booking_id, customer_id, check_in_method')
      .eq('event_id', eventId)

    if (checkInsError) throw checkInsError

    const checkInByBooking = new Map<string, { id: string; check_in_method: string | null }>()
    const checkInByCustomer = new Map<string, { id: string; check_in_method: string | null }>()
    for (const row of checkInRows ?? []) {
      const checkIn = { id: row.id, check_in_method: row.check_in_method }
      if (row.booking_id) checkInByBooking.set(row.booking_id, checkIn)
      else if (row.customer_id) checkInByCustomer.set(row.customer_id, checkIn)
    }

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

    // Refunds waiting for a manager (D7). A failed read shows none rather than blocking the list;
    // the manager inbox was told about each one when it was raised.
    let refundRequestsByBooking = new Map<string, EventRefundRequest[]>()
    try {
      refundRequestsByBooking = await loadOpenEventRefundRequests(supabase, bookingIds)
    } catch (refundRequestsError) {
      logger.error('Failed to load open refund requests for event bookings', {
        error: refundRequestsError instanceof Error ? refundRequestsError : new Error(String(refundRequestsError)),
        metadata: { eventId },
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
        check_in: checkInByBooking.get(booking.id) ?? checkInByCustomer.get(booking.customer_id) ?? null,
        refund_requests: (refundRequestsByBooking.get(booking.id) ?? []).map((request) => ({
          id: request.id,
          kind: request.kind,
          amount: request.amount,
          label: describeEventRefundRequestKind(request.kind),
        })),
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
  })).min(1).max(20).optional(),
  // One row per ticket: name, own mobile and answers, any of which may follow later
  // (BK-011, BK-013, owner decision D5).
  attendees: staffEventAttendeesInputSchema.optional(),
  // The booker's email, so the confirmation and payment link can go by email (BK-142).
  email: z.string().trim().email('Please enter a valid email address.').max(255).optional(),
  // Staff read the guest the marketing notice and they said yes (owner decision D32).
  marketingTextsYes: z.boolean().optional()
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
      /** Places left when the event is full for this request (BK-033). */
      seats_remaining?: number | null
      /** The event needs guest details and some are still to follow (BK-011). */
      details_to_follow?: boolean
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
  attendees?: StaffEventAttendeeInput[]
  email?: string
  /** Staff read the guest the marketing notice and they said yes (owner decision D32). */
  marketingTextsYes?: boolean
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
      lastName: parsed.data.lastName,
      email: parsed.data.email
    }, { trustedEntry: true })

    if (!customerResolution.customerId) {
      return { error: 'Could not create or find customer for this phone number.' }
    }

    const customerId = customerResolution.customerId

    const { data: eventRow, error: eventError } = await supabase
      .from('events')
      .select('id, name, date, start_datetime, booking_mode')
      .eq('id', parsed.data.eventId)
      .maybeSingle()

    if (eventError || !eventRow) {
      return { error: 'Event not found.' }
    }

    // Mother's Day is sold as Sunday lunch tables, on every channel (BK-153, D35).
    if (
      isSundayLunchOnlyEvent({
        id: eventRow.id || null,
        name: eventRow.name || null,
        date: eventRow.date || null,
        start_datetime: eventRow.start_datetime || null
      })
    ) {
      return { error: SUNDAY_LUNCH_ONLY_EVENT_MESSAGE }
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

    // Ticket types and each ticket's guest details, shared with the FOH screen (BK-011, BK-141).
    const prepared = await prepareStaffEventBooking(supabase, {
      eventId: parsed.data.eventId,
      seats: parsed.data.seats,
      ticketSelections: parsed.data.ticketSelections,
      attendees: parsed.data.attendees,
      attendeeNames,
    })
    if (!prepared.ok) {
      return { error: prepared.error }
    }
    const { ticketSelections, attendees } = prepared

    // ── Delegate to shared service ───────────────────────────────────────────
    const result = await EventBookingService.createBooking({
      eventId: parsed.data.eventId,
      customerId,
      normalizedPhone: normalizedPhone || '',
      seats: parsed.data.seats,
      source: 'admin',
      bookingMode,
      seatingPreference: parsed.data.seatingPreference,
      appBaseUrl: getAppUrl(),
      shouldSendSms: true,
      supabaseClient: supabase,
      logTag: 'admin event booking',
      firstName: customerResolution.resolvedFirstName || parsed.data.firstName,
      attendeeNames: attendees ? undefined : attendeeNames,
      attendees,
      ticketSelections,
      contactEmail: customerResolution.bookingContactEmail ?? null
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

    // BK-033: a booking exists only when it is confirmed or waiting on payment. A full event
    // used to fall through to a 'create' audit row and a "Booking created" toast.
    if (resolvedState !== 'confirmed' && resolvedState !== 'pending_payment') {
      revalidatePath(`/events/${parsed.data.eventId}`)
      return {
        success: true,
        data: {
          state: resolvedState === 'full_with_waitlist_option' ? 'full_with_waitlist_option' : 'blocked',
          reason: resolvedReason,
          seats_remaining: result.seatsRemaining ?? null,
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
          attendee_names_provided: (attendeeNames?.length ?? 0) > 0 || (attendees?.some((guest) => guest.name.trim()) ?? false),
          guest_details_to_follow: prepared.detailsToFollow,
          ticket_selections: ticketSelections?.map((line) => ({
            ticket_type_id: line.ticket_type_id,
            quantity: line.quantity
          })) ?? null
        }
      })
      await recordStaffReadOutConsent({
        saidYes: parsed.data.marketingTextsYes,
        customerId,
        actorUserId: user.id,
        source: 'staff_event_booking',
        relatedEntityType: 'event_booking',
        relatedEntityId: bookingId,
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
        event_seating_type: eventSeatingType,
        details_to_follow: prepared.detailsToFollow
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
      .select('id, event_id, customer_id, status, seats, is_reminder_only, attendee_names, attendees, event:events(id, payment_mode)')
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
          // BK-023: these used to send staff to flows that did not exist.
          'This booking has already been paid, so the seat count cannot be changed here. Use Change tickets to add or remove guests.'
      }
    }

    if (Array.isArray(bookingRow.attendees) && bookingRow.attendees.length > 0 && parsed.data.seats !== bookingRow.seats) {
      return { error: 'This booking has named guests. Use Change tickets to add or remove a guest, so guest details and payment stay together.' }
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
              'This booking has more than one ticket type, so the overall seat count cannot be edited. Use Change tickets instead.'
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
          appBaseUrl: getAppUrl()
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
): Promise<{ amountPaid: number; alreadyRefunded: number; maxRefundable: number; barRefundable: number; paypalRefundable: number }> {
  const [paidResult, refundResult] = await Promise.all([
    // Fully refunded charges count as taken: their refund rows are subtracted below, once.
    supabase.from('payments').select('amount, payment_provider')
      .eq('event_booking_id', bookingId)
      .in('charge_type', ['prepaid_event', 'seat_increase'])
      .in('status', ['succeeded', 'partially_refunded', 'refunded']),
    supabase.from('payments').select('amount, payment_provider')
      .eq('event_booking_id', bookingId)
      .eq('charge_type', 'refund')
      .in('status', ['refunded', 'pending', 'succeeded'])
  ])
  if (paidResult.error) throw paidResult.error
  if (refundResult.error) throw refundResult.error
  const sum = (rows: Array<{ amount: unknown }>) => rows.reduce((total, row) => total + Math.max(0, Number(row.amount || 0)), 0)
  const paidRows = paidResult.data || []
  const refundRows = refundResult.data || []
  const amountPaid = sum(paidRows)
  const alreadyRefunded = sum(refundRows)
  const maxRefundable = toMoney(Math.max(0, amountPaid - alreadyRefunded))
  // Money taken at the bar (cash or card terminal) goes back across the bar and is recorded by
  // hand; PayPal can only return what PayPal took (BK-135).
  const barRefundable = toMoney(Math.min(maxRefundable, Math.max(0,
    sum(paidRows.filter((row) => row.payment_provider === 'manual')) - sum(refundRows.filter((row) => row.payment_provider === 'manual'))
  )))
  return {
    amountPaid: toMoney(amountPaid),
    alreadyRefunded: toMoney(alreadyRefunded),
    maxRefundable,
    barRefundable,
    paypalRefundable: toMoney(Math.max(0, maxRefundable - barRefundable))
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

    const { maxRefundable, paypalRefundable } = isPrepaidConfirmed
      ? await computeEventBookingRefundable(supabase, bookingRow.id)
      : { maxRefundable: 0, paypalRefundable: 0 }

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
    // Set when PayPal refunded the money but the payment record did not update.
    let refundStaffWarning: string | null = null
    // PayPal returns only what PayPal took. Any of the chosen refund paid at the bar is handed back
    // there and recorded from the booking's refund dialog (BK-135); staff are told how much.
    const paypalRefundAmount = toMoney(Math.min(resolvedRefundAmount, paypalRefundable))
    const barRefundAmount = toMoney(Math.max(0, resolvedRefundAmount - paypalRefundAmount))
    const barRefundWarning = barRefundAmount > 0
      ? `£${barRefundAmount.toFixed(2)} of this refund was paid at the bar. Hand it back, then record it with Refund, Record cash or card refund.`
      : null

    if (paypalRefundAmount > 0 && bookingRow.customer_id && bookingRow.event_id) {
      try {
        const refundResult = await processEventRefund(supabase, {
          bookingId: bookingRow.id,
          customerId: bookingRow.customer_id,
          eventId: bookingRow.event_id,
          amount: paypalRefundAmount,
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
        refundStaffWarning = refundResult.staffWarning ?? null
      } catch (refundError) {
        refundStatus = 'manual_required'
        refundAmount = paypalRefundAmount
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

    // Email first, a text only when no email goes (BK-167, owner decision D14). A cancellation on
    // the day of the event goes by both, so a guest on their way is told in time.
    const cancelState: { smsSent: boolean; smsMeta: SmsSafetyMeta } = { smsSent: false, smsMeta: null }
    const shouldSendSms = parsed.data.sendSms !== false
    const sendCancellationText = async (): Promise<EventTextAttempt> => {
    if (!(
      shouldSendSms &&
      customerRecord?.id &&
      typeof customerRecord.mobile_number === 'string' &&
      customerRecord.mobile_number.trim() &&
      customerRecord.sms_status === 'active'
    )) return null
      let smsSent = false
      let smsMeta: SmsSafetyMeta = null
      const smsBody = ensureReplyInstruction(
        buildEventBookingCancelledText({
          firstName: getSmartFirstName(customerRecord.first_name),
          eventName: eventRecord?.name || 'your event',
          // The date and time columns are a London wall clock reading, resolved in London.
          when: formatEventTextWhen(resolveEventStartIso({
            start_datetime: eventRecord?.start_datetime ?? null,
            date: eventRecord?.date ?? null,
            time: eventRecord?.time ?? null
          })),
          seats: Math.max(0, Number(bookingRow.seats || 0)),
          isReminderOnly: bookingRow.is_reminder_only === true,
          refundNote: buildStaffCancellationRefundNote({ refundStatus, refundAmount, paymentTaken: maxRefundable > 0, barRefundAmount })
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
        smsMeta = { success: smsDeliveredOrUnknown, code: smsCode ?? (smsDeliveredOrUnknown ? null : 'send_failed'), logFailure: smsLogFailure }

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
      cancelState.smsSent = smsSent
      cancelState.smsMeta = smsMeta
      return smsMeta
    }

    const eventDateIso = typeof eventRecord?.date === 'string' ? eventRecord.date : null
    const barRefundOnly = barRefundAmount > 0 && refundAmount <= 0
    await sendEventMessageEmailFirst({
      templateKey: 'event_booking_cancelled_admin',
      bookingId: bookingRow.id,
      eventId: bookingRow.event_id ?? null,
      customerId: bookingRow.customer_id ?? null,
      both: eventDateIso === getTodayIsoDate(),
      email: () => sendEventBookingCancelledEmail(supabase, {
        bookingId: bookingRow.id,
        refundStatus: barRefundOnly ? 'bar_refund_due' : refundStatus === 'none' ? null : refundStatus,
        // Zero is "no refund", not "a refund of £0.00". maxRefundable is what this booking actually
        // paid, so it decides whether a refund sentence has anything to say at all.
        refundAmount: barRefundOnly ? barRefundAmount : refundAmount > 0 ? refundAmount : null,
        ...(barRefundAmount > 0 && !barRefundOnly ? { barRefundAmount } : {}),
        currency: 'GBP',
        reason: 'staff_cancel',
        paymentTaken: maxRefundable > 0
      }),
      text: sendCancellationText,
    })
    const smsSent = cancelState.smsSent
    const smsMeta = cancelState.smsMeta

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
        warning: [followupWarning, refundStaffWarning, barRefundWarning].filter(Boolean).join(' ') || null
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
        /** What PayPal can return, and what was paid at the bar and goes back there (BK-135). */
        paypalRefundable: number
        barRefundable: number
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
    // A cancelled booking, or one paid at the door, can still hold money to give back.
    const mayHoldMoney =
      bookingRow.is_reminder_only !== true && (bookingRow.status === 'confirmed' || bookingRow.status === 'cancelled')

    const { amountPaid, alreadyRefunded, maxRefundable, barRefundable, paypalRefundable } = mayHoldMoney
      ? await computeEventBookingRefundable(supabase, bookingRow.id)
      : { amountPaid: 0, alreadyRefunded: 0, maxRefundable: 0, barRefundable: 0, paypalRefundable: 0 }

    let policySuggestion = 0
    if (isPrepaidConfirmed && maxRefundable > 0 && eventRecord) {
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
      data: { canRefund: mayRefund, amountPaid, alreadyRefunded, maxRefundable, policySuggestion, paypalRefundable, barRefundable }
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
  // One per refund the manager asks for, made when the refund window opens (BK-024). Required:
  // without it two refunds on one booking would share a key and the second would move no money.
  requestId: z
    .string({ required_error: 'Please reload the page and try the refund again.' })
    .uuid({ message: 'Please reload the page and try the refund again.' }),
  // Omitted → refund everything still refundable.
  amount: z.number().min(0.01).max(100000).optional(),
  reason: z.string().trim().max(200).optional(),
  // 'paypal' sends money back through PayPal. 'cash' or 'card_terminal' records money handed back
  // at the bar against tickets paid there; nothing moves through PayPal (BK-135).
  method: z.enum(['paypal', 'cash', 'card_terminal']).optional().default('paypal'),
  // The refund request this refund settles (owner decision D7), when it was opened from one.
  refundRequestId: z.string().uuid().optional()
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
        /** Set when the refund went through but the payment record did not update. */
        warning?: string | null
      }
    }

/**
 * After-the-fact refund for an event booking (cancelled OR still-confirmed paid
 * bookings). Managers only — reuses the cancel flow's refund machinery with a
 * stable idempotency key so retries never double-refund.
 */
export async function refundEventBookingManual(input: {
  bookingId: string
  requestId: string
  amount?: number
  reason?: string
  method?: 'paypal' | 'cash' | 'card_terminal'
  refundRequestId?: string
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

    const refundable = await computeEventBookingRefundable(supabase, bookingRow.id)
    const { maxRefundable } = refundable
    if (maxRefundable <= 0) {
      return { error: 'There is nothing left to refund on this booking.' }
    }
    const atTheBar = parsed.data.method !== 'paypal'
    // PayPal returns only what PayPal took; a bar payment goes back across the bar (BK-135).
    const methodLimit = atTheBar ? refundable.barRefundable : refundable.paypalRefundable
    if (methodLimit <= 0) {
      return {
        error: atTheBar
          ? 'Nothing on this booking was paid at the bar. Refund it through PayPal instead.'
          : 'This booking was paid at the bar, in cash or by card. Hand the money back and choose Record cash or card refund.'
      }
    }

    let resolvedAmount = methodLimit
    if (typeof parsed.data.amount === 'number') {
      const requested = toMoney(Math.max(0, parsed.data.amount))
      if (requested <= 0) {
        return { error: 'Enter a refund amount greater than zero.' }
      }
      if (requested > methodLimit) {
        return {
          error: atTheBar
            ? `A cash or card refund cannot exceed what was paid at the bar (£${methodLimit.toFixed(2)}).`
            : `Refund cannot exceed the amount paid (£${methodLimit.toFixed(2)}).`
        }
      }
      resolvedAmount = requested
    }

    // Per request, not per booking (BK-024): a double click replays, a second refund is new.
    const idempotencyKey = `staff-manual-refund:${bookingRow.id}:${parsed.data.requestId}`
    let refundResult: EventRefundResult
    try {
      refundResult = atTheBar
        ? await recordManualEventRefund(supabase, {
            bookingId: bookingRow.id,
            amount: resolvedAmount,
            method: parsed.data.method as EventManualRefundMethod,
            reason: 'staff_manual_refund',
            idempotencyKey,
            recordedBy: actingUserId,
            note: parsed.data.reason || null,
            metadata: { max_refundable: maxRefundable, refund_request_id: parsed.data.refundRequestId ?? null }
          })
        : await processEventRefund(supabase, {
            bookingId: bookingRow.id,
            customerId: bookingRow.customer_id,
            eventId: bookingRow.event_id,
            amount: resolvedAmount,
            reason: 'staff_manual_refund',
            metadata: {
              idempotency_key: idempotencyKey,
              initiated_by: actingUserId,
              note: parsed.data.reason || null,
              max_refundable: maxRefundable,
              refund_request_id: parsed.data.refundRequestId ?? null
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
        method: parsed.data.method,
        refund_request_id: parsed.data.refundRequestId ?? null,
        reason: parsed.data.reason || null
      }
    })

    // A refund opened from a waiting refund request settles it (owner decision D7).
    if (parsed.data.refundRequestId && (refundResult.status === 'succeeded' || refundResult.status === 'pending') && refundResult.amount > 0) {
      await resolveEventRefundRequestRow(supabase, {
        requestId: parsed.data.refundRequestId,
        bookingId: bookingRow.id,
        status: 'refunded',
        amount: refundResult.amount,
        resolvedBy: actingUserId,
        note: parsed.data.reason || null
      })
    }

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
        max_refundable: maxRefundable,
        warning: refundResult.staffWarning ?? null
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
  /**
   * The amount the member of staff confirmed on screen for cash or card (BK-217). The payment is
   * refused if the door price has changed since, so nothing is recorded that nobody saw.
   */
  confirmedAmount: z.number().nonnegative().optional(),
  sendSms: z.boolean().optional().default(true)
})
  // A free booking must be explainable later (BK-217): a comp needs a reason.
  .refine((value) => value.method !== 'comp' || Boolean(value.note), {
    message: 'Say why this booking is free.',
    path: ['note'],
  })
  .refine((value) => value.method === 'comp' || value.confirmedAmount !== undefined, {
    message: 'Confirm the amount taken before recording the payment.',
    path: ['confirmedAmount'],
  })

type EventDoorChargeEvent = {
  payment_mode?: string | null
  price?: number | string | null
  price_per_seat?: number | string | null
  is_free?: boolean | null
}

/**
 * What a door payment records for a booking: its real composition at FULL per-type price (the
 * online discount never applies at the venue; owner decision EV-02, 4 July 2026). Legacy bookings
 * without line items fall back to the event's full ticket price × seats.
 */
async function resolveManualDoorChargeAmount(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  eventRecord: EventDoorChargeEvent | null,
  seatCount: number
): Promise<number> {
  let doorItems: BookingItemWithBasePrice[] = []
  try {
    doorItems = await loadBookingItemsWithBasePrices(supabase, bookingId)
  } catch (itemsError) {
    logger.warn('Failed to load booking items for door charge; falling back to event price', {
      metadata: {
        bookingId,
        error: itemsError instanceof Error ? itemsError.message : String(itemsError),
      },
    })
  }
  return resolveDoorChargeAmount({
    items: doorItems,
    eventFullUnitPrice: resolveEventTicketPriceAmount((eventRecord ?? {}) as unknown as Event),
    seats: seatCount
  })
}

/** The amount Cash Paid or Card Paid would record, shown to staff before they confirm (BK-217). */
export async function getEventBookingDoorCharge(
  bookingId: string
): Promise<{ error: string } | { success: true; data: { amount: number; seats: number } }> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to mark event bookings paid.' }
    }
    if (!z.string().uuid().safeParse(bookingId).success) {
      return { error: 'Booking not found.' }
    }

    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase
      .from('bookings')
      .select('id, seats, status, event:events(id, payment_mode, price, price_per_seat, is_free)')
      .eq('id', bookingId)
      .maybeSingle()
    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }
    if (bookingRow.status !== 'pending_payment') {
      return { error: 'This booking is not waiting for payment.' }
    }

    const eventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const seats = Math.max(1, Number(bookingRow.seats || 1))
    const amount = await resolveManualDoorChargeAmount(supabase, bookingId, eventRecord ?? null, seats)
    return { success: true, data: { amount, seats } }
  } catch (error) {
    logger.error('Failed to work out the door charge for an event booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: 'Could not work out the amount to record.' }
  }
}

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
  /** Required for a comp: why the booking is free (BK-217). */
  note?: string
  /** Required for cash or card: the amount staff confirmed on screen (BK-217). */
  confirmedAmount?: number
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
      : await resolveManualDoorChargeAmount(supabase, parsed.data.bookingId, eventRecord ?? null, seatCount)

    // Record only the amount staff confirmed on screen (BK-217).
    if (
      parsed.data.method !== 'comp' &&
      Math.round((parsed.data.confirmedAmount ?? -1) * 100) !== Math.round(expectedAmount * 100)
    ) {
      return {
        error: `The amount to record is now ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(expectedAmount)}. Check it and try again.`,
      }
    }

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

    // Email first, a text only when no email goes (BK-167, owner decision D14). Staff can still
    // turn the text off; a repeat confirmation re-checks the email only.
    let smsSent = false
    let smsMeta: SmsSafetyMeta = null
    if (state === 'confirmed' || state === 'already_confirmed' || state === 'manual_review') {
      const outcome = await notifyEventPaymentOutcome(supabase, {
        bookingId: parsed.data.bookingId,
        eventId: bookingRow.event_id ?? null,
        outcome: state === 'manual_review' ? 'manual_review' : 'confirmed',
        amount: expectedAmount,
        currency: 'GBP',
        appBaseUrl: getAppUrl(),
        textAllowed: state === 'manual_review' || (parsed.data.sendSms !== false && state === 'confirmed'),
      })
      smsSent = outcome.texted
      smsMeta = outcome.smsMeta
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
        note: parsed.data.note || null,
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
      appBaseUrl: input.appBaseUrl || getAppUrl()
    })
    manageLink = token.url
  } catch {
    manageLink = null
  }

  const firstName = getSmartFirstName(customer.first_name)
  const overpaymentPart =
    typeof input.overpayment === 'number' && input.overpayment > 0
      // Not a promise of an amount: a manager decides the refund from what was paid (D7, BK-028).
      ? ` The new night costs £${input.overpayment.toFixed(2)} less than you paid, and we will be in touch about the difference.`
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

const transferAnswersSchema = z.record(
  z.string().uuid(),
  z.record(z.string().min(1).max(100), z.string().max(2000))
)

const transferEventBookingSchema = z.object({
  bookingId: z.string().uuid(),
  targetEventId: z.string().uuid(),
  // The new night's answers for each guest, by guest id then question id (BK-028). A required
  // answer may be left to follow, as on any staff booking.
  answers: transferAnswersSchema.optional().default({}),
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
        /** Paid beyond the new night's price, waiting for a manager as a refund request (D7). */
        overpayment?: number
        refund_request_id?: string | null
        /** Required answers left to follow on the new night. */
        answers_to_follow?: number
      }
      meta?: { sms: SmsSafetyMeta }
    }

type TransferRpcResult = {
  state?: string
  reason?: string
  new_booking_id?: string
  from_event_id?: string
  to_event_id?: string
  seats?: number
  paid_total?: number
  target_amount?: number
  overpayment?: number
  refund_request_id?: string | null
  answers_to_follow?: number
}

/**
 * Moves a paid or free booking to another night (BK-028, customer bookings review of 24 October
 * 2026; owner decision D7).
 *
 * The whole move is one database transaction, transfer_event_booking_v01: the replacement is
 * created and confirmed at once with no payment hold, so the guest is never sent "Complete your
 * payment"; its ticket lines map to the new night's ticket types by name; the guests travel with
 * their names and phones and the new night's answers; the payments move with the booking; the
 * original is cancelled with its table; the move is recorded. It used to run as a dozen separate
 * writes that emailed a payment link, lost ticket types (the deferred seat-sum check refused the
 * separate delete of ticket lines) and refused named bookings.
 *
 * A dearer night is refused. On a cheaper night the difference is not promised in a text: it is a
 * refund request a manager decides, and the manager inbox is told.
 */
export async function transferEventBooking(input: {
  bookingId: string
  targetEventId: string
  answers?: Record<string, Record<string, string>>
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

    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase
      .from('bookings')
      .select('id, event_id, customer_id, event:events(id, name, start_datetime, date, time)')
      .eq('id', parsed.data.bookingId)
      .maybeSingle()

    if (bookingError || !bookingRow) {
      return { error: 'Booking not found.' }
    }
    if (bookingRow.event_id === parsed.data.targetEventId) {
      return { error: 'Choose a different event.' }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('transfer_event_booking_v01', {
      p_booking_id: parsed.data.bookingId,
      p_target_event_id: parsed.data.targetEventId,
      p_answers: parsed.data.answers,
      p_performed_by: user.id
    })
    if (rpcError) {
      logger.error('transfer_event_booking_v01 failed', {
        error: new Error(rpcError.message),
        metadata: { bookingId: parsed.data.bookingId, targetEventId: parsed.data.targetEventId, code: rpcError.code ?? null }
      })
      return { error: 'The booking could not be moved. Nothing has changed; please try again.' }
    }
    const moved = (rpcData ?? {}) as TransferRpcResult

    if (moved.state !== 'transferred' || !moved.new_booking_id) {
      return {
        success: true,
        data: {
          state: 'blocked',
          reason: moved.reason || 'target_event_unavailable',
          original_booking_id: parsed.data.bookingId,
          new_booking_id: null,
          sms_sent: false
        }
      }
    }

    const newBookingId = moved.new_booking_id
    const overpayment = toMoney(Math.max(0, Number(moved.overpayment ?? 0)))
    const fromEvent = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const { data: targetEvent } = await supabase
      .from('events')
      .select('id, name, start_datetime, date, time')
      .eq('id', parsed.data.targetEventId)
      .maybeSingle()

    if (moved.refund_request_id && overpayment > 0) {
      await alertEventRefundRequest(supabase, {
        requestId: moved.refund_request_id,
        bookingId: newBookingId,
        eventId: parsed.data.targetEventId,
        eventName: targetEvent?.name ?? null,
        kind: 'transfer_overpayment',
        amount: overpayment,
        pricePaid: typeof moved.paid_total === 'number' ? moved.paid_total : null
      })
    }

    let smsSent = false
    let smsMeta: SmsSafetyMeta = null
    if (parsed.data.sendSms !== false && bookingRow.customer_id) {
      const transferSmsMeta = await sendEventTransferSms({
        supabase,
        bookingId: newBookingId,
        customerId: bookingRow.customer_id,
        fromEventName: fromEvent?.name || 'your original event',
        toEventName: targetEvent?.name || 'your new event',
        eventStartIso: resolveEventStartIso(targetEvent as EventWhenSource | null),
        appBaseUrl: getAppUrl(),
        overpayment
      })
      smsMeta = transferSmsMeta
      smsSent = transferSmsMeta.success === true || transferSmsMeta.logFailure === true
    }

    await sendEventTicketTransferredEmail(supabase, {
      bookingId: newBookingId,
      fromEventName: fromEvent?.name || 'your original event',
      toEventName: targetEvent?.name || 'your new event',
      // Two months of the same recurring night share a name, so the old date is what makes the
      // email readable: without it a move between two Quiz Nights said "from Quiz Night to
      // Quiz Night".
      fromEventStartIso: resolveEventStartIso(fromEvent as EventWhenSource | null),
      eventStartIso: resolveEventStartIso(targetEvent as EventWhenSource | null),
      appBaseUrl: getAppUrl(),
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
        new_booking_id: newBookingId,
        from_event_id: bookingRow.event_id,
        to_event_id: parsed.data.targetEventId,
        paid_total: moved.paid_total ?? null,
        target_amount: moved.target_amount ?? null,
        overpayment,
        refund_request_id: moved.refund_request_id ?? null,
        answers_to_follow: moved.answers_to_follow ?? 0
      }
    })

    await Promise.allSettled([
      bookingRow.event_id
        ? syncPubOpsEventCalendarByEventId(supabase, bookingRow.event_id, {
            bookingId: parsed.data.bookingId,
            context: 'admin_event_booking_transferred_from',
          })
        : Promise.resolve(),
      syncPubOpsEventCalendarByEventId(supabase, parsed.data.targetEventId, {
        bookingId: newBookingId,
        context: 'admin_event_booking_transferred_to',
      })
    ])

    if (bookingRow.event_id) revalidatePath(`/events/${bookingRow.event_id}`)
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
        new_booking_id: newBookingId,
        sms_sent: smsSent,
        overpayment,
        refund_request_id: moved.refund_request_id ?? null,
        answers_to_follow: Number(moved.answers_to_follow ?? 0)
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

type TransferPreviewResult =
  | { error: string }
  | {
      success: true
      data: {
        guests: Array<{ id: string; name: string }>
        questions: Array<{ id: string; label: string; type: string; required: boolean; options: string[] }>
        /** Answers already given that match a new night's question by its wording. */
        prefill: Record<string, Record<string, string>>
      }
    }

/**
 * What a move to another night asks (BK-028): the new night's questions for each guest, with the
 * answers already given carried over where a question reads the same.
 */
export async function getEventTransferPreview(bookingId: string, targetEventId: string): Promise<TransferPreviewResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to transfer event bookings.' }
    }
    if (!z.string().uuid().safeParse(bookingId).success || !z.string().uuid().safeParse(targetEventId).success) {
      return { error: 'Booking not found.' }
    }
    const supabase = createAdminClient()
    const [{ data: bookingRow, error: bookingError }, { data: targetEvent, error: eventError }] = await Promise.all([
      supabase.from('bookings').select('id, attendees').eq('id', bookingId).maybeSingle(),
      supabase.from('events').select('id, booking_questions').eq('id', targetEventId).maybeSingle()
    ])
    if (bookingError || !bookingRow) return { error: 'Booking not found.' }
    if (eventError || !targetEvent) return { error: 'Target event not found.' }

    const questions = (Array.isArray(targetEvent.booking_questions) ? targetEvent.booking_questions : [])
      .map((raw) => raw as Record<string, unknown>)
      .filter((q) => typeof q.id === 'string' && typeof q.label === 'string')
      .map((q) => ({
        id: String(q.id),
        label: String(q.label),
        type: typeof q.type === 'string' ? q.type : 'text',
        required: q.required === true,
        options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string') : []
      }))
    const attendees = Array.isArray(bookingRow.attendees) ? (bookingRow.attendees as Array<Record<string, unknown>>) : []
    const guests = attendees
      .filter((a) => typeof a.id === 'string')
      .map((a) => ({ id: String(a.id), name: typeof a.name === 'string' ? a.name : '' }))
    const prefill: Record<string, Record<string, string>> = {}
    const normalise = (value: string) => value.trim().toLowerCase()
    for (const attendee of attendees) {
      if (typeof attendee.id !== 'string') continue
      const given = Array.isArray(attendee.answers) ? (attendee.answers as Array<Record<string, unknown>>) : []
      const answers: Record<string, string> = {}
      for (const question of questions) {
        const match = given.find((answer) => typeof answer.label === 'string' && normalise(answer.label) === normalise(question.label))
        const value = typeof match?.value === 'string' ? match.value : ''
        if (!value) continue
        if (question.type === 'yes_no' && value !== 'yes' && value !== 'no') continue
        if (question.type === 'choice' && !question.options.includes(value)) continue
        answers[question.id] = value
      }
      prefill[attendee.id] = answers
    }
    return { success: true, data: { guests, questions, prefill } }
  } catch (error) {
    logger.error('Failed to load the event transfer preview', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to load the questions for the new night.') }
  }
}

// ---------------------------------------------------------------------------------------------
// Change tickets on a booking (BK-023, customer bookings review of 24 October 2026; D7, D10)
// ---------------------------------------------------------------------------------------------

/**
 * Why a ticket change was refused, in words for staff. The codes come from the database
 * functions remove_event_booking_guests_v01, add_event_booking_guests_v01 and
 * change_event_booking_ticket_type_v01.
 */
const TICKET_CHANGE_REASON_TEXT: Record<string, string> = {
  booking_not_found: 'This booking could not be found.',
  status_not_changeable: 'Only a confirmed booking can have its tickets changed.',
  event_started: 'This event has already started, so its tickets can no longer be changed.',
  choose_guests: 'Choose which guests this applies to.',
  guest_not_on_booking: 'One of the guests chosen is no longer on this booking. Refresh and try again.',
  invalid_quantity: 'Choose how many tickets.',
  would_remove_every_guest: 'That would take every guest off. Cancel the booking instead.',
  ticket_line_mismatch: 'The tickets on this booking have changed. Refresh and try again.',
  invalid_ticket_type: 'That ticket type is not on sale for this event.',
  same_ticket_type: 'Those tickets are already that type.',
  settlement_required: 'Say how the extra is paid: cash, card, or free with a reason.',
  comp_reason_required: 'Say why the tickets are free.',
  no_payment_taken_here: 'This event is not paid in advance, so no payment is taken here.',
  amount_changed: 'The price has changed. Check the amount and try again.',
  guest_details_needed: 'Add a guest row for each new ticket. A name can follow later.',
  booking_has_no_guest_rows: 'This booking has no guest rows, so add the tickets without names.',
  insufficient_capacity: 'The event does not have enough places left.',
  insufficient_seated_capacity: 'No seated places are left for this event.',
  insufficient_standing_capacity: 'No standing places are left for this event.',
  table_capacity_insufficient: 'The table for this booking is not big enough. Move it to a larger table first.',
  ticket_type_sold_out: 'That ticket type is sold out.',
  invalid_attendee_phone: 'Please check the guest mobile numbers.',
  invalid_attendee_answer: 'One of the answers does not fit its question.',
  unknown_attendee_question: 'One of the answers is for a question this event does not ask.',
  attendee_name_required: 'A guest name is too long.',
  invalid_attendee_id: 'Please reload the page and try again.',
}

function ticketChangeReasonText(reason: string | null | undefined): string {
  if (!reason) return 'The tickets could not be changed.'
  return TICKET_CHANGE_REASON_TEXT[reason] ?? `The tickets could not be changed (${reason.replace(/_/g, ' ')}).`
}

/** A raised database exception (for example invalid_attendee_phone) as its reason code, or null. */
function ticketChangeErrorReason(error: { message?: string | null } | null): string | null {
  const message = String(error?.message ?? '')
  const known = Object.keys(TICKET_CHANGE_REASON_TEXT).find((code) => message.includes(code))
  return known ?? null
}

type TicketChangeResult =
  | { error: string }
  | {
      success: true
      data: {
        state: 'updated'
        old_seats?: number
        new_seats?: number
        /** Up to this much may be owed back, waiting for a manager (D7). */
        refund_owed: number
        refund_request_id: string | null
        /** Money taken at the venue for added or dearer tickets. */
        amount_taken: number
      }
    }

type TicketChangeRpcResult = {
  state?: string
  reason?: string
  amount?: number
  event_id?: string
  event_name?: string
  old_seats?: number
  new_seats?: number
  removed?: number
  added?: number
  changed?: number
  price_paid?: number
  refund_owed?: number
  refund_request_id?: string | null
  payment_id?: string | null
}

async function requireTicketChangeUser(): Promise<{ error: string } | { userId: string; email: string | null }> {
  // D7: any member of staff who manages events may change the tickets; only the refund waits.
  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    return { error: 'You do not have permission to change event bookings.' }
  }
  const authSupabase = await createClient()
  const { data: { user }, error: authError } = await authSupabase.auth.getUser()
  if (authError || !user) {
    return { error: 'Unauthorized' }
  }
  return { userId: user.id, email: user.email ?? null }
}

/** After a ticket change: audit row, manager alert for a refund to decide, booker email, refresh. */
async function finishTicketChange(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    bookingId: string
    userId: string
    userEmail: string | null
    operation: 'remove_event_booking_guests' | 'add_event_booking_guests' | 'change_event_booking_ticket_type'
    rpc: TicketChangeRpcResult
    change: EventTicketsChange
    extra: Record<string, unknown>
  }
): Promise<void> {
  const refundOwed = toMoney(Math.max(0, Number(input.rpc.refund_owed ?? 0)))
  if (input.rpc.refund_request_id && refundOwed > 0) {
    await alertEventRefundRequest(supabase, {
      requestId: input.rpc.refund_request_id,
      bookingId: input.bookingId,
      eventId: input.rpc.event_id ?? null,
      eventName: input.rpc.event_name ?? null,
      kind: input.operation === 'remove_event_booking_guests' ? 'guest_removed' : 'ticket_type_changed',
      amount: refundOwed,
      pricePaid: typeof input.rpc.price_paid === 'number' ? input.rpc.price_paid : null,
    })
  }

  await logAuditEvent({
    user_id: input.userId,
    user_email: input.userEmail ?? undefined,
    operation_type: input.operation,
    resource_type: 'event_booking',
    resource_id: input.bookingId,
    operation_status: 'success',
    additional_info: {
      event_id: input.rpc.event_id ?? null,
      old_seats: input.rpc.old_seats ?? null,
      new_seats: input.rpc.new_seats ?? null,
      price_paid: input.rpc.price_paid ?? null,
      refund_owed: refundOwed,
      refund_request_id: input.rpc.refund_request_id ?? null,
      amount_taken: input.rpc.amount ?? 0,
      payment_id: input.rpc.payment_id ?? null,
      ...input.extra,
    },
  })

  await sendEventBookingTicketsChangedEmail(supabase, {
    bookingId: input.bookingId,
    change: input.change,
    appBaseUrl: getAppUrl(),
  })

  if (input.rpc.event_id) {
    await syncPubOpsEventCalendarByEventId(supabase, input.rpc.event_id, {
      bookingId: input.bookingId,
      context: 'admin_event_booking_tickets_changed',
    })
    revalidatePath(`/events/${input.rpc.event_id}`)
  }
  revalidatePath('/events')
  revalidatePath('/table-bookings/foh')
  revalidateTag('dashboard')
}

const removeEventBookingGuestsSchema = z.object({
  bookingId: z.string().uuid(),
  attendeeIds: z.array(z.string().uuid()).max(20).optional(),
  ticketTypeId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(20).optional(),
})

/**
 * Takes guests off a booking (BK-023 step 1): the chosen named guests, or a number of tickets of
 * one type on a booking without guest rows. Seats, ticket lines, guest rows and the table or
 * shared seats change in one transaction. Nothing is refunded here: what the tickets were sold at
 * becomes a refund request for a manager to decide (owner decision D7).
 */
export async function removeEventBookingGuests(input: {
  bookingId: string
  attendeeIds?: string[]
  ticketTypeId?: string
  quantity?: number
}): Promise<TicketChangeResult> {
  try {
    const actor = await requireTicketChangeUser()
    if ('error' in actor) return actor
    const parsed = removeEventBookingGuestsSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid change.' }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('remove_event_booking_guests_v01', {
      p_booking_id: parsed.data.bookingId,
      p_attendee_ids: (parsed.data.attendeeIds && parsed.data.attendeeIds.length > 0 ? parsed.data.attendeeIds : null) as unknown as string[],
      p_ticket_type_id: (parsed.data.ticketTypeId ?? null) as unknown as string,
      p_quantity: (parsed.data.quantity ?? null) as unknown as number,
      p_performed_by: actor.userId,
    })
    if (error) {
      const reason = ticketChangeErrorReason(error)
      logger.error('remove_event_booking_guests_v01 failed', {
        error: new Error(error.message),
        metadata: { bookingId: parsed.data.bookingId, code: error.code ?? null },
      })
      return { error: reason ? ticketChangeReasonText(reason) : 'The guests could not be removed. Nothing has changed; please try again.' }
    }
    const result = (data ?? {}) as TicketChangeRpcResult
    if (result.state !== 'updated') {
      return { error: ticketChangeReasonText(result.reason) }
    }

    const refundOwed = toMoney(Math.max(0, Number(result.refund_owed ?? 0)))
    await finishTicketChange(supabase, {
      bookingId: parsed.data.bookingId,
      userId: actor.userId,
      userEmail: actor.email,
      operation: 'remove_event_booking_guests',
      rpc: result,
      change: { kind: 'guests_removed', count: Number(result.removed ?? 1), refundToDecide: refundOwed > 0 },
      extra: { removed: result.removed ?? null, attendee_ids: parsed.data.attendeeIds ?? null },
    })

    return {
      success: true,
      data: {
        state: 'updated',
        old_seats: result.old_seats,
        new_seats: result.new_seats,
        refund_owed: refundOwed,
        refund_request_id: result.refund_request_id ?? null,
        amount_taken: 0,
      },
    }
  } catch (error) {
    logger.error('Unexpected removeEventBookingGuests error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to remove the guests.') }
  }
}

const ticketSettlementSchema = z.enum(['cash', 'card_terminal', 'comp', 'none'])

const addEventBookingGuestsSchema = z.object({
  bookingId: z.string().uuid(),
  ticketTypeId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(20),
  attendees: staffEventAttendeesInputSchema.optional(),
  settlement: ticketSettlementSchema,
  note: z.string().trim().max(500).optional(),
  expectedAmount: z.number().nonnegative().optional(),
})

/**
 * Adds guests to a booking (BK-023 step 2). Checks capacity, adds the seats, the ticket line and
 * a guest row for each new ticket (a name or answer may follow), and moves the table or shared
 * seats. On a paid-in-advance event the new tickets are paid now at the venue, at the full price
 * (owner decision D10), or given free with a reason; the amount must match what staff were shown.
 */
export async function addEventBookingGuests(input: {
  bookingId: string
  ticketTypeId?: string
  quantity: number
  attendees?: StaffEventAttendeeInput[]
  settlement: 'cash' | 'card_terminal' | 'comp' | 'none'
  note?: string
  expectedAmount?: number
}): Promise<TicketChangeResult> {
  try {
    const actor = await requireTicketChangeUser()
    if ('error' in actor) return actor
    const parsed = addEventBookingGuestsSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid change.' }
    }
    const attendees = normaliseAttendeePhones(parsed.data.attendees ?? [])
    if (attendees === null) {
      return { error: INVALID_GUEST_PHONE_MESSAGE }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('add_event_booking_guests_v01', {
      p_booking_id: parsed.data.bookingId,
      p_ticket_type_id: (parsed.data.ticketTypeId ?? null) as unknown as string,
      p_quantity: parsed.data.quantity,
      p_attendees: attendees ?? [],
      p_settlement: parsed.data.settlement,
      p_note: (parsed.data.note ?? null) as unknown as string,
      p_expected_amount: (parsed.data.expectedAmount ?? null) as unknown as number,
      p_performed_by: actor.userId,
    })
    if (error) {
      const reason = ticketChangeErrorReason(error)
      logger.error('add_event_booking_guests_v01 failed', {
        error: new Error(error.message),
        metadata: { bookingId: parsed.data.bookingId, code: error.code ?? null },
      })
      return { error: reason ? ticketChangeReasonText(reason) : 'The guests could not be added. Nothing has changed; please try again.' }
    }
    const result = (data ?? {}) as TicketChangeRpcResult
    if (result.state !== 'updated') {
      if (result.reason === 'amount_changed' && typeof result.amount === 'number') {
        return { error: `The amount to take is now £${result.amount.toFixed(2)}. Check it and try again.` }
      }
      return { error: ticketChangeReasonText(result.reason) }
    }

    const amountTaken = toMoney(Math.max(0, Number(result.amount ?? 0)))
    await finishTicketChange(supabase, {
      bookingId: parsed.data.bookingId,
      userId: actor.userId,
      userEmail: actor.email,
      operation: 'add_event_booking_guests',
      rpc: result,
      change: { kind: 'guests_added', count: Number(result.added ?? parsed.data.quantity), amountTaken },
      extra: { added: result.added ?? parsed.data.quantity, settlement: parsed.data.settlement, note: parsed.data.note ?? null },
    })

    return {
      success: true,
      data: {
        state: 'updated',
        old_seats: result.old_seats,
        new_seats: result.new_seats,
        refund_owed: 0,
        refund_request_id: null,
        amount_taken: amountTaken,
      },
    }
  } catch (error) {
    logger.error('Unexpected addEventBookingGuests error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to add the guests.') }
  }
}

const changeEventBookingTicketTypeSchema = z.object({
  bookingId: z.string().uuid(),
  attendeeIds: z.array(z.string().uuid()).max(20).optional(),
  fromTicketTypeId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(20).optional(),
  toTicketTypeId: z.string().uuid(),
  settlement: ticketSettlementSchema,
  note: z.string().trim().max(500).optional(),
  expectedAmount: z.number().nonnegative().optional(),
})

/**
 * Moves tickets to another ticket type (BK-023 step 3). A dearer type is paid now at the venue or
 * given free with a reason; a cheaper one leaves the difference as a refund request for a manager
 * (owner decision D7).
 */
export async function changeEventBookingTicketType(input: {
  bookingId: string
  attendeeIds?: string[]
  fromTicketTypeId?: string
  quantity?: number
  toTicketTypeId: string
  settlement: 'cash' | 'card_terminal' | 'comp' | 'none'
  note?: string
  expectedAmount?: number
}): Promise<TicketChangeResult> {
  try {
    const actor = await requireTicketChangeUser()
    if ('error' in actor) return actor
    const parsed = changeEventBookingTicketTypeSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid change.' }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('change_event_booking_ticket_type_v01', {
      p_booking_id: parsed.data.bookingId,
      p_attendee_ids: (parsed.data.attendeeIds && parsed.data.attendeeIds.length > 0 ? parsed.data.attendeeIds : null) as unknown as string[],
      p_from_ticket_type_id: (parsed.data.fromTicketTypeId ?? null) as unknown as string,
      p_quantity: (parsed.data.quantity ?? null) as unknown as number,
      p_to_ticket_type_id: parsed.data.toTicketTypeId,
      p_settlement: parsed.data.settlement,
      p_note: (parsed.data.note ?? null) as unknown as string,
      p_expected_amount: (parsed.data.expectedAmount ?? null) as unknown as number,
      p_performed_by: actor.userId,
    })
    if (error) {
      const reason = ticketChangeErrorReason(error)
      logger.error('change_event_booking_ticket_type_v01 failed', {
        error: new Error(error.message),
        metadata: { bookingId: parsed.data.bookingId, code: error.code ?? null },
      })
      return { error: reason ? ticketChangeReasonText(reason) : 'The tickets could not be changed. Nothing has changed; please try again.' }
    }
    const result = (data ?? {}) as TicketChangeRpcResult & { difference?: number }
    if (result.state !== 'updated') {
      if ((result.reason === 'amount_changed' || result.reason === 'settlement_required') && typeof result.amount === 'number') {
        return { error: `${ticketChangeReasonText(result.reason)} The difference is £${result.amount.toFixed(2)}.` }
      }
      return { error: ticketChangeReasonText(result.reason) }
    }

    const { data: toType } = await supabase
      .from('event_ticket_types')
      .select('name')
      .eq('id', parsed.data.toTicketTypeId)
      .maybeSingle()
    const refundOwed = toMoney(Math.max(0, Number(result.refund_owed ?? 0)))
    const amountTaken = toMoney(Math.max(0, Number(result.amount ?? 0)))
    await finishTicketChange(supabase, {
      bookingId: parsed.data.bookingId,
      userId: actor.userId,
      userEmail: actor.email,
      operation: 'change_event_booking_ticket_type',
      rpc: result,
      change: {
        kind: 'ticket_type_changed',
        count: Number(result.changed ?? 1),
        ticketTypeName: toType?.name ?? null,
        amountTaken,
        refundToDecide: refundOwed > 0,
      },
      extra: {
        changed: result.changed ?? null,
        to_ticket_type_id: parsed.data.toTicketTypeId,
        difference: result.difference ?? null,
        settlement: parsed.data.settlement,
        note: parsed.data.note ?? null,
      },
    })

    return {
      success: true,
      data: {
        state: 'updated',
        refund_owed: refundOwed,
        refund_request_id: result.refund_request_id ?? null,
        amount_taken: amountTaken,
      },
    }
  } catch (error) {
    logger.error('Unexpected changeEventBookingTicketType error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to change the tickets.') }
  }
}

type TicketChangeOptions =
  | { error: string }
  | {
      success: true
      data: {
        paymentMode: string
        /** Every ticket type on sale, with what it costs at the venue (full price, D10) and online. */
        /**
         * Every ticket type on sale: fullPrice is what the venue charges (D10), bookedPrice what a
         * ticket costs on this booking's terms, pricePaid what this booking's own line was sold at.
         */
        ticketTypes: Array<{ id: string; name: string; fullPrice: number; bookedPrice: number; pricePaid: number | null; onBooking: number }>
        guests: Array<{ id: string; name: string; ticketTypeId: string | null }>
        seats: number
        questions: BookingQuestion[]
      }
    }

/** What the Change tickets dialog offers for a booking (BK-023). */
export async function getEventBookingTicketChangeOptions(bookingId: string): Promise<TicketChangeOptions> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to change event bookings.' }
    }
    if (!z.string().uuid().safeParse(bookingId).success) {
      return { error: 'Booking not found.' }
    }
    const supabase = createAdminClient()
    const { data: bookingRow, error: bookingError } = await supabase
      .from('bookings')
      .select('id, event_id, seats, attendees, event:events(id, payment_mode, online_discount_type, online_discount_value, online_discount_ends_at, booking_questions)')
      .eq('id', bookingId)
      .maybeSingle()
    if (bookingError || !bookingRow?.event_id) return { error: 'Booking not found.' }
    const eventRecord = (Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event) as {
      payment_mode?: string | null
      online_discount_type?: string | null
      online_discount_value?: number | string | null
      online_discount_ends_at?: string | null
      booking_questions?: unknown
    } | null

    const [{ data: types, error: typesError }, items] = await Promise.all([
      supabase
        .from('event_ticket_types')
        .select('id, name, base_price, sort_order, created_at')
        .eq('event_id', bookingRow.event_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      loadBookingItems(supabase, bookingId),
    ])
    if (typesError) throw typesError

    const prepaid = eventRecord?.payment_mode === 'prepaid'
    const discountEnds = eventRecord?.online_discount_ends_at ? Date.parse(eventRecord.online_discount_ends_at) : Number.NaN
    const discountLive = prepaid && !(Number.isFinite(discountEnds) && discountEnds <= Date.now())
    const discountValue = Number(eventRecord?.online_discount_value ?? 0)
    const onlinePrice = (base: number): number => {
      if (!discountLive || !discountValue) return toMoney(base)
      if (eventRecord?.online_discount_type === 'percent') return toMoney(Math.max(0, base - base * (discountValue / 100)))
      if (eventRecord?.online_discount_type === 'fixed') return toMoney(Math.max(0, base - discountValue))
      return toMoney(base)
    }
    const quantityByType = new Map(items.map((item) => [item.ticket_type_id, Number(item.quantity) || 0]))
    const pricePaidByType = new Map(items.map((item) => [item.ticket_type_id, toMoney(Number(item.unit_price) || 0)]))

    const attendees = Array.isArray(bookingRow.attendees) ? (bookingRow.attendees as Array<Record<string, unknown>>) : []
    return {
      success: true,
      data: {
        paymentMode: eventRecord?.payment_mode ?? 'free',
        ticketTypes: (types ?? []).map((type) => ({
          id: type.id,
          name: type.name || 'Ticket',
          fullPrice: toMoney(Number(type.base_price ?? 0)),
          bookedPrice: onlinePrice(Number(type.base_price ?? 0)),
          pricePaid: pricePaidByType.get(type.id) ?? null,
          onBooking: quantityByType.get(type.id) ?? 0,
        })),
        guests: attendees
          .filter((attendee) => typeof attendee.id === 'string')
          .map((attendee) => ({
            id: String(attendee.id),
            name: typeof attendee.name === 'string' ? attendee.name : '',
            ticketTypeId: typeof attendee.ticket_type_id === 'string' ? attendee.ticket_type_id : null,
          })),
        seats: Math.max(0, Number(bookingRow.seats ?? 0)),
        questions: (Array.isArray(eventRecord?.booking_questions) ? eventRecord?.booking_questions : []) as BookingQuestion[],
      },
    }
  } catch (error) {
    logger.error('Failed to load ticket change options', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to load the tickets on this booking.') }
  }
}

const decideNoEventRefundSchema = z.object({
  bookingId: z.string().uuid(),
  requestId: z.string().uuid(),
  note: z.string().trim().min(1, 'Say why no refund is due.').max(500),
})

/**
 * A manager decides that a waiting refund request is not refunded (owner decision D7), with a
 * reason. Refunding it goes through refundEventBookingManual with the request's id instead.
 */
export async function decideNoEventRefund(input: {
  bookingId: string
  requestId: string
  note: string
}): Promise<{ error: string } | { success: true }> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'You do not have permission to decide refunds.' }
    }
    const parsed = decideNoEventRefundSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid decision.' }
    }
    const supabase = createAdminClient()
    const { userId, email, mayRefund } = await resolveEventRefundActor(supabase)
    if (!mayRefund) {
      return { error: 'Only a manager can decide a refund.' }
    }
    const closed = await resolveEventRefundRequestRow(supabase, {
      requestId: parsed.data.requestId,
      bookingId: parsed.data.bookingId,
      status: 'no_refund',
      amount: 0,
      resolvedBy: userId,
      note: parsed.data.note,
    })
    if (!closed) {
      return { error: 'This refund has already been decided. Refresh the page.' }
    }
    await logAuditEvent({
      user_id: userId ?? undefined,
      user_email: email ?? undefined,
      operation_type: 'decide_no_event_refund',
      resource_type: 'event_booking',
      resource_id: parsed.data.bookingId,
      operation_status: 'success',
      additional_info: { refund_request_id: parsed.data.requestId, note: parsed.data.note },
    })
    revalidatePath('/events')
    return { success: true }
  } catch (error) {
    logger.error('Unexpected decideNoEventRefund error', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to record the decision.') }
  }
}
