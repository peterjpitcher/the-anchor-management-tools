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
import { createEventManageToken, updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { logger } from '@/lib/logger'
import { buildKeywordsUnion } from '@/lib/keywords'
import { buildEventRescheduledSms, buildEventCancelledSms, buildRefundNote } from '@/lib/sms/templates'

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

  if (categoryId) {
    const { data: category } = await supabase
      .from('event_categories')
      .select(`
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
        default_booking_url
      `)
      .eq('id', categoryId)
      .single();

    if (category) {
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
        booking_url: category.default_booking_url
      };
    }
  }

  const rawData = Object.fromEntries(formData.entries());

  const bookingModeInput = rawData.booking_mode
  const bookingMode: CreateEventInput['booking_mode'] =
    bookingModeInput === 'table' || bookingModeInput === 'general' || bookingModeInput === 'mixed'
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
    ...(rawData.payment_mode && ['free', 'cash_only', 'prepaid'].includes(rawData.payment_mode as string)
      ? { payment_mode: rawData.payment_mode as 'free' | 'cash_only' | 'prepaid' }
      : {}),
    booking_mode: bookingMode,
    event_type: (rawData.event_type as string)?.trim() || null,
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
    is_free: rawData.is_free === 'true' || categoryDefaults.is_free || false,
    booking_url: rawData.booking_url as string || categoryDefaults.booking_url || null,
    hero_image_url: rawData.hero_image_url as string || categoryDefaults.hero_image_url || null,
    thumbnail_image_url: rawData.thumbnail_image_url as string || null,
    poster_image_url: rawData.poster_image_url as string || null,
    promo_video_url: rawData.promo_video_url as string || categoryDefaults.promo_video_url || null,
    highlight_video_urls: rawData.highlight_video_urls ? JSON.parse(rawData.highlight_video_urls as string) : categoryDefaults.highlight_video_urls || [],
    gallery_image_urls: rawData.gallery_image_urls ? JSON.parse(rawData.gallery_image_urls as string) : categoryDefaults.gallery_image_urls || []
  };

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

// ─── Reschedule Notification Dispatch (fire-and-forget) ─────────────────────

function formatLondonDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return 'your event time'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(isoDateTime))
  } catch {
    return 'your event time'
  }
}

async function dispatchRescheduleNotifications(params: {
  eventId: string
  eventName: string
  oldDate: string | null
  oldTime: string | null
  newDate: string
  newTime: string
  userId: string
}): Promise<void> {
  const { eventId, eventName, oldDate, oldTime, newDate, newTime, userId } = params
  const db = createAdminClient()

  // 1. Query affected bookings with customer data
  const { data: bookings, error } = await db
    .from('bookings')
    .select('id, customer_id, seats, status, customers!inner(id, first_name, mobile_number, sms_status)')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending_payment'])

  if (error || !bookings || bookings.length === 0) return

  // 2. Compute new formatted datetime for SMS
  const newStartIso = `${newDate}T${newTime || '00:00'}:00`
  const formattedNewDate = formatLondonDateTime(newStartIso)

  // 3. Recalculate hold_expires_at for pending-payment bookings (D10)
  const pendingBookingIds = bookings
    .filter(b => b.status === 'pending_payment')
    .map(b => b.id)

  if (pendingBookingIds.length > 0) {
    const newStartDatetime = new Date(newStartIso).toISOString()

    // Update bookings.hold_expires_at — only extend, don't shorten past the 24h window
    await db
      .from('bookings')
      .update({ hold_expires_at: newStartDatetime })
      .in('id', pendingBookingIds)
      .lt('hold_expires_at', newStartDatetime)

    // Update booking_holds.expires_at
    await db
      .from('booking_holds')
      .update({ expires_at: newStartDatetime })
      .in('event_booking_id', pendingBookingIds)
      .eq('status', 'active')
  }

  // 4. Send reschedule SMS in batches of 20
  const BATCH_SIZE = 20
  const smsTargets = bookings.filter(b => {
    const customer = b.customers as unknown as {
      id: string
      first_name: string | null
      mobile_number: string | null
      sms_status: string | null
    }
    return customer?.sms_status === 'active' && customer?.mobile_number
  })

  for (let i = 0; i < smsTargets.length; i += BATCH_SIZE) {
    const batch = smsTargets.slice(i, i + BATCH_SIZE)

    await Promise.allSettled(
      batch.map(async (booking) => {
        const customer = booking.customers as unknown as {
          id: string
          first_name: string | null
          mobile_number: string | null
          sms_status: string | null
        }

        // Generate fresh manage-booking token
        let manageLink: string | null = null
        try {
          const manageToken = await createEventManageToken(db, {
            customerId: customer.id,
            bookingId: booking.id,
            eventStartIso: newStartIso,
            appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || ''
          })
          manageLink = manageToken.url
        } catch {
          // Non-fatal: send SMS without manage link
        }

        const smsBody = buildEventRescheduledSms({
          firstName: customer.first_name,
          eventName,
          newDate: formattedNewDate,
          seats: booking.seats || 1,
          manageLink
        })

        await sendSMS(customer.mobile_number!, smsBody, {
          customerId: customer.id,
          metadata: {
            template_key: 'event_rescheduled',
            event_id: eventId,
            event_booking_id: booking.id,
            old_date: oldDate,
            new_date: newDate
          }
        })
      })
    )

    // Throttle between batches
    if (i + BATCH_SIZE < smsTargets.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // 5. Audit log for reschedule notification dispatch
  await logAuditEvent({
    user_id: userId,
    operation_type: 'reschedule',
    resource_type: 'event',
    resource_id: eventId,
    operation_status: 'success',
    additional_info: {
      old_date: oldDate,
      old_time: oldTime,
      new_date: newDate,
      new_time: newTime,
      bookings_notified: smsTargets.length,
      total_bookings_affected: bookings.length
    }
  })
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

    // Detect date/time change and dispatch reschedule notifications asynchronously
    const newDate = validationResult.data.date
    const newTime = validationResult.data.time
    const dateChanged =
      (newDate && newDate !== _oldDate) || (newTime && newTime !== _oldTime)

    if (dateChanged) {
      void dispatchRescheduleNotifications({
        eventId: id,
        eventName: event.name || _oldName || 'your event',
        oldDate: _oldDate,
        oldTime: _oldTime,
        newDate: newDate || _oldDate || '',
        newTime: newTime || _oldTime || '',
        userId: user.id,
      }).catch((err) => {
        logger.error('Failed to dispatch reschedule notifications', {
          error: err instanceof Error ? err : new Error(String(err)),
          metadata: { eventId: id },
        })
      })
    }

    // Detect cancellation and run cascade synchronously
    const statusChangedToCancelled =
      validationResult.data.event_status === 'cancelled' && _oldStatus !== 'cancelled'

    if (statusChangedToCancelled) {
      const db = createAdminClient()
      const cascadeResult = await EventService.cancelEventBookings({
        eventId: id,
        eventName: validationResult.data.name || _oldName || 'Event',
        eventDate: _oldDate || validationResult.data.date || '',
        eventTime: _oldTime || validationResult.data.time || '',
        cancelledBy: user.id,
        supabase: db
      })

      await logAuditEvent({
        user_id: user.id,
        operation_type: 'cancel_event',
        resource_type: 'event',
        resource_id: id,
        operation_status: 'success',
        additional_info: cascadeResult
      })
    }

    revalidatePath('/events');
    revalidatePath(`/events/${id}`);
    revalidateTag('dashboard')
    return { success: true, data: event as Event, warning: marketingLinksWarning || undefined };
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
    const [canManageEvents, { data: { user }, error: authError }] = await Promise.all([
      checkUserPermission('events', 'manage'),
      supabase.auth.getUser(),
    ]);

    if (!canManageEvents) {
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
}): Promise<{ data?: Event[], pagination?: { totalCount: number, currentPage: number, pageSize: number, totalPages: number }, error?: string }> {
  try {
    const { events, pagination } = await EventService.getEvents(options);
    return { data: events, pagination };
  } catch (error: unknown) {
    logger.error('Error fetching events', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error, 'Failed to fetch events') };
  }
}

const createEventManualBookingSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().trim().min(7).max(32),
  defaultCountryCode: z.string().regex(/^\d{1,4}$/).optional(),
  seats: z.number().int().min(1).max(20),
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
    }
    meta?: {
      sms: SmsSafetyMeta
    }
  }

export async function createEventManualBooking(input: {
  eventId: string
  phone: string
  seats: number
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
          table_name: null
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
      // The old admin action swallowed payment link failures and continued with
      // null URL. The service treats this as a hard failure. To preserve the
      // admin UX of still showing the booking, we log and continue.
      logger.warn('Admin booking: payment link generation failed, continuing with null URL', {
        metadata: { bookingId: result.bookingId, eventId: parsed.data.eventId }
      })
    }

    const { resolvedState, resolvedReason, bookingId, nextStepUrl, manageUrl, tableBookingId, tableName, smsMeta } = result

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
          table_name: null
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
          state: resolvedState,
          source: 'admin'
        }
      })
    }

    revalidatePath(`/events/${parsed.data.eventId}`)
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')

    return {
      success: true,
      data: {
        state: resolvedState,
        reason: resolvedReason,
        booking_id: bookingId,
        manage_booking_url: manageUrl,
        next_step_url: nextStepUrl,
        table_booking_id: tableBookingId,
        table_name: tableName
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
}): string {
  if (input.isReminderOnly) {
    return `The Anchor: ${input.firstName}, your reminder guest entry for ${input.eventName} on ${input.eventStartText} has been removed. Reply if you need help rejoining.`
  }

  const seatWord = input.seats === 1 ? 'seat' : 'seats'
  return `The Anchor: ${input.firstName}, your booking for ${input.eventName} on ${input.eventStartText} has been cancelled (${input.seats} ${seatWord}). Reply if you need help rebooking.`
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
        event:events(id, name, start_datetime, date, time),
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
          sms_sent: false
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
          sms_sent: false
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
          isReminderOnly: bookingRow.is_reminder_only === true
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
          sms_sent: smsSent
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

    return {
      success: true,
      data: {
        state: 'cancelled',
        reason: null,
        booking_id: bookingRow.id,
        sms_sent: smsSent
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
