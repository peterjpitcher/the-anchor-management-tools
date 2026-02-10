'use server'

import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { logAuditEvent } from './audit'
import type { Event, EventFAQ } from '@/types/database'
import { checkUserPermission } from '@/app/actions/rbac'
import { EventService, eventSchema, CreateEventInput, UpdateEventInput } from '@/services/events'
import { createClient } from '@/lib/supabase/server' // Required for getting user in action
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { createEventManageToken, updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import {
  createEventPaymentToken,
  sendEventBookingSeatUpdateSms
} from '@/lib/events/event-payments'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'

type CreateEventResult = { error: string } | { success: true; data: Event }
type EventFaqInput = NonNullable<CreateEventInput['faqs']>[number]
type PreparedEventData = Partial<CreateEventInput> & { faqs: EventFaqInput[] }

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
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
        brief,
        highlights,
        keywords,
        meta_title,
        meta_description,
        image_url,
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
    capacity: null,
    booking_mode: bookingMode,
    event_type: (rawData.event_type as string)?.trim() || null,
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
  let faqs: EventFaqInput[] = [];
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
  data.faqs = faqs;

  return data as PreparedEventData;
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true, data: event as Event };
  } catch (error: unknown) {
    console.error('Unexpected error creating event:', error);
    return { error: getErrorMessage(error, 'An unexpected error occurred') };
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true, data: event as Event };
  } catch (error: unknown) {
    console.error('Unexpected error updating event:', error);
    return { error: getErrorMessage(error, 'An unexpected error occurred') };
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true };
  } catch (error: unknown) {
    console.error('Unexpected error deleting event:', error);
    return { error: getErrorMessage(error, 'An unexpected error occurred') };
  }
}

export async function getEventFAQs(eventId: string): Promise<{ data?: EventFAQ[], error?: string }> {
  try {
    const data = await EventService.getEventFAQs(eventId);
    return { data };
  } catch (error: unknown) {
    console.error('Error fetching event FAQs:', error);
    return { error: getErrorMessage(error, 'Failed to fetch FAQs') };
  }
}

export async function getEventById(eventId: string): Promise<{ data?: Event | null, error?: string }> {
  try {
    const data = await EventService.getEventById(eventId);
    return { data };
  } catch (error: unknown) {
    console.error('Error fetching event by ID:', error);
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
    console.error('Error fetching events:', error);
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
    }

type CreateEventBookingRpcResult = {
  state?: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
  reason?: string
  booking_id?: string
  hold_expires_at?: string | null
  event_start_datetime?: string | null
  payment_mode?: 'free' | 'cash_only' | 'prepaid'
}

type CreateEventTableReservationRpcResult = {
  state?: 'confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  table_name?: string
}

async function rollbackEventBookingForTableFailure(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<void> {
  const nowIso = new Date().toISOString()
  await Promise.allSettled([
    (supabase.from('bookings') as any)
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'system',
        updated_at: nowIso
      })
      .eq('id', bookingId),
    (supabase.from('booking_holds') as any)
      .update({
        status: 'released',
        released_at: nowIso,
        updated_at: nowIso
      })
      .eq('event_booking_id', bookingId)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active')
  ])
}

function normalizeEventBookingMode(value: unknown): 'table' | 'general' | 'mixed' {
  if (value === 'general' || value === 'mixed' || value === 'table') {
    return value
  }
  return 'table'
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

    const { data: eventRow, error: eventError } = await supabase
      .from('events')
      .select('id, name, booking_mode')
      .eq('id', parsed.data.eventId)
      .maybeSingle()

    if (eventError || !eventRow) {
      return { error: 'Event not found.' }
    }

    const bookingMode = normalizeEventBookingMode((eventRow as any).booking_mode)

    const { data: bookingRpcRaw, error: bookingRpcError } = await supabase.rpc('create_event_booking_v05', {
      p_event_id: parsed.data.eventId,
      p_customer_id: customerResolution.customerId,
      p_seats: parsed.data.seats,
      p_source: 'admin'
    })

    if (bookingRpcError) {
      if ((bookingRpcError as { code?: string }).code === '23505') {
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
      console.error('create_event_booking_v05 failed in createEventManualBooking:', bookingRpcError)
      return { error: 'Failed to create booking.' }
    }

    const bookingResult = (bookingRpcRaw || {}) as CreateEventBookingRpcResult
    const state = bookingResult.state || 'blocked'
    const bookingId = bookingResult.booking_id || null
    let reason = bookingResult.reason || null
    let manageBookingUrl: string | null = null
    let nextStepUrl: string | null = null
    let tableBookingId: string | null = null
    let tableName: string | null = null

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    if (
      (state === 'confirmed' || state === 'pending_payment') &&
      bookingId &&
      bookingResult.event_start_datetime
    ) {
      try {
        const manageToken = await createEventManageToken(supabase, {
          customerId: customerResolution.customerId,
          bookingId,
          eventStartIso: bookingResult.event_start_datetime,
          appBaseUrl
        })
        manageBookingUrl = manageToken.url
      } catch (tokenError) {
        console.error('Failed to create event manage token:', tokenError)
      }
    }

    if (
      state === 'pending_payment' &&
      bookingId &&
      bookingResult.hold_expires_at
    ) {
      try {
        const paymentToken = await createEventPaymentToken(supabase, {
          customerId: customerResolution.customerId,
          bookingId,
          holdExpiresAt: bookingResult.hold_expires_at,
          appBaseUrl
        })
        nextStepUrl = paymentToken.url
      } catch (tokenError) {
        console.error('Failed to create event payment token:', tokenError)
      }
    }

    if (state === 'confirmed' && bookingId && bookingMode !== 'general') {
      const { data: tableRpcRaw, error: tableRpcError } = await supabase.rpc(
        'create_event_table_reservation_v05',
        {
          p_event_id: parsed.data.eventId,
          p_event_booking_id: bookingId,
          p_customer_id: customerResolution.customerId,
          p_party_size: parsed.data.seats,
          p_source: 'admin',
          p_notes: `Event booking ${bookingId}`
        }
      )

      const tableResult = (tableRpcRaw || {}) as CreateEventTableReservationRpcResult
      if (tableRpcError || tableResult.state !== 'confirmed') {
        await rollbackEventBookingForTableFailure(supabase, bookingId)
        reason = tableResult.reason || 'no_table'
        revalidatePath(`/events/${parsed.data.eventId}`)
        return {
          success: true,
          data: {
            state: 'blocked',
            reason,
            booking_id: null,
            manage_booking_url: null,
            next_step_url: null,
            table_booking_id: null,
            table_name: null
          }
        }
      }

      tableBookingId = tableResult.table_booking_id || null
      tableName = tableResult.table_name || null
    }

    if (state === 'confirmed' || state === 'pending_payment') {
      let smsSent = false
      if (bookingId) {
        try {
          const smsBody = ensureReplyInstruction(
            buildEventBookingCreatedSms({
              state,
              firstName: parsed.data.firstName?.trim() || 'there',
              eventName: (eventRow as any).name || 'your event',
              seats: parsed.data.seats,
              eventStartText: formatEventDateTimeForSms({
                startDatetime: bookingResult.event_start_datetime ?? null
              }),
              paymentMode: bookingResult.payment_mode,
              paymentLink: nextStepUrl,
              manageLink: manageBookingUrl
            }),
            process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
          )

          const smsResult = await sendSMS(normalizedPhone, smsBody, {
            customerId: customerResolution.customerId,
            metadata: {
              event_booking_id: bookingId,
              event_id: parsed.data.eventId,
              template_key: state === 'pending_payment' ? 'event_booking_pending_payment' : 'event_booking_confirmed'
            }
          })

          smsSent = smsResult.success === true
          if (!smsResult.success) {
            console.error('Failed to send event booking confirmation SMS:', smsResult.error)
          }
        } catch (smsError) {
          console.error('Unexpected error sending event booking confirmation SMS:', smsError)
        }
      }

      await recordAnalyticsEvent(supabase, {
        customerId: customerResolution.customerId,
        eventType: 'event_booking_created',
        eventBookingId: bookingId || undefined,
        metadata: {
          event_id: parsed.data.eventId,
          event_name: (eventRow as any).name || null,
          seats: parsed.data.seats,
          state,
          source: 'admin',
          sms_sent: smsSent
        }
      })
    }

    revalidatePath(`/events/${parsed.data.eventId}`)
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')

    return {
      success: true,
      data: {
        state,
        reason,
        booking_id: bookingId,
        manage_booking_url: manageBookingUrl,
        next_step_url: nextStepUrl,
        table_booking_id: tableBookingId,
        table_name: tableName
      }
    }
  } catch (error) {
    console.error('Unexpected createEventManualBooking error:', error)
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

function buildEventBookingCreatedSms(input: {
  state: 'confirmed' | 'pending_payment'
  firstName: string
  eventName: string
  seats: number
  eventStartText: string
  paymentMode?: 'free' | 'cash_only' | 'prepaid'
  paymentLink?: string | null
  manageLink?: string | null
}): string {
  const seatWord = input.seats === 1 ? 'seat' : 'seats'

  if (input.state === 'pending_payment') {
    if (input.paymentLink) {
      return `The Anchor: Hi ${input.firstName}, we're holding ${input.seats} ${seatWord} for ${input.eventName}. Pay here: ${input.paymentLink}.${input.manageLink ? ` Manage booking: ${input.manageLink}` : ''}`
    }

    return `The Anchor: Hi ${input.firstName}, we're holding ${input.seats} ${seatWord} for ${input.eventName}. Your booking is pending payment and we'll text your payment link shortly.${input.manageLink ? ` Manage booking: ${input.manageLink}` : ''}`
  }

  const confirmedTail = input.paymentMode === 'cash_only'
    ? ' Payment is cash on arrival.'
    : ''

  return `The Anchor: Hi ${input.firstName}, your booking for ${input.eventName} on ${input.eventStartText} is confirmed for ${input.seats} ${seatWord}.${confirmedTail}${input.manageLink ? ` Manage booking: ${input.manageLink}` : ''}`
}

function buildEventBookingCancelledSms(input: {
  firstName: string
  eventName: string
  eventStartText: string
  seats: number
  isReminderOnly: boolean
}): string {
  if (input.isReminderOnly) {
    return `The Anchor: Hi ${input.firstName}, your reminder guest entry for ${input.eventName} on ${input.eventStartText} has been removed. Reply if you need help rejoining.`
  }

  const seatWord = input.seats === 1 ? 'seat' : 'seats'
  return `The Anchor: Hi ${input.firstName}, your booking for ${input.eventName} on ${input.eventStartText} has been cancelled (${input.seats} ${seatWord}). Reply if you need help rebooking.`
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

    const { data: bookingRow, error: bookingError } = await (supabase.from('bookings') as any)
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

    const tableSyncPromise = (supabase.from('table_bookings') as any)
      .update({
        party_size: newSeats,
        committed_party_size: newSeats,
        updated_at: new Date().toISOString()
      })
      .eq('event_booking_id', updateResult.booking_id)
      .not('status', 'in', '(cancelled,no_show)')

    const analyticsPromise =
      delta !== 0 && bookingRow.event_id && updateResult.customer_id
        ? recordAnalyticsEvent(supabase, {
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
          })
        : Promise.resolve()

    await Promise.allSettled([
      tableSyncPromise,
      analyticsPromise
    ])

    let smsSent = false
    if (parsed.data.sendSms !== false && delta !== 0) {
      try {
        smsSent = await sendEventBookingSeatUpdateSms(supabase, {
          bookingId: updateResult.booking_id,
          eventName: updateResult.event_name || null,
          oldSeats,
          newSeats,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        })
      } catch (smsError) {
        console.error('Failed to send seat update SMS:', smsError)
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
      }
    }
  } catch (error) {
    console.error('Unexpected updateEventManualBookingSeats error:', error)
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
    const { data: bookingRow, error: bookingError } = await (supabase.from('bookings') as any)
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
    const { error: cancelError } = await (supabase.from('bookings') as any)
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'admin',
        updated_at: nowIso
      })
      .eq('id', bookingRow.id)

    if (cancelError) {
      return { error: cancelError.message || 'Failed to cancel booking.' }
    }

    await Promise.allSettled([
      (supabase.from('booking_holds') as any)
        .update({
          status: 'released',
          released_at: nowIso,
          updated_at: nowIso
        })
        .eq('event_booking_id', bookingRow.id)
        .eq('status', 'active'),
      (supabase.from('table_bookings') as any)
        .update({
          status: 'cancelled',
          cancellation_reason: 'event_booking_cancelled_admin',
          cancelled_at: nowIso,
          updated_at: nowIso
        })
        .eq('event_booking_id', bookingRow.id)
        .not('status', 'in', '(cancelled,no_show)')
    ])

    const eventRecord = Array.isArray(bookingRow.event) ? bookingRow.event[0] : bookingRow.event
    const customerRecord = Array.isArray(bookingRow.customer) ? bookingRow.customer[0] : bookingRow.customer

    let smsSent = false
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
          firstName: customerRecord.first_name || 'there',
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

      const smsResult = await sendSMS(customerRecord.mobile_number, smsBody, {
        customerId: customerRecord.id,
        metadata: {
          event_booking_id: bookingRow.id,
          event_id: bookingRow.event_id,
          template_key: 'event_booking_cancelled_admin'
        }
      })

      smsSent = smsResult.success === true
    }

    if (bookingRow.customer_id) {
      await recordAnalyticsEvent(supabase, {
        customerId: bookingRow.customer_id,
        eventBookingId: bookingRow.id,
        eventType: 'event_booking_cancelled',
        metadata: {
          event_id: bookingRow.event_id,
          seats: bookingRow.seats,
          source: 'admin',
          sms_sent: smsSent
        }
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
      }
    }
  } catch (error) {
    console.error('Unexpected cancelEventManualBooking error:', error)
    return { error: getErrorMessage(error, 'Failed to cancel booking.') }
  }
}
