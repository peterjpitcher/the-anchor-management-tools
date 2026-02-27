import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage } from '@/lib/utils';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { SmsQueueService } from '@/services/sms-queue';
import { syncCalendarEvent, deleteCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { logAuditEvent } from '@/app/actions/audit'; // Audit logging will be in action, but helper types needed
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { logger } from '@/lib/logger';
import type {
  BookingStatus,
  BookingItemFormData,
  PrivateBookingWithDetails,
  PrivateBookingAuditWithUser
} from '@/types/private-bookings';
import { z } from 'zod'; // Import z for schemas

type PrivateBookingSmsSideEffectSummary = {
  triggerType: string
  templateKey: string
  queueId?: string
  sent?: boolean
  suppressed?: boolean
  requiresApproval?: boolean
  code?: string | null
  logFailure?: boolean
  error?: string
}

type NormalizedSmsSafetyMeta = {
  code: string | null
  logFailure: boolean
  fatal: boolean
}

function normalizeSmsSafetyMeta(result: any): NormalizedSmsSafetyMeta {
  const code = typeof result?.code === 'string' ? result.code : null
  const logFailure = result?.logFailure === true || code === 'logging_failed'
  const fatal = logFailure || code === 'safety_unavailable' || code === 'idempotency_conflict'
  return { code, logFailure, fatal }
}

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

function sanitizeBookingSearchTerm(value: string): string {
  return value
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// Helper function to format time to HH:MM
export function formatTimeToHHMM(time: string | undefined): string | undefined {
  if (!time) return undefined

  // If time is already in correct format, return it
  if (/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    return time
  }

  // Parse and format time
  const [hours, minutes] = time.split(':')
  const formattedHours = hours.padStart(2, '0')
  const formattedMinutes = (minutes || '00').padStart(2, '0')

  return `${formattedHours}:${formattedMinutes}`
}

// Time validation schema
const timeSchema = z.string().regex(
  /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
  'Time must be in HH:MM format (24-hour)'
)

// Private booking validation schema
export const privateBookingSchema = z.object({
  customer_first_name: z.string().min(1, 'First name is required'),
  customer_last_name: z.string().optional(),
  customer_id: z.string().uuid().optional().nullable(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email('Invalid email format').optional().or(z.literal('')),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  start_time: timeSchema.optional(),
  setup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  setup_time: timeSchema.optional().or(z.literal('')),
  end_time: timeSchema.optional().or(z.literal('')),
  guest_count: z.number().min(0, 'Guest count cannot be negative').optional(),
  event_type: z.string().optional(),
  internal_notes: z.string().optional(),
  contract_note: z.string().optional(),
  customer_requests: z.string().optional(),
  special_requirements: z.string().optional(),
  accessibility_needs: z.string().optional(),
  source: z.string().optional(),
  deposit_amount: z.number().min(0).optional(),
  balance_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  hold_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  status: z.enum(['draft', 'confirmed', 'completed', 'cancelled']).optional()
})

export const bookingNoteSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Please enter a note before saving.')
    .max(2000, 'Notes are limited to 2000 characters.')
});

export const DATE_TBD_NOTE = 'Event date/time to be confirmed';
export const DEFAULT_TBD_TIME = '12:00';

export const ALLOWED_VENDOR_TYPES = [
  'dj', 'band', 'photographer', 'florist', 'decorator', 'cake', 'entertainment',
  'transport', 'equipment', 'other'
] as const;

export const STORAGE_TYPES = ['ambient', 'chilled', 'frozen', 'dry', 'other'] as const;

export type CreatePrivateBookingInput = {
  customer_first_name: string;
  customer_last_name?: string;
  customer_id?: string | null;
  default_country_code?: string;
  contact_phone?: string;
  contact_email?: string;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  setup_date?: string;
  setup_time?: string;
  guest_count?: number;
  event_type?: string;
  internal_notes?: string;
  contract_note?: string;
  customer_requests?: string;
  special_requirements?: string;
  accessibility_needs?: string;
  source?: string;
  deposit_amount?: number;
  balance_due_date?: string;
  hold_expiry?: string;
  status?: string;
  created_by?: string;
  date_tbd?: boolean;
  items?: BookingItemFormData[];
};

export type UpdatePrivateBookingInput = Partial<CreatePrivateBookingInput> & {
  status?: BookingStatus;
};

export class PrivateBookingService {
  static async createBooking(input: CreatePrivateBookingInput) {
    const supabase = await createClient();

    const DATE_TBD_NOTE = 'Event date/time to be confirmed';
    const DEFAULT_TBD_TIME = '12:00';

    // 1. Prepare Data
    const finalEventDate = input.event_date || toLocalIsoDate(new Date());
    const finalStartTime = input.start_time || DEFAULT_TBD_TIME;

    let internalNotes = input.internal_notes;
    if (input.date_tbd) {
      if (!internalNotes) {
        internalNotes = DATE_TBD_NOTE;
      } else if (!internalNotes.includes(DATE_TBD_NOTE)) {
        internalNotes = `${internalNotes}\n${DATE_TBD_NOTE}`;
      }
    }

    // Calculate balance due date if not provided
    let balanceDueDate = input.balance_due_date;
    if (!balanceDueDate && finalEventDate && !input.date_tbd) {
      const d = new Date(finalEventDate);
      d.setDate(d.getDate() - 7);
      balanceDueDate = toLocalIsoDate(d);
    }

    const currentDateTime = new Date();
    const actualEventDate = new Date(finalEventDate);

    let holdExpiryMoment: Date;

    // Logic for Deposit Due Date (Hold Expiry)
    const STANDARD_HOLD_DAYS = 14;
    const SHORT_NOTICE_HOLD_DAYS = 2;

    const sevenDaysBeforeEvent = new Date(actualEventDate);
    sevenDaysBeforeEvent.setDate(sevenDaysBeforeEvent.getDate() - 7);

    if (input.hold_expiry) {
      // User manually specified a date
      holdExpiryMoment = new Date(input.hold_expiry);

      // Standard Rule: Deposit must be >= 7 days before event
      // Exception: If booking is created < 7 days before event (Short Notice)

      const isShortNotice = currentDateTime.getTime() > sevenDaysBeforeEvent.getTime();

      if (!isShortNotice) {
        // For normal bookings, clamp manual date to 7 days before event if it exceeds it
        if (holdExpiryMoment.getTime() > sevenDaysBeforeEvent.getTime()) {
          holdExpiryMoment = sevenDaysBeforeEvent;
        }
      } else {
        // For short notice bookings, clamp to event date if it exceeds it
        if (holdExpiryMoment.getTime() > actualEventDate.getTime()) {
          holdExpiryMoment = actualEventDate;
        }
      }
    } else {
      // Default auto-calculation

      // Check if we are in "Short Notice" territory (booking created less than 7 days before event)
      if (currentDateTime.getTime() > sevenDaysBeforeEvent.getTime()) {
        // Short Notice Logic: 48 hours from now, capped at event start
        const shortNoticeExpiry = new Date(currentDateTime);
        shortNoticeExpiry.setDate(shortNoticeExpiry.getDate() + SHORT_NOTICE_HOLD_DAYS);

        if (shortNoticeExpiry.getTime() > actualEventDate.getTime()) {
          holdExpiryMoment = actualEventDate;
        } else {
          holdExpiryMoment = shortNoticeExpiry;
        }
      } else {
        // Normal Booking Logic: 14 days from now, but NEVER later than 7 days before event
        holdExpiryMoment = new Date(currentDateTime);
        holdExpiryMoment.setDate(holdExpiryMoment.getDate() + STANDARD_HOLD_DAYS);

        if (holdExpiryMoment.getTime() > sevenDaysBeforeEvent.getTime()) {
          holdExpiryMoment = sevenDaysBeforeEvent;
        }
      }
    }

    const holdExpiryIso = holdExpiryMoment.toISOString();

    const normalizedContactPhone =
      input.contact_phone && input.contact_phone.trim() !== ''
        ? formatPhoneForStorage(input.contact_phone.trim(), {
            defaultCountryCode: input.default_country_code
          })
        : null;

    const normalizedContactEmail =
      input.contact_email && input.contact_email.trim() !== ''
        ? input.contact_email.trim().toLowerCase()
        : null;

    // Always resolve customer through the shared lookup-first helper.
    // This keeps phone matching behavior consistent across all booking flows.
    let resolvedCustomerId = input.customer_id ?? null;
    if (!resolvedCustomerId && normalizedContactPhone) {
      const ensured = await ensureCustomerForPhone(createAdminClient(), normalizedContactPhone, {
        firstName: input.customer_first_name,
        lastName: input.customer_last_name?.trim() || undefined,
        email: normalizedContactEmail
      });
      resolvedCustomerId = ensured.customerId;
    }

    if (!resolvedCustomerId) {
      throw new Error('Private booking must include a linked customer (customer_id or contact_phone)');
    }

    const bookingPayload = {
      ...input,
      contact_phone: normalizedContactPhone,
      contact_email: normalizedContactEmail,
      customer_id: resolvedCustomerId,
      event_date: finalEventDate,
      start_time: finalStartTime,
      internal_notes: internalNotes,
      balance_due_date: balanceDueDate,
      hold_expiry: holdExpiryIso, // Use the calculated hold expiry
      customer_name: input.customer_last_name
        ? `${input.customer_first_name} ${input.customer_last_name}`
        : input.customer_first_name,
      deposit_amount: input.deposit_amount ?? 250,
      status: 'draft'
    };

    // 2. Atomic Transaction
    const { data: booking, error } = await supabase.rpc('create_private_booking_transaction', {
      p_booking_data: bookingPayload,
      p_items: input.items || [],
      p_customer_data: null
    });

    if (error) {
      console.error('Create private booking transaction error:', error);
      throw new Error('Failed to create private booking');
    }

    // 3. Side Effects (Fire and Forget / Non-blocking mostly) 

    // SMS
    if (booking) {
      // Ensure booking object passed to sendCreationSms has the calculated hold_expiry
      const bookingWithHoldExpiry = { ...booking, hold_expiry: holdExpiryIso };
      void this.sendCreationSms(bookingWithHoldExpiry, normalizedContactPhone).catch((smsError) => {
        logger.error('Private booking creation SMS background task failed', {
          error: smsError instanceof Error ? smsError : new Error(String(smsError)),
          metadata: { bookingId: booking.id }
        })
      })
    }

    // Google Calendar Sync
    if (booking && isCalendarConfigured()) {
      const isDateTbdBooking = Boolean(booking.internal_notes?.includes(DATE_TBD_NOTE))
      if (!isDateTbdBooking && booking.status !== 'cancelled') {
        // We wait for this as it updates the booking with calendar ID
        try {
          const eventId = await syncCalendarEvent(booking);
          if (eventId) {
            const { data: updatedCalendarRow, error: calendarUpdateError } = await createAdminClient()
              .from('private_bookings')
              .update({ calendar_event_id: eventId })
              .eq('id', booking.id)
              .select('id')
              .maybeSingle();

            if (calendarUpdateError) {
              console.error('Failed to persist calendar_event_id after booking create:', calendarUpdateError);
            } else if (!updatedCalendarRow) {
              console.error('Failed to persist calendar_event_id after booking create: booking row not found');
            }
          }
        } catch (e) {
          console.error('Calendar sync failed:', e);
        }
      }
    }

    return booking;
  }

  static async updateBooking(id: string, input: UpdatePrivateBookingInput, performedByUserId?: string) {
    const supabase = await createClient();
    const DATE_TBD_NOTE = 'Event date/time to be confirmed';
    const DEFAULT_TBD_TIME = '12:00';

    // 1. Get Current Booking
    const { data: currentBooking, error: fetchError } = await supabase
      .from('private_bookings')
      .select(
        'status, contact_phone, customer_first_name, customer_last_name, customer_name, event_date, start_time, setup_date, setup_time, end_time, end_time_next_day, customer_id, internal_notes, balance_due_date, calendar_event_id, hold_expiry, deposit_paid_date'
      )
      .eq('id', id)
      .single();

    if (fetchError || !currentBooking) {
      throw new Error('Booking not found');
    }

    let completedStatusAlreadyMessaged = false;
    if (input.status === 'completed' && currentBooking.status !== 'completed') {
      const admin = createAdminClient();
      const { count, error: duplicateCheckError } = await admin
        .from('private_booking_sms_queue')
        .select('*', { count: 'exact', head: true })
        .eq('booking_id', id)
        .eq('trigger_type', 'booking_completed')
        .in('status', ['pending', 'approved', 'sent']);

      if (duplicateCheckError) {
        console.error('Failed to verify completed-booking SMS duplicate guard:', duplicateCheckError);
        throw new Error('Failed completed-booking SMS duplicate safety check');
      }

      completedStatusAlreadyMessaged = (count ?? 0) > 0;
    }

    // 2. Prepare Updates
    const finalEventDate = input.event_date || currentBooking.event_date || toLocalIsoDate(new Date());

    // Check if event date changed and booking is in draft to reset hold
    let holdExpiryIso = undefined;
    const dateChanged = input.event_date && input.event_date !== currentBooking.event_date;

    if (dateChanged && currentBooking.status === 'draft') {
      const currentDateTime = new Date();
      const newEventDate = input.event_date ? new Date(input.event_date) : new Date(finalEventDate);
      let holdExpiryMoment: Date;

      const STANDARD_HOLD_DAYS = 14;
      const SHORT_NOTICE_HOLD_DAYS = 2;

      const sevenDaysBeforeEvent = new Date(newEventDate);
      sevenDaysBeforeEvent.setDate(sevenDaysBeforeEvent.getDate() - 7);

      // Check if we are in "Short Notice" territory
      if (currentDateTime.getTime() > sevenDaysBeforeEvent.getTime()) {
        // Short Notice Logic: 48 hours from now, capped at event start
        const shortNoticeExpiry = new Date(currentDateTime);
        shortNoticeExpiry.setDate(shortNoticeExpiry.getDate() + SHORT_NOTICE_HOLD_DAYS);

        if (shortNoticeExpiry.getTime() > newEventDate.getTime()) {
          holdExpiryMoment = newEventDate;
        } else {
          holdExpiryMoment = shortNoticeExpiry;
        }
      } else {
        // Normal Booking Logic: 14 days from now, but NEVER later than 7 days before event
        holdExpiryMoment = new Date(currentDateTime);
        holdExpiryMoment.setDate(holdExpiryMoment.getDate() + STANDARD_HOLD_DAYS);

        if (holdExpiryMoment.getTime() > sevenDaysBeforeEvent.getTime()) {
          holdExpiryMoment = sevenDaysBeforeEvent;
        }
      }

      holdExpiryIso = holdExpiryMoment.toISOString();
    }

    const finalStartTime = input.start_time || currentBooking.start_time || DEFAULT_TBD_TIME;

    let endTimeNextDay = currentBooking.end_time_next_day ?? false;
    const cleanedEndTime = input.end_time || (input.end_time === '' ? null : undefined); // Allow clearing if empty string passed

    if (cleanedEndTime) {
      const [startHour, startMin] = finalStartTime.split(':').map(Number);
      const [endHour, endMin] = cleanedEndTime.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      endTimeNextDay = endMinutes <= startMinutes;
    } else if (cleanedEndTime === null) {
      endTimeNextDay = false;
    }

    let internalNotes = input.internal_notes ?? currentBooking.internal_notes ?? null;

    if (input.date_tbd) {
      if (!internalNotes) {
        internalNotes = DATE_TBD_NOTE;
      } else if (!internalNotes.includes(DATE_TBD_NOTE)) {
        internalNotes = `${internalNotes}\n${DATE_TBD_NOTE}`;
      }
    } else if (input.date_tbd === false && internalNotes?.includes(DATE_TBD_NOTE)) {
      internalNotes =
        internalNotes
          .split('\n')
          .filter((line: string) => line.trim() !== DATE_TBD_NOTE)
          .join('\n')
          .trim() || null;
    }

    const normalizedContactPhone =
      input.contact_phone === undefined
        ? undefined
        : input.contact_phone.trim() === ''
          ? null
          : formatPhoneForStorage(input.contact_phone.trim(), {
              defaultCountryCode: input.default_country_code
            });

    const normalizedContactEmail =
      input.contact_email === undefined
        ? undefined
        : input.contact_email.trim() === ''
          ? null
          : input.contact_email.trim().toLowerCase();

    const normalizedSetupDate =
      input.setup_date === undefined
        ? undefined
        : input.setup_date.trim() === ''
          ? null
          : input.setup_date;

    const normalizedSetupTime =
      input.setup_time === undefined
        ? undefined
        : input.setup_time.trim() === ''
          ? null
          : input.setup_time;

    const customer_name = input.customer_last_name
      ? `${input.customer_first_name} ${input.customer_last_name}`
      : input.customer_first_name || undefined;

    const updatePayload: any = {
      ...input,
      customer_name, // undefined if not provided
      contact_phone: normalizedContactPhone,
      contact_email: normalizedContactEmail,
      event_date: finalEventDate,
      start_time: finalStartTime,
      setup_date: normalizedSetupDate,
      setup_time: normalizedSetupTime,
      end_time: cleanedEndTime, // can be null to clear
      end_time_next_day: endTimeNextDay,
      internal_notes: internalNotes,
      hold_expiry: holdExpiryIso,
      updated_at: new Date().toISOString()
    };

    // Remove non-column fields
    delete updatePayload.date_tbd;
    delete updatePayload.items;
    delete updatePayload.default_country_code;

    if (input.date_tbd) {
      updatePayload.balance_due_date = null;
    }

    // Clean up undefined values
    Object.keys(updatePayload).forEach(key => updatePayload[key] === undefined && delete updatePayload[key]);

    // 3. Perform Update
    const { data: updatedBooking, error } = await supabase
      .from('private_bookings')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error updating private booking:', error);
      throw new Error('Failed to update private booking');
    }

    if (!updatedBooking) {
      throw new Error('Booking not found');
    }

    const smsSideEffects: Array<{
      triggerType: string
      templateKey: string
      queueId?: string
      sent?: boolean
      suppressed?: boolean
      requiresApproval?: boolean
      code?: string | null
      logFailure?: boolean
      error?: string
    }> = []

    let abortSmsSideEffects = false

    const captureSmsSideEffect = (triggerType: string, templateKey: string, result: any) => {
      const safety = normalizeSmsSafetyMeta(result)
      const summary = {
        triggerType,
        templateKey,
        queueId: typeof result?.queueId === 'string' ? result.queueId : undefined,
        sent: result?.sent === true,
        suppressed: result?.suppressed === true,
        requiresApproval: result?.requiresApproval === true,
        code: safety.code,
        logFailure: safety.logFailure,
        error: typeof result?.error === 'string' ? result.error : undefined
      }

      smsSideEffects.push(summary)

      if (safety.fatal) {
        abortSmsSideEffects = true
      }

      if (summary.logFailure) {
        logger.error('Private booking SMS logging failed', {
          metadata: {
            bookingId: id,
            triggerType,
            templateKey,
            code: summary.code
          }
        })
      }

      if (summary.error) {
        logger.error('Private booking SMS queue/send failed', {
          metadata: {
            bookingId: id,
            triggerType,
            templateKey,
            error: summary.error
          }
        })
      }
    }

    // 4. Side Effects

    // Send Date Change SMS if hold was reset
    if (!abortSmsSideEffects && holdExpiryIso && updatedBooking.status === 'draft') {
      const eventDateReadable = new Date(updatedBooking.event_date).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      const expiryDate = new Date(holdExpiryIso);
      const expiryReadable = expiryDate.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long'
      });

      const smsMessage = `The Anchor: Hi ${updatedBooking.customer_first_name}, we've moved your tentative booking to ${eventDateReadable}. We've updated the hold on this date, so your deposit is now due by ${expiryReadable}.`;

      const result = await SmsQueueService.queueAndSend({
        booking_id: updatedBooking.id,
        trigger_type: 'date_changed',
        template_key: 'private_booking_date_changed',
        message_body: smsMessage,
        customer_phone: updatedBooking.contact_phone,
        customer_name: updatedBooking.customer_name,
        customer_id: updatedBooking.customer_id,
        created_by: performedByUserId,
        priority: 2,
        metadata: {
          template: 'private_booking_date_changed',
          new_date: eventDateReadable,
          new_expiry: expiryReadable
        }
      })
      captureSmsSideEffect('date_changed', 'private_booking_date_changed', result)
    }

    const statusChanged = updatedBooking.status && updatedBooking.status !== currentBooking.status;

    // Setup reminder (confirmed bookings)
    const setupDateChanged = input.setup_date !== undefined && input.setup_date !== currentBooking.setup_date;
    const setupTimeChanged = input.setup_time !== undefined && input.setup_time !== currentBooking.setup_time;
    const shouldSendSetupReminder =
      updatedBooking.status === 'confirmed' &&
      Boolean(updatedBooking.setup_time) &&
      (setupDateChanged || setupTimeChanged);

    if (!abortSmsSideEffects && shouldSendSetupReminder) {
      const eventDateReadable = new Date(updatedBooking.event_date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const setupTimeReadable = updatedBooking.setup_time
        ? new Date(`1970-01-01T${updatedBooking.setup_time}`).toLocaleTimeString('en-GB', {
            hour: 'numeric',
            minute: '2-digit'
          })
        : '';

      const firstName =
        updatedBooking.customer_first_name || updatedBooking.customer_name?.split(' ')[0] || 'there';

      const messageBody = `The Anchor: Hi ${firstName}, confirming setup for your event on ${eventDateReadable}. Your vendors/team can access the venue from ${setupTimeReadable}.`;

      const result = await SmsQueueService.queueAndSend({
        booking_id: updatedBooking.id,
        trigger_type: 'setup_reminder',
        template_key: 'private_booking_setup_reminder',
        message_body: messageBody,
        customer_phone: updatedBooking.contact_phone,
        customer_name:
          updatedBooking.customer_name ||
          `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
        customer_id: updatedBooking.customer_id,
        created_by: performedByUserId,
        priority: 2,
        metadata: {
          template: 'private_booking_setup_reminder',
          event_date: eventDateReadable,
          setup_time: updatedBooking.setup_time ?? null,
          setup_date: updatedBooking.setup_date ?? null
        }
      })
      captureSmsSideEffect('setup_reminder', 'private_booking_setup_reminder', result)
    }

    // Status change messages (e.g. status modal)
    if (statusChanged) {
      const eventDateReadable = new Date(updatedBooking.event_date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const firstName =
        updatedBooking.customer_first_name || updatedBooking.customer_name?.split(' ')[0] || 'there';

      if (updatedBooking.status === 'confirmed' && updatedBooking.customer_id) {
        try {
          const adminClient = createAdminClient();
          await recordAnalyticsEvent(adminClient, {
            customerId: updatedBooking.customer_id,
            privateBookingId: updatedBooking.id,
            eventType: 'private_booking_confirmed',
            metadata: {
              via: 'private_booking_status_change',
              event_type: updatedBooking.event_type ?? null
            }
          });
        } catch (analyticsError) {
          console.error('Failed to record private booking confirmation analytics:', analyticsError);
        }
      }

      if (!abortSmsSideEffects && updatedBooking.status === 'confirmed' && !updatedBooking.deposit_paid_date) {
        const eventType = updatedBooking.event_type || 'event';
        const messageBody = `The Anchor: Hi ${firstName}, your private event booking at The Anchor on ${eventDateReadable} has been confirmed. We look forward to hosting your ${eventType}.`;

        const result = await SmsQueueService.queueAndSend({
          booking_id: updatedBooking.id,
          trigger_type: 'booking_confirmed',
          template_key: 'private_booking_confirmed',
          message_body: messageBody,
          customer_phone: updatedBooking.contact_phone,
          customer_name:
            updatedBooking.customer_name ||
            `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
          customer_id: updatedBooking.customer_id,
          created_by: performedByUserId,
          priority: 1,
          metadata: {
            template: 'private_booking_confirmed',
            event_date: eventDateReadable,
            event_type: updatedBooking.event_type ?? null
          }
        })
        captureSmsSideEffect('booking_confirmed', 'private_booking_confirmed', result)
      }

      if (!abortSmsSideEffects && updatedBooking.status === 'cancelled') {
        const messageBody = `The Anchor: Hi ${firstName}, your private booking on ${eventDateReadable} has been cancelled.`;

        const result = await SmsQueueService.queueAndSend({
          booking_id: updatedBooking.id,
          trigger_type: 'booking_cancelled',
          template_key: 'private_booking_cancelled',
          message_body: messageBody,
          customer_phone: updatedBooking.contact_phone,
          customer_name:
            updatedBooking.customer_name ||
            `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
          customer_id: updatedBooking.customer_id,
          created_by: performedByUserId,
          priority: 2,
          metadata: {
            template: 'private_booking_cancelled',
            event_date: eventDateReadable,
            reason: 'status_change'
          }
        })
        captureSmsSideEffect('booking_cancelled', 'private_booking_cancelled', result)
      }

      if (!abortSmsSideEffects && updatedBooking.status === 'completed' && !completedStatusAlreadyMessaged) {
        const messageBody = `The Anchor: Hi ${firstName}, thank you for choosing The Anchor for your event. We hope you and your guests had a wonderful time. We'd love to welcome you back again soon.`;

        const result = await SmsQueueService.queueAndSend({
          booking_id: updatedBooking.id,
          trigger_type: 'booking_completed',
          template_key: 'private_booking_thank_you',
          message_body: messageBody,
          customer_phone: updatedBooking.contact_phone,
          customer_name:
            updatedBooking.customer_name ||
            `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
          customer_id: updatedBooking.customer_id,
          created_by: performedByUserId,
          priority: 4,
          metadata: {
            template: 'private_booking_thank_you',
            event_date: eventDateReadable
          }
        })
        captureSmsSideEffect('booking_completed', 'private_booking_thank_you', result)
      }
    }

    // Calendar Sync
    if (isCalendarConfigured()) {
      try {
        const isDateTbdBooking = Boolean(internalNotes?.includes(DATE_TBD_NOTE))
        const shouldRemoveCalendarEvent = updatedBooking.status === 'cancelled' || isDateTbdBooking

        if (shouldRemoveCalendarEvent) {
          if (updatedBooking.calendar_event_id) {
            const deleted = await deleteCalendarEvent(updatedBooking.calendar_event_id)
            if (deleted) {
              const { data: clearedCalendarRow, error: clearCalendarError } = await supabase
                .from('private_bookings')
                .update({ calendar_event_id: null })
                .eq('id', id)
                .select('id')
                .maybeSingle()

              if (clearCalendarError) {
                console.error('Failed to clear private booking calendar event id after removal:', clearCalendarError)
              } else if (!clearedCalendarRow) {
                console.error('Failed to clear private booking calendar event id after removal: booking row not found')
              }
              updatedBooking.calendar_event_id = null
            }
          }
          if (smsSideEffects.length > 0) {
            ;(updatedBooking as any).smsSideEffects = smsSideEffects
          }
          return updatedBooking
        }

        const eventId = await syncCalendarEvent(updatedBooking);
        if (eventId && eventId !== updatedBooking.calendar_event_id) {
          const { data: updatedCalendarRow, error: calendarUpdateError } = await supabase
            .from('private_bookings')
            .update({ calendar_event_id: eventId })
            .eq('id', id)
            .select('id')
            .maybeSingle();

          if (calendarUpdateError) {
            console.error('Failed to persist private booking calendar event id during update:', calendarUpdateError);
          } else if (!updatedCalendarRow) {
            console.error('Failed to persist private booking calendar event id during update: booking row not found');
          }
          updatedBooking.calendar_event_id = eventId
        }
      } catch (error) {
        console.error('Calendar sync exception:', error);
      }
    }

    if (smsSideEffects.length > 0) {
      ;(updatedBooking as any).smsSideEffects = smsSideEffects
    }
    return updatedBooking;
  }

  static async updateBookingStatus(id: string, status: BookingStatus, performedByUserId?: string) {
    return this.updateBooking(id, { status }, performedByUserId);
  }

  static async applyBookingDiscount(
    bookingId: string,
    data: {
      discount_type: 'percent' | 'fixed';
      discount_amount: number;
      discount_reason: string;
    }
  ) {
    const supabase = await createClient();

    const { data: updatedBooking, error } = await supabase
      .from('private_bookings')
      .update({
        discount_type: data.discount_type,
        discount_amount: data.discount_amount,
        discount_reason: data.discount_reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error applying booking discount:', error);
      throw new Error(error.message || 'Failed to apply booking discount');
    }

    if (!updatedBooking) {
      throw new Error('Booking not found');
    }

    return { success: true };
  }

  static async cancelBooking(id: string, reason: string, performedByUserId?: string) {
    const supabase = await createClient();

    // 1. Get Booking
    const { data: booking, error: fetchError } = await supabase
      .from('private_bookings')
      .select('id, status, event_date, customer_first_name, customer_last_name, customer_name, contact_phone, calendar_event_id, customer_id')
      .eq('id', id)
      .single();

    if (fetchError || !booking) {
      throw new Error('Booking not found');
    }

    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new Error('Booking cannot be cancelled');
    }

    // 2. Update Status
    const nowIso = new Date().toISOString();
    let { data: updatedBookingRow, error: updateError } = await supabase
      .from('private_bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: reason || 'Cancelled by staff',
        cancelled_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    // Fallback for legacy schema
    if (updateError && (updateError.code === 'PGRST204' || (updateError.message || '').includes('cancellation_reason'))) {
      const fallback = await supabase
        .from('private_bookings')
        .update({
          status: 'cancelled',
          updated_at: nowIso
        })
        .eq('id', id)
        .select('id')
        .maybeSingle();
      updateError = fallback.error || null;
      updatedBookingRow = fallback.data || null;
    }

    if (updateError) {
      throw new Error('Failed to cancel booking');
    }

    if (!updatedBookingRow) {
      throw new Error('Booking not found');
    }

    // 3. Calendar Cleanup
    if (booking.calendar_event_id && isCalendarConfigured()) {
      try {
        const deleted = await deleteCalendarEvent(booking.calendar_event_id);
        if (deleted) {
          const { data: clearedCalendarRow, error: clearCalendarError } = await supabase
            .from('private_bookings')
            .update({ calendar_event_id: null })
            .eq('id', id)
            .select('id')
            .maybeSingle();

          if (clearCalendarError) {
            console.error('Failed to clear calendar event id after cancellation:', clearCalendarError);
          } else if (!clearedCalendarRow) {
            console.error('Failed to clear calendar event id after cancellation: booking row not found');
          }
        }
      } catch (error) {
        console.error('Failed to delete calendar event:', error);
      }
    }

    const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

    // 4. SMS Notification
    if (booking.contact_phone || booking.customer_id) {
      const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      const firstName = booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there';
      const smsMessage = `The Anchor: Hi ${firstName}, your private booking on ${eventDate} has been cancelled. Reply to this message if you need help or call 01753 682 707 if you believe this was a mistake.`;

      let smsResult: any
      try {
        smsResult = await SmsQueueService.queueAndSend({
          booking_id: id,
          trigger_type: 'booking_cancelled',
          template_key: 'private_booking_cancelled',
          message_body: smsMessage,
          customer_phone: booking.contact_phone,
          customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
          customer_id: booking.customer_id,
          created_by: performedByUserId,
          priority: 2,
          metadata: {
            template: 'private_booking_cancelled',
            event_date: eventDate,
            reason: reason || 'staff_cancelled'
          }
        });
      } catch (smsError) {
        smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
      }

      const smsSafety = normalizeSmsSafetyMeta(smsResult)
      const smsSummary: PrivateBookingSmsSideEffectSummary = {
        triggerType: 'booking_cancelled',
        templateKey: 'private_booking_cancelled',
        queueId: typeof smsResult?.queueId === 'string' ? smsResult.queueId : undefined,
        sent: smsResult?.sent === true,
        suppressed: smsResult?.suppressed === true,
        requiresApproval: smsResult?.requiresApproval === true,
        code: smsSafety.code,
        logFailure: smsSafety.logFailure,
        error: typeof smsResult?.error === 'string' ? smsResult.error : undefined
      }

      smsSideEffects.push(smsSummary)

      if (smsSummary.logFailure) {
        logger.error('Private booking SMS logging failed', {
          metadata: {
            bookingId: id,
            triggerType: smsSummary.triggerType,
            templateKey: smsSummary.templateKey,
            code: smsSummary.code ?? null
          }
        })
      }

      if (smsSummary.error) {
        logger.error('Private booking SMS queue/send failed', {
          metadata: {
            bookingId: id,
            triggerType: smsSummary.triggerType,
            templateKey: smsSummary.templateKey,
            error: smsSummary.error
          }
        })
      }
    }

    return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
  }

  static async expireBooking(
    id: string,
    options?: { sendNotification?: boolean; asSystem?: boolean }
  ) {
    const supabase = options?.asSystem ? createAdminClient() : await createClient();
    const nowIso = new Date().toISOString();

    // 1. Get Booking
    const { data: booking, error: fetchError } = await supabase
      .from('private_bookings')
      .select('id, status, event_date, customer_first_name, customer_name, contact_phone, calendar_event_id, customer_id')
      .eq('id', id)
      .single();

    if (fetchError || !booking) throw new Error('Booking not found');
    if (booking.status !== 'draft') throw new Error('Only draft bookings can be expired');

    // 2. Update Status
    const { data: updatedBookingRow, error: updateError } = await supabase
      .from('private_bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: 'Hold period expired (14 days)',
        cancelled_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (updateError) throw new Error('Failed to expire booking');
    if (!updatedBookingRow) throw new Error('Booking not found');

    // 3. Calendar Cleanup
    if (booking.calendar_event_id && isCalendarConfigured()) {
      try {
        const deleted = await deleteCalendarEvent(booking.calendar_event_id);
        if (deleted) {
          const { data: clearedCalendarRow, error: clearCalendarError } = await supabase
            .from('private_bookings')
            .update({ calendar_event_id: null })
            .eq('id', id)
            .select('id')
            .maybeSingle();

          if (clearCalendarError) {
            console.error('Failed to clear calendar event id after expiry:', clearCalendarError);
          } else if (!clearedCalendarRow) {
            console.error('Failed to clear calendar event id after expiry: booking row not found');
          }
        }
      } catch (error) {
        console.error('Failed to delete calendar event:', error);
      }
    }

    // 4. SMS Notification
    let smsSent = false
    let smsCode: string | null = null
    let smsLogFailure = false
    if (options?.sendNotification !== false && (booking.contact_phone || booking.customer_id)) {
      const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      const smsMessage = `The Anchor: Hi ${booking.customer_first_name}, the hold on ${eventDate} has now expired and the date has been released. Please contact us if you'd like to re-book.`;

      let smsResult: any
      try {
        smsResult = await SmsQueueService.queueAndSend({
          booking_id: id,
          trigger_type: 'booking_expired',
          template_key: 'private_booking_expired',
          message_body: smsMessage,
          customer_phone: booking.contact_phone,
          customer_name: booking.customer_name,
          customer_id: booking.customer_id,
          created_by: undefined,
          priority: 2,
          metadata: {
            template: 'private_booking_expired',
            event_date: eventDate
          }
        });
      } catch (error) {
        console.error('Failed to queue expiry SMS notification:', error)
        smsResult = { error: 'Failed to queue SMS notification' }
      }

      const smsSafety = normalizeSmsSafetyMeta(smsResult)
      smsCode = smsSafety.code
      smsLogFailure = smsSafety.logFailure
      smsSent = Boolean(!smsResult.error && 'sent' in smsResult && smsResult.sent)
    }

    return { success: true, smsSent, smsCode, smsLogFailure };
  }

  static async extendHold(
    id: string,
    days: 7 | 14 | 30,
    extendedBy?: string
  ) {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();

    // 1. Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('private_bookings')
      .select('id, status, event_date, hold_expiry, customer_first_name, customer_name, contact_phone, customer_id')
      .eq('id', id)
      .single();

    if (fetchError || !booking) throw new Error('Booking not found');
    if (booking.status !== 'draft') throw new Error('Only draft bookings can have their hold extended');

    // 2. Calculate new hold_expiry: extend from current expiry (or now if already expired)
    const baseDate = booking.hold_expiry && new Date(booking.hold_expiry) > new Date()
      ? new Date(booking.hold_expiry)
      : new Date();
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + days);

    // Cap at 7 days before the event (matching creation logic)
    if (booking.event_date) {
      const eventDate = new Date(booking.event_date);
      const sevenDaysBeforeEvent = new Date(eventDate);
      sevenDaysBeforeEvent.setDate(sevenDaysBeforeEvent.getDate() - 7);
      if (newExpiry > sevenDaysBeforeEvent) {
        newExpiry.setTime(sevenDaysBeforeEvent.getTime());
      }
    }

    const newExpiryIso = newExpiry.toISOString();

    // 3. Update hold_expiry
    const { error: updateError } = await supabase
      .from('private_bookings')
      .update({ hold_expiry: newExpiryIso, updated_at: nowIso })
      .eq('id', id);

    if (updateError) throw new Error('Failed to extend booking hold');

    // 4. Send SMS
    let smsSent = false;
    if (booking.contact_phone || booking.customer_id) {
      const expiryReadable = newExpiry.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
      const eventDateReadable = booking.event_date
        ? new Date(booking.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'your event';

      const smsMessage = `The Anchor: Hi ${booking.customer_first_name}, we've extended your date hold for ${eventDateReadable}. Your deposit is now due by ${expiryReadable}. Please call us if you have any questions.`;

      let smsResult: any;
      try {
        smsResult = await SmsQueueService.queueAndSend({
          booking_id: id,
          trigger_type: 'hold_extended',
          template_key: 'private_booking_hold_extended',
          message_body: smsMessage,
          customer_phone: booking.contact_phone,
          customer_name: booking.customer_name,
          customer_id: booking.customer_id,
          created_by: extendedBy,
          priority: 2,
          metadata: {
            template: 'private_booking_hold_extended',
            event_date: eventDateReadable,
            new_expiry: expiryReadable,
            extended_days: days,
          }
        });
      } catch (error) {
        console.error('Failed to queue hold extension SMS:', error);
        smsResult = { error: 'Failed to queue SMS' };
      }

      const smsSafety = normalizeSmsSafetyMeta(smsResult);
      smsSent = Boolean(!smsResult?.error && 'sent' in smsResult && smsResult.sent);
    }

    return { success: true, newExpiry: newExpiryIso, smsSent };
  }

  static async deletePrivateBooking(id: string) {
    const supabase = await createClient();

    // Calendar Cleanup
    if (isCalendarConfigured()) {
      try {
        // Get the booking first to find calendar event id
        const { data: bookingDetails } = await supabase
          .from('private_bookings')
          .select('calendar_event_id')
          .eq('id', id)
          .single();

        if (bookingDetails?.calendar_event_id) {
          const deleted = await deleteCalendarEvent(bookingDetails.calendar_event_id);
          if (!deleted) {
            throw new Error('Failed to remove Google Calendar event. Please try again.');
          }
        }
      } catch (error) {
        console.error('Failed to delete calendar event during booking deletion:', error);
        throw error
      }
    }

    const { data, error } = await supabase
      .from('private_bookings')
      .delete()
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error deleting private booking:', error);
      throw new Error(error.message || 'Failed to delete private booking');
    }

    return { deletedBooking: data };
  }

  static async recordDeposit(bookingId: string, amount: number, method: string, performedByUserId?: string) {
    const supabase = await createClient();

    const { data: booking, error: fetchError } = await supabase
      .from('private_bookings')
      .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) throw new Error('Booking not found');

    const { data: updatedBooking, error } = await supabase
      .from('private_bookings')
      .update({
        deposit_paid_date: new Date().toISOString(),
        deposit_payment_method: method,
        deposit_amount: amount,
        status: 'confirmed',
        cancellation_reason: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .maybeSingle();

    if (error) throw new Error('Failed to record deposit');
    if (!updatedBooking) throw new Error('Booking not found');

    if (booking.customer_id) {
      try {
        const adminClient = createAdminClient();
        await recordAnalyticsEvent(adminClient, {
          customerId: booking.customer_id,
          privateBookingId: bookingId,
          eventType: 'private_booking_confirmed',
          metadata: {
            via: 'private_booking_deposit',
            payment_method: method
          }
        });
      } catch (analyticsError) {
        console.error('Failed to record private booking confirmation analytics from deposit:', analyticsError);
      }
    }

    const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

    // SMS
    if (booking.contact_phone || booking.customer_id) {
      const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      const smsMessage = `The Anchor: Hi ${booking.customer_first_name}, deposit received. Your booking for ${eventDate} is now fully confirmed. We'll be in touch closer to the time for final details.`;

      let smsResult: any
      try {
        smsResult = await SmsQueueService.queueAndSend({
          booking_id: bookingId,
          trigger_type: 'deposit_received',
          template_key: 'private_booking_deposit_received',
          message_body: smsMessage,
          customer_phone: booking.contact_phone,
          customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
          customer_id: booking.customer_id,
          created_by: performedByUserId,
          priority: 1,
          metadata: {
            template: 'private_booking_deposit_received',
            first_name: booking.customer_first_name,
            amount: amount,
            event_date: eventDate
          }
        });
      } catch (smsError) {
        smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
      }

      const smsSafety = normalizeSmsSafetyMeta(smsResult)
      const smsSummary: PrivateBookingSmsSideEffectSummary = {
        triggerType: 'deposit_received',
        templateKey: 'private_booking_deposit_received',
        queueId: typeof smsResult?.queueId === 'string' ? smsResult.queueId : undefined,
        sent: smsResult?.sent === true,
        suppressed: smsResult?.suppressed === true,
        requiresApproval: smsResult?.requiresApproval === true,
        code: smsSafety.code,
        logFailure: smsSafety.logFailure,
        error: typeof smsResult?.error === 'string' ? smsResult.error : undefined
      }

      smsSideEffects.push(smsSummary)

      if (smsSummary.logFailure) {
        logger.error('Private booking SMS logging failed', {
          metadata: {
            bookingId: bookingId,
            triggerType: smsSummary.triggerType,
            templateKey: smsSummary.templateKey,
            code: smsSummary.code ?? null
          }
        })
      }

      if (smsSummary.error) {
        logger.error('Private booking SMS queue/send failed', {
          metadata: {
            bookingId: bookingId,
            triggerType: smsSummary.triggerType,
            templateKey: smsSummary.templateKey,
            error: smsSummary.error
          }
        })
      }
    }

    // Calendar Sync
    if (updatedBooking && isCalendarConfigured()) {
      try {
        const fullBookingForSync = {
          ...booking, // original
          ...updatedBooking, // updated
        } as PrivateBookingWithDetails;

        const eventId = await syncCalendarEvent(fullBookingForSync);
        if (eventId && eventId !== booking.calendar_event_id) {
          const { data: updatedCalendarRow, error: calendarUpdateError } = await supabase
            .from('private_bookings')
            .update({ calendar_event_id: eventId })
            .eq('id', bookingId)
            .select('id')
            .maybeSingle();

          if (calendarUpdateError) {
            console.error('Failed to persist calendar event id after deposit:', calendarUpdateError);
          } else if (!updatedCalendarRow) {
            console.error('Failed to persist calendar event id after deposit: booking row not found');
          }
        }
      } catch (error) {
        console.error('Calendar sync failed during deposit record:', error);
      }
    }

    return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
  }

  static async recordFinalPayment(bookingId: string, method: string, performedByUserId?: string) {
    const supabase = await createClient();

    const { data: booking, error: fetchError } = await supabase
      .from('private_bookings')
      .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) throw new Error('Booking not found');

    const { data: updatedBooking, error } = await supabase
      .from('private_bookings')
      .update({
        final_payment_date: new Date().toISOString(),
        final_payment_method: method,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .maybeSingle();

    if (error) throw new Error('Failed to record final payment');
    if (!updatedBooking) throw new Error('Booking not found');

    const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

    // SMS
    if (booking.contact_phone || booking.customer_id) {
      const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      const smsMessage = `The Anchor: Hi ${booking.customer_first_name}, thank you for your final payment. Your private booking on ${eventDate} is fully paid.`;

      let smsResult: any
      try {
        smsResult = await SmsQueueService.queueAndSend({
          booking_id: bookingId,
          trigger_type: 'final_payment_received',
          template_key: 'private_booking_final_payment',
          message_body: smsMessage,
          customer_phone: booking.contact_phone,
          customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
          customer_id: booking.customer_id,
          created_by: performedByUserId,
          priority: 1,
          metadata: {
            template: 'private_booking_final_payment',
            first_name: booking.customer_first_name,
            event_date: eventDate
          }
        });
      } catch (smsError) {
        smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
      }

      const smsSafety = normalizeSmsSafetyMeta(smsResult)
      const smsSummary: PrivateBookingSmsSideEffectSummary = {
        triggerType: 'final_payment_received',
        templateKey: 'private_booking_final_payment',
        queueId: typeof smsResult?.queueId === 'string' ? smsResult.queueId : undefined,
        sent: smsResult?.sent === true,
        suppressed: smsResult?.suppressed === true,
        requiresApproval: smsResult?.requiresApproval === true,
        code: smsSafety.code,
        logFailure: smsSafety.logFailure,
        error: typeof smsResult?.error === 'string' ? smsResult.error : undefined
      }

      smsSideEffects.push(smsSummary)

      if (smsSummary.logFailure) {
        logger.error('Private booking SMS logging failed', {
          metadata: {
            bookingId: bookingId,
            triggerType: smsSummary.triggerType,
            templateKey: smsSummary.templateKey,
            code: smsSummary.code ?? null
          }
        })
      }

      if (smsSummary.error) {
        logger.error('Private booking SMS queue/send failed', {
          metadata: {
            bookingId: bookingId,
            triggerType: smsSummary.triggerType,
            templateKey: smsSummary.templateKey,
            error: smsSummary.error
          }
        })
      }
    }

    // Calendar Sync
    if (updatedBooking && isCalendarConfigured()) {
      try {
        const fullBookingForSync = {
          ...booking,
          ...updatedBooking,
        } as PrivateBookingWithDetails;

        const eventId = await syncCalendarEvent(fullBookingForSync);
        if (eventId && eventId !== booking.calendar_event_id) {
          const { data: updatedCalendarRow, error: calendarUpdateError } = await supabase
            .from('private_bookings')
            .update({ calendar_event_id: eventId })
            .eq('id', bookingId)
            .select('id')
            .maybeSingle();

          if (calendarUpdateError) {
            console.error('Failed to persist calendar event id after final payment:', calendarUpdateError);
          } else if (!updatedCalendarRow) {
            console.error('Failed to persist calendar event id after final payment: booking row not found');
          }
        }
      } catch (error) {
        console.error('Calendar sync failed during final payment record:', error);
      }
    }

    return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
  }

  static async addNote(bookingId: string, note: string, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const { error } = await admin.from('private_booking_audit').insert({
      booking_id: bookingId,
      action: 'note_added',
      field_name: 'notes',
      new_value: note,
      metadata: {
        note_text: note
      },
      performed_by: userId
    });

    if (error) throw new Error('Failed to save note');

    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'add_note',
      resource_type: 'private_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        note_preview: note.substring(0, 120)
      }
    });

    return { success: true };
  }

  static async getBookings(filters?: {
    status?: BookingStatus;
    fromDate?: string;
    toDate?: string;
    customerId?: string;
    limit?: number;
    useAdmin?: boolean;
  }) {
    const supabase = filters?.useAdmin ? createAdminClient() : await createClient();

    let query = supabase
      .from('private_bookings_with_details')
      .select('*', { count: 'exact' })
      .order('event_date', { ascending: true, nullsFirst: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.fromDate) {
      query = query.gte('event_date', filters.fromDate);
    }

    if (filters?.toDate) {
      query = query.lte('event_date', filters.toDate);
    }

    if (filters?.customerId) {
      query = query.eq('customer_id', filters.customerId);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching private bookings:', error);
      throw new Error(error.message || 'An error occurred');
    }

    return { data: (data || []) as PrivateBookingWithDetails[], count };
  }

  static async fetchPrivateBookings(options: {
    status?: BookingStatus | 'all';
    dateFilter?: 'all' | 'upcoming' | 'past';
    search?: string;
    page?: number;
    pageSize?: number;
    includeCancelled?: boolean;
  }) {
    const supabase = await createClient();
    const page = options.page && options.page > 0 ? options.page : 1;
    const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : 20;
    const todayIso = toLocalIsoDate(new Date());
    const includeCancelled = options.includeCancelled !== false;

    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    let query = supabase
      .from('private_bookings_with_details')
      .select(
        `
          id,
          customer_id,
          customer_name,
          customer_first_name,
          customer_last_name,
          customer_full_name,
          contact_phone,
          contact_email,
          event_date,
          start_time,
          setup_date,
          setup_time,
          end_time,
          end_time_next_day,
          guest_count,
          event_type,
          status,
          contract_version,
          created_at,
          updated_at,
          deposit_amount,
          deposit_paid_date,
          total_amount,
          balance_due_date,
          final_payment_date,
          final_payment_method,
          discount_type,
          discount_amount,
          discount_reason,
          internal_notes,
          customer_requests,
          calculated_total,
          deposit_status,
          days_until_event
        `,
        { count: 'exact' }
      )
      .order('event_date', { ascending: true, nullsFirst: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    if (options.status && options.status !== 'all') {
      query = query.eq('status', options.status);
    }

    if (options.dateFilter === 'upcoming') {
      query = query.gte('event_date', todayIso);
      if (!includeCancelled && (!options.status || options.status === 'all')) {
        query = query.neq('status', 'cancelled');
      }
    } else if (options.dateFilter === 'past') {
      query = query.lte('event_date', todayIso);
    }

    const searchTerm = options.search?.trim();
    if (searchTerm) {
      const sanitizedSearch = sanitizeBookingSearchTerm(searchTerm);
      if (sanitizedSearch.length > 0) {
        const pattern = `%${sanitizedSearch}%`;

        query = query.or(
          [
            `customer_name.ilike.${pattern}`,
            `customer_first_name.ilike.${pattern}`,
            `customer_last_name.ilike.${pattern}`,
            `customer_full_name.ilike.${pattern}`,
            `contact_phone.ilike.${pattern}`,
            `contact_email.ilike.${pattern}`,
            `event_type.ilike.${pattern}`,
          ].join(',')
        );
      }
    }

    const { data, error, count } = await query.range(start, end);

    if (error) {
      console.error('Error fetching private bookings:', error);
      throw new Error(error.message || 'An error occurred');
    }

    const totalCount = typeof count === 'number' ? count : (data?.length ?? 0);

    const bookingIds = (data || []).map((booking) => booking.id).filter(Boolean);
    const holdExpiryById = new Map<string, string | null>();

    if (bookingIds.length > 0) {
      const { data: holdExpiryRows, error: holdExpiryError } = await supabase
        .from('private_bookings')
        .select('id, hold_expiry')
        .in('id', bookingIds);

      if (holdExpiryError) {
        console.error('Error fetching hold expiry dates for private bookings:', holdExpiryError);
      } else if (holdExpiryRows) {
        for (const row of holdExpiryRows) {
          holdExpiryById.set(row.id, row.hold_expiry ?? null);
        }
      }
    }

    const enriched = (data || []).map((booking) => ({
      ...booking,
      hold_expiry: holdExpiryById.get(booking.id) ?? undefined,
      is_date_tbd: Boolean(booking.internal_notes?.includes(DATE_TBD_NOTE)),
    }));

    return { data: enriched as PrivateBookingWithDetails[], totalCount };
  }

  static async fetchPrivateBookingsForCalendar() {
    const todayIso = toLocalIsoDate(new Date());
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('private_bookings_with_details')
      .select(
        `
          id,
          customer_name,
          customer_first_name,
          customer_last_name,
          event_date,
          start_time,
          end_time,
          end_time_next_day,
          status,
          contract_version,
          created_at,
          updated_at,
          event_type,
          guest_count,
          internal_notes
        `
      )
      .gte('event_date', todayIso)
      .order('event_date', { ascending: true, nullsFirst: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    if (error) {
      console.error('Error fetching bookings for calendar:', error);
      throw new Error(error.message || 'An error occurred');
    }

    return { data: (data || []) as PrivateBookingWithDetails[] };
  }

  static async getBookingById(id: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('private_bookings')
      .select(`
        *,
        customer:customers(id, first_name, last_name, email, phone:mobile_number),
        items:private_booking_items(
          *,
          space:venue_spaces(*),
          package:catering_packages(*),
          vendor:vendors(*)
        ),
        documents:private_booking_documents(*),
        sms_queue:private_booking_sms_queue(*),
        audits:private_booking_audit(
          id,
          booking_id,
          action,
          field_name,
          old_value,
          new_value,
          metadata,
          performed_by,
          performed_at,
          performed_by_profile:profiles!private_booking_audit_performed_by_profile_fkey(
            id,
            full_name,
            email
          )
        )
      `)
      .order('display_order', { ascending: true, foreignTable: 'private_booking_items' })
      .order('performed_at', { ascending: false, foreignTable: 'private_booking_audit' })
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching private booking:', error);
      throw new Error(error.message || 'An error occurred');
    }

    if (!data) {
      throw new Error('Booking not found');
    }

    const {
      audits: auditsData,
      ...bookingCore
    } = data as typeof data & {
      audits?: PrivateBookingAuditWithUser[];
    };

    const items = bookingCore.items ?? [];

    const calculatedTotal = items?.reduce((sum: number, item: any) => sum + toNumber(item.line_total), 0) || 0;

    const eventDate = new Date(data.event_date);
    const today = new Date();
    const daysUntilEvent = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const depositStatus = data.deposit_paid_date
      ? 'Paid'
      : toNumber(data.deposit_amount) > 0
        ? 'Required'
        : 'Not Required';

    const auditTrail = ((auditsData ?? []) as PrivateBookingAuditWithUser[]).slice().sort(
      (a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime()
    );

    const bookingWithDetails: PrivateBookingWithDetails = {
      ...(bookingCore as PrivateBookingWithDetails),
      items,
      calculated_total: calculatedTotal,
      deposit_status: depositStatus,
      days_until_event: daysUntilEvent,
      audit_trail: auditTrail
    };

    return bookingWithDetails;
  }

  static async getBookingByIdForEdit(id: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('private_bookings')
      .select(
        `
          *,
          customer:customers(id, first_name, last_name, email, phone:mobile_number)
        `
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching private booking for edit:', error);
      throw new Error(error.message || 'An error occurred');
    }

    if (!data) {
      throw new Error('Booking not found');
    }

    return data as PrivateBookingWithDetails;
  }

  static async getBookingByIdForItems(id: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('private_bookings')
      .select(
        `
          *,
          customer:customers(id, first_name, last_name, email, phone:mobile_number),
          items:private_booking_items(
            *,
            space:venue_spaces(*),
            package:catering_packages(*),
            vendor:vendors(*)
          )
        `
      )
      .order('display_order', { ascending: true, foreignTable: 'private_booking_items' })
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching private booking items:', error);
      throw new Error(error.message || 'An error occurred');
    }

    if (!data) {
      throw new Error('Booking not found');
    }

    const items = (data as any).items ?? [];
    const calculatedTotal = items.reduce((sum: number, item: any) => sum + toNumber(item.line_total), 0);

    return {
      ...(data as PrivateBookingWithDetails),
      calculated_total: calculatedTotal,
    };
  }

  static async getBookingByIdForMessages(id: string) {
    const supabase = await createClient();

    const { data: booking, error: bookingError } = await supabase
      .from('private_bookings_with_details')
      .select(
        `
          id,
          customer_id,
          customer_name,
          customer_first_name,
          customer_last_name,
          customer_full_name,
          contact_phone,
          contact_email,
          event_date,
          start_time,
          setup_date,
          setup_time,
          end_time,
          end_time_next_day,
          guest_count,
          event_type,
          status,
          deposit_amount,
          deposit_paid_date,
          total_amount,
          balance_due_date,
          final_payment_date,
          final_payment_method,
          discount_type,
          discount_amount,
          discount_reason,
          internal_notes,
          calculated_total,
          days_until_event,
          deposit_status
        `
      )
      .eq('id', id)
      .maybeSingle();

    if (bookingError) {
      console.error('Error fetching private booking for messages:', bookingError);
      throw new Error(bookingError.message || 'An error occurred');
    }

    if (!booking) {
      throw new Error('Booking not found');
    }

    const { data: smsQueue, error: smsError } = await supabase
      .from('private_booking_sms_queue')
      .select('*')
      .eq('booking_id', id)
      .order('created_at', { ascending: false });

    if (smsError) {
      console.error('Error fetching private booking SMS queue:', smsError);
      throw new Error(smsError.message || 'Failed to fetch booking messages');
    }

    return {
      ...(booking as PrivateBookingWithDetails),
      sms_queue: smsQueue ?? [],
    };
  }

  static async getVenueSpaces(activeOnly = true, useAdmin = false) {
    const supabase = useAdmin ? createAdminClient() : await createClient();

    let query = supabase
      .from('venue_spaces')
      .select('*')
      .order('display_order', { ascending: true });

    if (activeOnly) {
      query = query.eq('active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching venue spaces:', error);
      throw new Error(error.message || 'An error occurred');
    }

    return data;
  }

  static async getVenueSpacesForManagement() {
    return this.getVenueSpaces(false);
  }

  static async getCateringPackages(activeOnly = true, useAdmin = false) {
    const supabase = useAdmin ? createAdminClient() : await createClient();

    let query = supabase
      .from('catering_packages')
      .select('*')
      .order('display_order', { ascending: true });

    if (activeOnly) {
      query = query.eq('active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching catering packages:', error);
      throw new Error(error.message || 'An error occurred');
    }

    return data;
  }

  static async getCateringPackagesForManagement() {
    return this.getCateringPackages(false);
  }

  static async getVendors(serviceType?: string, activeOnly = true, useAdmin = false) {
    const supabase = useAdmin ? createAdminClient() : await createClient();

    let query = supabase
      .from('vendors')
      .select('*')
      .order('preferred', { ascending: false })
      .order('name', { ascending: true });

    if (activeOnly) {
      query = query.eq('active', true);
    }

    if (serviceType) {
      query = query.eq('service_type', serviceType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching vendors:', error);
      throw new Error(error.message || 'An error occurred');
    }

    // Note: Normalization of rates happens here or in UI, keeping raw data here for now unless strictly needed
    return data;
  }

  static async getVendorsForManagement() {
    return this.getVendors(undefined, false);
  }

  static async getVendorRate(vendorId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, service_type, typical_rate, typical_rate_normalized')
      .eq('id', vendorId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching vendor rate:', error);
      throw new Error(error.message || 'Failed to fetch vendor rate');
    }

    return data;
  }

  private static async sendCreationSms(booking: any, phone?: string | null) {
    const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const depositAmount = toNumber(booking.deposit_amount);
    const formattedDeposit = depositAmount.toFixed(2);

    // Calculate hold expiry (14 days from creation)
    const holdExpiryDate = booking.hold_expiry ? new Date(booking.hold_expiry) : new Date(); // Use actual hold_expiry from DB
    const expiryReadable = holdExpiryDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long'
    });

    // Calculate time difference
    const today = new Date();
    const eventDate = new Date(booking.event_date);
    const diffTime = eventDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isShortNotice = diffDays < 7;

    let smsMessage = "";

    if (depositAmount > 0) {
      if (isShortNotice) {
        smsMessage = `The Anchor: Hi ${booking.customer_first_name}, thanks for your enquiry for ${eventDateReadable} at The Anchor. As this is a short-notice private booking, we need to secure the deposit of £${formattedDeposit} as soon as possible to confirm the date. Please reply to arrange payment.`;
      } else {
        smsMessage = `The Anchor: Hi ${booking.customer_first_name}, thanks for your enquiry for ${eventDateReadable} at The Anchor. We are holding this date for you until ${expiryReadable}. To secure it permanently, a deposit of £${formattedDeposit} is required by this date.`;
      }
    } else {
      smsMessage = `The Anchor: Hi ${booking.customer_first_name}, thanks for your enquiry about private hire at The Anchor on ${eventDateReadable}. We normally require a deposit to secure the date, but we've waived it for you.`;
    }

    try {
      const result = await SmsQueueService.queueAndSend({
        booking_id: booking.id,
        trigger_type: 'booking_created',
        template_key: 'private_booking_created',
        message_body: smsMessage,
        customer_phone: phone ?? undefined,
        customer_name: booking.customer_name,
        customer_id: booking.customer_id,
        created_by: booking.created_by,
        priority: 2,
        metadata: {
          template: 'private_booking_created',
          first_name: booking.customer_first_name,
          event_date: eventDateReadable,
          deposit_amount: depositAmount
        }
      });

      const smsSafety = normalizeSmsSafetyMeta(result)
      if (smsSafety.logFailure) {
        logger.error('Private booking created SMS logging failed', {
          metadata: {
            bookingId: booking.id,
            triggerType: 'booking_created',
            templateKey: 'private_booking_created',
            code: smsSafety.code
          }
        })
      }

      if (typeof result?.error === 'string') {
        logger.error('Private booking created SMS queue/send failed', {
          metadata: {
            bookingId: booking.id,
            triggerType: 'booking_created',
            templateKey: 'private_booking_created',
            error: result.error
          }
        })
      }
    } catch (smsError) {
      console.error('Failed to queue booking created SMS after booking creation:', smsError);
    }
  }

  static async addBookingItem(data: {
    booking_id: string;
    item_type: 'space' | 'catering' | 'vendor' | 'other';
    space_id?: string | null;
    package_id?: string | null;
    vendor_id?: string | null;
    description: string;
    quantity: number;
    unit_price: number;
    discount_value?: number;
    discount_type?: 'percent' | 'fixed';
    notes?: string | null;
  }) {
    const supabase = await createClient();

    const { data: lastItem, error: orderError } = await supabase
      .from('private_booking_items')
      .select('display_order')
      .eq('booking_id', data.booking_id)
      .order('display_order', { ascending: false })
      .limit(1);

    if (orderError) {
      console.error('Error determining next item order:', orderError);
      throw new Error(orderError.message || 'Failed to determine item order');
    }

    const nextDisplayOrder = lastItem && lastItem.length > 0 && lastItem[0]?.display_order !== null && lastItem[0]?.display_order !== undefined
      ? Number(lastItem[0].display_order) + 1
      : 0;

    const { error } = await supabase
      .from('private_booking_items')
      .insert({
        booking_id: data.booking_id,
        item_type: data.item_type,
        space_id: data.space_id,
        package_id: data.package_id,
        vendor_id: data.vendor_id,
        description: data.description,
        quantity: data.quantity,
        unit_price: data.unit_price,
        discount_value: data.discount_value,
        discount_type: data.discount_type,
        notes: data.notes,
        display_order: nextDisplayOrder
      });

    if (error) {
      console.error('Error adding booking item:', error);
      throw new Error(error.message || 'Failed to add booking item');
    }

    return { success: true };
  }

  static async updateBookingItem(itemId: string, data: {
    quantity?: number;
    unit_price?: number;
    discount_value?: number;
    discount_type?: 'percent' | 'fixed';
    notes?: string | null;
  }) {
    const supabase = await createClient();

    // Get current item to find booking ID for eventual return or revalidation signal
    const { data: currentItem, error: fetchError } = await supabase
      .from('private_booking_items')
      .select('booking_id')
      .eq('id', itemId)
      .single();

    if (fetchError || !currentItem) {
      throw new Error('Item not found');
    }

    // Build update object - only include fields that are provided
    const updateData: any = {};

    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.unit_price !== undefined) updateData.unit_price = data.unit_price;
    if (data.discount_value !== undefined) updateData.discount_value = data.discount_value;
    if (data.discount_type !== undefined) updateData.discount_type = data.discount_type;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const { data: updatedItem, error } = await supabase
      .from('private_booking_items')
      .update(updateData)
      .eq('id', itemId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error updating booking item:', error);
      throw new Error(error.message || 'Failed to update booking item');
    }

    if (!updatedItem) {
      throw new Error('Item not found');
    }

    return { success: true, bookingId: currentItem.booking_id };
  }

  static async deleteBookingItem(itemId: string) {
    const supabase = await createClient();

    // Get booking ID before deleting
    const { data: item, error: fetchError } = await supabase
      .from('private_booking_items')
      .select('booking_id')
      .eq('id', itemId)
      .single();

    if (fetchError || !item) {
      throw new Error('Item not found');
    }

    const { data: deletedItem, error } = await supabase
      .from('private_booking_items')
      .delete()
      .eq('id', itemId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error deleting booking item:', error);
      throw new Error(error.message || 'Failed to delete booking item');
    }

    if (!deletedItem) {
      throw new Error('Item not found');
    }

    return { success: true, bookingId: item.booking_id };
  }

  static async reorderBookingItems(bookingId: string, orderedIds: string[]) {
    const supabase = await createClient();

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('No booking items supplied for reordering');
    }

    const { data: existingItems, error: fetchError } = await supabase
      .from('private_booking_items')
      .select('id, display_order')
      .eq('booking_id', bookingId);

    if (fetchError) {
      console.error('Error fetching booking items for reorder:', fetchError);
      throw new Error(fetchError.message || 'Failed to fetch booking items');
    }

    const existingIds = new Set((existingItems || []).map((item) => item.id));

    const hasInvalidId = orderedIds.some((id) => !existingIds.has(id));
    if (hasInvalidId || existingIds.size !== orderedIds.length) {
      throw new Error('Booking items list must include all existing items');
    }

    const previousOrder = new Map((existingItems || []).map((item) => [item.id, item.display_order ?? 0]));

    try {
      for (const [index, id] of orderedIds.entries()) {
        const { data: updatedRows, error: updateError } = await supabase
          .from('private_booking_items')
          .update({ display_order: index })
          .eq('id', id)
          .eq('booking_id', bookingId)
          .select('id')
          .limit(1);

        if (updateError || !updatedRows || updatedRows.length === 0) {
          throw updateError || new Error(`Failed to update display order for item ${id}`);
        }
      }
    } catch (updateFailure) {
      // Best-effort rollback to avoid leaving partially reordered items.
      await Promise.allSettled(
        Array.from(previousOrder.entries()).map(async ([id, displayOrder]) => {
          const { data: restoredRow, error: restoreError } = await supabase
            .from('private_booking_items')
            .update({ display_order: displayOrder })
            .eq('id', id)
            .eq('booking_id', bookingId)
            .select('id')
            .maybeSingle()

          if (restoreError) {
            console.error('Failed to restore booking item order during rollback:', restoreError)
            return
          }

          if (!restoredRow) {
            console.error('Failed to restore booking item order during rollback: item no longer exists', { id, bookingId })
          }
        })
      );

      console.error('Error updating booking item order:', updateFailure);
      throw new Error(
        updateFailure instanceof Error
          ? updateFailure.message
          : 'Failed to update booking item order'
      );
    }

    return { success: true };
  }

  // Venue Space Management
  static async createVenueSpace(data: {
    name: string;
    capacity: number;
    capacity_standing: number;
    hire_cost: number;
    description?: string | null;
    is_active: boolean;
  }, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const dbData = {
      name: data.name,
      capacity_seated: data.capacity,
      capacity_standing: data.capacity_standing,
      rate_per_hour: data.hire_cost,
      description: data.description,
      active: data.is_active,
      minimum_hours: 1,
      setup_fee: 0,
      display_order: 0
    };

    const { data: inserted, error } = await admin
      .from('venue_spaces')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      console.error('Error creating venue space:', error);
      throw new Error(error.message || 'Failed to create venue space');
    }

    if (inserted) {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'create',
        resource_type: 'venue_space',
        resource_id: inserted.id,
        operation_status: 'success',
        new_values: {
          name: inserted.name,
          capacity_seated: inserted.capacity_seated,
          capacity_standing: inserted.capacity_standing,
          rate_per_hour: inserted.rate_per_hour,
          description: inserted.description,
          active: inserted.active
        }
      });
    }

    return inserted;
  }

  static async updateVenueSpace(id: string, data: {
    name: string;
    capacity: number;
    capacity_standing: number;
    hire_cost: number;
    description?: string | null;
    is_active: boolean;
  }, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('venue_spaces')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Venue space not found');
    }

    const dbData = {
      name: data.name,
      capacity_seated: data.capacity,
      capacity_standing: data.capacity_standing,
      rate_per_hour: data.hire_cost,
      description: data.description,
      active: data.is_active
    };

    const { data: updated, error } = await admin
      .from('venue_spaces')
      .update(dbData)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error updating venue space:', error);
      throw new Error(error.message || 'Failed to update venue space');
    }

    if (!updated) {
      throw new Error('Venue space not found');
    }

    if (updated) {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'update',
        resource_type: 'venue_space',
        resource_id: id,
        operation_status: 'success',
        old_values: {
          name: existing.name,
          capacity_seated: existing.capacity_seated,
          capacity_standing: existing.capacity_standing,
          rate_per_hour: existing.rate_per_hour,
          description: existing.description,
          active: existing.active
        },
        new_values: {
          name: updated.name,
          capacity_seated: updated.capacity_seated,
          capacity_standing: updated.capacity_standing,
          rate_per_hour: updated.rate_per_hour,
          description: updated.description,
          active: updated.active
        }
      });
    }

    return updated;
  }

  static async deleteVenueSpace(id: string, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('venue_spaces')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Venue space not found');
    }

    const { data: deletedVenueSpace, error } = await admin
      .from('venue_spaces')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error deleting venue space:', error);
      throw new Error(error.message || 'Failed to delete venue space');
    }

    if (!deletedVenueSpace) {
      throw new Error('Venue space not found');
    }

    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'delete',
      resource_type: 'venue_space',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        capacity_seated: existing.capacity_seated,
        capacity_standing: existing.capacity_standing,
        rate_per_hour: existing.rate_per_hour,
        description: existing.description,
        active: existing.active
      }
    });

    return { success: true };
  }

  // Catering Package Management
  static async createCateringPackage(data: {
    name: string;
    serving_style: string;
    category: 'food' | 'drink' | 'addon';
    per_head_cost: number;
    pricing_model?: 'per_head' | 'total_value';
    minimum_order?: number | null;
    description?: string | null;
    includes?: string | null;
    is_active: boolean;
  }, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const dbData = {
      name: data.name,
      serving_style: data.serving_style,
      category: data.category,
      cost_per_head: data.per_head_cost,
      pricing_model: data.pricing_model || 'per_head',
      minimum_guests: data.minimum_order,
      description: data.description,
      dietary_notes: data.includes,
      active: data.is_active,
      display_order: 0
    };

    const { data: inserted, error } = await admin
      .from('catering_packages')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      console.error('Error creating catering package:', error);
      if (error.code === '23505') {
        throw new Error('A catering package with this name already exists. Please choose a different name.');
      }
      throw new Error(error.message || 'Failed to create catering package');
    }

    if (inserted) {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'create',
        resource_type: 'catering_package',
        resource_id: inserted.id,
        operation_status: 'success',
        new_values: {
          name: inserted.name,
          serving_style: inserted.serving_style,
          category: inserted.category,
          cost_per_head: inserted.cost_per_head,
          pricing_model: inserted.pricing_model,
          minimum_guests: inserted.minimum_guests,
          description: inserted.description,
          dietary_notes: inserted.dietary_notes,
          active: inserted.active
        }
      });
    }

    return inserted;
  }

  static async updateCateringPackage(id: string, data: {
    name: string;
    serving_style: string;
    category: 'food' | 'drink' | 'addon';
    per_head_cost: number;
    pricing_model?: 'per_head' | 'total_value';
    minimum_order?: number | null;
    description?: string | null;
    includes?: string | null;
    is_active: boolean;
  }, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('catering_packages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Catering package not found');
    }

    const dbData = {
      name: data.name,
      serving_style: data.serving_style,
      category: data.category,
      cost_per_head: data.per_head_cost,
      pricing_model: data.pricing_model || 'per_head',
      minimum_guests: data.minimum_order,
      description: data.description,
      dietary_notes: data.includes,
      active: data.is_active
    };

    const { data: updated, error } = await admin
      .from('catering_packages')
      .update(dbData)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error updating catering package:', error);
      if (error.code === '23505') {
        throw new Error('A catering package with this name already exists. Please choose a different name.');
      }
      throw new Error(error.message || 'Failed to update catering package');
    }

    if (!updated) {
      throw new Error('Catering package not found');
    }

    if (updated) {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'update',
        resource_type: 'catering_package',
        resource_id: id,
        operation_status: 'success',
        old_values: {
          name: existing.name,
          package_type: existing.package_type,
          cost_per_head: existing.cost_per_head,
          pricing_model: existing.pricing_model,
          minimum_guests: existing.minimum_guests,
          description: existing.description,
          dietary_notes: existing.dietary_notes,
          active: existing.active
        },
        new_values: {
          name: updated.name,
          package_type: updated.package_type,
          cost_per_head: updated.cost_per_head,
          pricing_model: updated.pricing_model,
          minimum_guests: updated.minimum_guests,
          description: updated.description,
          dietary_notes: updated.dietary_notes,
          active: updated.active
        }
      });
    }

    return updated;
  }

  static async deleteCateringPackage(id: string, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('catering_packages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Catering package not found');
    }

    const { data: deletedPackage, error } = await admin
      .from('catering_packages')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error deleting catering package:', error);
      throw new Error(error.message || 'Failed to delete catering package');
    }

    if (!deletedPackage) {
      throw new Error('Catering package not found');
    }

    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'delete',
      resource_type: 'catering_package',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        package_type: existing.package_type,
        cost_per_head: existing.cost_per_head,
        pricing_model: existing.pricing_model,
        minimum_guests: existing.minimum_guests,
        description: existing.description,
        dietary_notes: existing.dietary_notes,
        active: existing.active
      }
    });

    return { success: true };
  }

  // Vendor Management
  static async createVendor(data: {
    name: string;
    vendor_type: string;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    typical_rate?: number | null;
    notes?: string | null;
    is_preferred: boolean;
    is_active: boolean;
  }, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const formattedPhone = data.phone ? formatPhoneForStorage(data.phone) : null;

    const dbData = {
      name: data.name,
      service_type: data.vendor_type,
      contact_name: data.contact_name,
      contact_phone: formattedPhone,
      contact_email: data.email,
      website: data.website,
      notes: data.notes,
      preferred: data.is_preferred,
      active: data.is_active
    };

    const { data: inserted, error } = await admin
      .from('vendors')
      .insert({
        ...dbData,
        typical_rate: data.typical_rate?.toString() ?? null
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating vendor:', error);
      throw new Error(error.message || 'Failed to create vendor');
    }

    if (inserted) {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'create',
        resource_type: 'vendor',
        resource_id: inserted.id,
        operation_status: 'success',
        new_values: {
          name: inserted.name,
          service_type: inserted.service_type,
          contact_name: inserted.contact_name,
          contact_phone: inserted.contact_phone,
          contact_email: inserted.contact_email,
          website: inserted.website,
          typical_rate: inserted.typical_rate,
          preferred: inserted.preferred,
          active: inserted.active
        }
      });
    }

    return inserted;
  }

  static async updateVendor(id: string, data: {
    name: string;
    vendor_type: string;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    typical_rate?: number | null;
    notes?: string | null;
    is_preferred: boolean;
    is_active: boolean;
  }, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('vendors')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Vendor not found');
    }

    const formattedPhone = data.phone ? formatPhoneForStorage(data.phone) : null;

    const dbData = {
      name: data.name,
      service_type: data.vendor_type,
      contact_name: data.contact_name,
      contact_phone: formattedPhone,
      contact_email: data.email,
      website: data.website,
      typical_rate: data.typical_rate?.toString() ?? null,
      notes: data.notes,
      preferred: data.is_preferred,
      active: data.is_active
    };

    const { data: updated, error } = await admin
      .from('vendors')
      .update(dbData)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error updating vendor:', error);
      throw new Error(error.message || 'Failed to update vendor');
    }

    if (!updated) {
      throw new Error('Vendor not found');
    }

    if (updated) {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'update',
        resource_type: 'vendor',
        resource_id: id,
        operation_status: 'success',
        old_values: {
          name: existing.name,
          service_type: existing.service_type,
          contact_name: existing.contact_name,
          contact_phone: existing.contact_phone,
          contact_email: existing.contact_email,
          website: existing.website,
          typical_rate: existing.typical_rate,
          preferred: existing.preferred,
          active: existing.active
        },
        new_values: {
          name: updated.name,
          service_type: updated.service_type,
          contact_name: updated.contact_name,
          contact_phone: updated.contact_phone,
          contact_email: updated.contact_email,
          website: updated.website,
          typical_rate: updated.typical_rate,
          preferred: updated.preferred,
          active: updated.active
        }
      });
    }

    return updated;
  }

  static async deleteVendor(id: string, userId: string, userEmail?: string) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('vendors')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Vendor not found');
    }

    const { data: deletedVendor, error } = await admin
      .from('vendors')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error deleting vendor:', error);
      throw new Error(error.message || 'Failed to delete vendor');
    }

    if (!deletedVendor) {
      throw new Error('Vendor not found');
    }

    await logAuditEvent({
      user_id: userId,
      user_email: userEmail,
      operation_type: 'delete',
      resource_type: 'vendor',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        service_type: existing.service_type,
        contact_name: existing.contact_name,
        contact_phone: existing.contact_phone,
        contact_email: existing.contact_email,
        website: existing.website,
        typical_rate: existing.typical_rate,
        preferred: existing.preferred,
        active: existing.active
      }
    });

    return { success: true };
  }
}
