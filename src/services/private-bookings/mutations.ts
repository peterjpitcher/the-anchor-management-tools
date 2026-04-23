import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage } from '@/lib/utils';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { SmsQueueService } from '@/services/sms-queue';
import { syncCalendarEvent, deleteCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { logAuditEvent } from '@/app/actions/audit';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { logger } from '@/lib/logger';
import {
  sendBookingConfirmationEmail,
  sendBookingCalendarInvite,
} from '@/lib/email/private-booking-emails';
import type {
  BookingStatus,
  PrivateBookingWithDetails,
} from '@/types/private-bookings';
import {
  type CreatePrivateBookingInput,
  type UpdatePrivateBookingInput,
  type PrivateBookingSmsSideEffectSummary,
  normalizeSmsSafetyMeta,
  toNumber,
  computeHoldExpiry,
  DATE_TBD_NOTE,
  DEFAULT_TBD_TIME,
} from './types';
import {
  privateBookingCreatedMessage,
  bookingConfirmedMessage,
  setupReminderMessage,
  dateChangedMessage,
  bookingCompletedThanksMessage,
  bookingExpiredMessage,
  holdExtendedMessage,
  bookingCancelledHoldMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledNonRefundableMessage,
  bookingCancelledManualReviewMessage,
} from '@/lib/private-bookings/messages';
import {
  getPrivateBookingCancellationOutcome,
  type CancellationFinancialOutcome,
} from '@/services/private-bookings/financial';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

 
async function sendCreationSms(booking: any, phone?: string | null): Promise<void> {
  const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const depositAmount = toNumber(booking.deposit_amount);

  // Calculate hold expiry (14 days from creation)
  const holdExpiryDate = booking.hold_expiry ? new Date(booking.hold_expiry) : new Date();
  const expiryReadable = holdExpiryDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long'
  });

  const smsMessage = privateBookingCreatedMessage({
    customerFirstName: booking.customer_first_name,
    eventDate: eventDateReadable,
    depositAmount: depositAmount,
    holdExpiry: expiryReadable,
  });

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
    logger.error('Failed to queue booking created SMS after booking creation:', { error: smsError instanceof Error ? smsError : new Error(String(smsError)) });
  }
}

type CancellationSmsVariant = {
  triggerType:
    | 'booking_cancelled_hold'
    | 'booking_cancelled_refundable'
    | 'booking_cancelled_non_refundable'
    | 'booking_cancelled_manual_review'
  templateKey:
    | 'private_booking_cancelled_hold'
    | 'private_booking_cancelled_refundable'
    | 'private_booking_cancelled_non_refundable'
    | 'private_booking_cancelled_manual_review'
  messageBody: string
  outcome: CancellationFinancialOutcome
  refundAmount: number
  retainedAmount: number
}

/**
 * Resolve the cancellation SMS variant for a booking from its financial
 * outcome. Returns the trigger/template keys and the rendered message body
 * so `cancelBooking()` and the status-change cancel path in `updateBooking()`
 * can queue a single variant-specific SMS instead of the generic
 * `booking_cancelled` placeholder that Wave 2 left in place.
 */
async function resolveCancellationSmsVariant(input: {
  bookingId: string
  customerFirstName: string | null | undefined
  eventDate: string
}): Promise<CancellationSmsVariant> {
  const outcome = await getPrivateBookingCancellationOutcome(input.bookingId)

  switch (outcome.outcome) {
    case 'no_money':
      return {
        triggerType: 'booking_cancelled_hold',
        templateKey: 'private_booking_cancelled_hold',
        messageBody: bookingCancelledHoldMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'refundable':
      return {
        triggerType: 'booking_cancelled_refundable',
        templateKey: 'private_booking_cancelled_refundable',
        messageBody: bookingCancelledRefundableMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
          refundAmount: outcome.refund_amount,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'non_refundable_retained':
      return {
        triggerType: 'booking_cancelled_non_refundable',
        templateKey: 'private_booking_cancelled_non_refundable',
        messageBody: bookingCancelledNonRefundableMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
          retainedAmount: outcome.retained_amount,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'manual_review':
    default:
      return {
        triggerType: 'booking_cancelled_manual_review',
        templateKey: 'private_booking_cancelled_manual_review',
        messageBody: bookingCancelledManualReviewMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
        }),
        outcome: 'manual_review',
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
  }
}

// ---------------------------------------------------------------------------
// Create booking
// ---------------------------------------------------------------------------

 
export async function createBooking(input: CreatePrivateBookingInput): Promise<any> {
  const supabase = await createClient();

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
  const sevenDaysBeforeEvent = new Date(actualEventDate);
  sevenDaysBeforeEvent.setDate(sevenDaysBeforeEvent.getDate() - 7);

  if (input.hold_expiry) {
    // User manually specified a date
    holdExpiryMoment = new Date(input.hold_expiry);

    const isShortNotice = currentDateTime.getTime() > sevenDaysBeforeEvent.getTime();

    if (!isShortNotice) {
      if (holdExpiryMoment.getTime() > sevenDaysBeforeEvent.getTime()) {
        holdExpiryMoment = sevenDaysBeforeEvent;
      }
    } else {
      if (holdExpiryMoment.getTime() > actualEventDate.getTime()) {
        holdExpiryMoment = actualEventDate;
      }
    }
  } else {
    // Default auto-calculation
    holdExpiryMoment = computeHoldExpiry(actualEventDate, currentDateTime);
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
    hold_expiry: holdExpiryIso,
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
    logger.error('Create private booking transaction error:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error('Failed to create private booking');
  }

  // 3. Side Effects (Fire and Forget / Non-blocking mostly)

  // SMS
  if (booking) {
    const bookingWithHoldExpiry = { ...booking, hold_expiry: holdExpiryIso };
    void sendCreationSms(bookingWithHoldExpiry, normalizedContactPhone).catch((smsError) => {
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
            logger.error('Failed to persist calendar_event_id after booking create:', { error: calendarUpdateError instanceof Error ? calendarUpdateError : new Error(String(calendarUpdateError)) });
          } else if (!updatedCalendarRow) {
            logger.error('Failed to persist calendar_event_id after booking create: booking row not found', { error: new Error('Failed to persist calendar_event_id after booking create: booking row not found') });
          }
        }
      } catch (e) {
        logger.error('Calendar sync failed:', { error: e instanceof Error ? e : new Error(String(e)) });
      }
    }
  }

  return booking;
}

// ---------------------------------------------------------------------------
// Update booking
// ---------------------------------------------------------------------------

 
export async function updateBooking(id: string, input: UpdatePrivateBookingInput, performedByUserId?: string): Promise<any> {
  const supabase = await createClient();

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
      logger.error('Failed to verify completed-booking SMS duplicate guard:', { error: duplicateCheckError instanceof Error ? duplicateCheckError : new Error(String(duplicateCheckError)) });
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

    holdExpiryIso = computeHoldExpiry(newEventDate, currentDateTime).toISOString();
  }

  const finalStartTime = input.start_time || currentBooking.start_time || DEFAULT_TBD_TIME;

  let endTimeNextDay = currentBooking.end_time_next_day ?? false;
  const cleanedEndTime = input.end_time || (input.end_time === '' ? null : undefined);

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
    customer_name,
    contact_phone: normalizedContactPhone,
    contact_email: normalizedContactEmail,
    event_date: finalEventDate,
    start_time: finalStartTime,
    setup_date: normalizedSetupDate,
    setup_time: normalizedSetupTime,
    end_time: cleanedEndTime,
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
    logger.error('Error updating private booking:', { error: error instanceof Error ? error : new Error(String(error)) });
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

    const smsMessage = dateChangedMessage({
      customerFirstName: updatedBooking.customer_first_name,
      newEventDate: eventDateReadable,
    });

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

    const messageBody = setupReminderMessage({
      customerFirstName: firstName,
      eventDate: eventDateReadable,
    });

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
        logger.error('Failed to record private booking confirmation analytics:', { error: analyticsError instanceof Error ? analyticsError : new Error(String(analyticsError)) });
      }

      // Send confirmation email (non-blocking)
      if (updatedBooking.contact_email) {
        sendBookingConfirmationEmail(updatedBooking).catch(e =>
          logger.error('Failed to send booking confirmation email', { error: e instanceof Error ? e : new Error(String(e)) })
        );
        // Send calendar invite alongside confirmation (non-blocking)
        sendBookingCalendarInvite(updatedBooking).catch(e =>
          logger.error('Failed to send calendar invite', { error: e instanceof Error ? e : new Error(String(e)) })
        );
      }
    }

    if (!abortSmsSideEffects && updatedBooking.status === 'confirmed' && !updatedBooking.deposit_paid_date) {
      const messageBody = bookingConfirmedMessage({
        customerFirstName: firstName,
        eventDate: eventDateReadable,
      });

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
      // Pick the variant keyed by the financial outcome (no_money /
      // refundable / non-refundable / manual review). See
      // `resolveCancellationSmsVariant` for the mapping.
      const variant = await resolveCancellationSmsVariant({
        bookingId: updatedBooking.id,
        customerFirstName: firstName,
        eventDate: eventDateReadable,
      })

      const result = await SmsQueueService.queueAndSend({
        booking_id: updatedBooking.id,
        trigger_type: variant.triggerType,
        template_key: variant.templateKey,
        message_body: variant.messageBody,
        customer_phone: updatedBooking.contact_phone,
        customer_name:
          updatedBooking.customer_name ||
          `${updatedBooking.customer_first_name ?? ''} ${updatedBooking.customer_last_name ?? ''}`.trim(),
        customer_id: updatedBooking.customer_id,
        created_by: performedByUserId,
        priority: 2,
        metadata: {
          template: variant.templateKey,
          event_date: eventDateReadable,
          reason: 'status_change',
          financial_outcome: variant.outcome,
          refund_amount: variant.refundAmount,
          retained_amount: variant.retainedAmount,
        }
      })
      captureSmsSideEffect(variant.triggerType, variant.templateKey, result)
    }

    if (!abortSmsSideEffects && updatedBooking.status === 'completed' && !completedStatusAlreadyMessaged) {
      const messageBody = bookingCompletedThanksMessage({
        customerFirstName: firstName,
      });

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
              logger.error('Failed to clear private booking calendar event id after removal:', { error: clearCalendarError instanceof Error ? clearCalendarError : new Error(String(clearCalendarError)) })
            } else if (!clearedCalendarRow) {
              logger.error('Failed to clear private booking calendar event id after removal: booking row not found', { error: new Error('Failed to clear private booking calendar event id after removal: booking row not found') })
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
          logger.error('Failed to persist private booking calendar event id during update:', { error: calendarUpdateError instanceof Error ? calendarUpdateError : new Error(String(calendarUpdateError)) });
        } else if (!updatedCalendarRow) {
          logger.error('Failed to persist private booking calendar event id during update: booking row not found', { error: new Error('Failed to persist private booking calendar event id during update: booking row not found') });
        }
        updatedBooking.calendar_event_id = eventId
      }
    } catch (error) {
      logger.error('Calendar sync exception:', { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  if (smsSideEffects.length > 0) {
     
    ;(updatedBooking as any).smsSideEffects = smsSideEffects
  }
  return updatedBooking;
}

// ---------------------------------------------------------------------------
// Update booking status (with transition validation)
// ---------------------------------------------------------------------------

 
export async function updateBookingStatus(id: string, status: BookingStatus, performedByUserId?: string): Promise<any> {
  const supabase = await createClient()
  const { data: current, error } = await supabase
    .from('private_bookings')
    .select('status')
    .eq('id', id)
    .single()

  if (error || !current) throw new Error('Booking not found')

  const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
    draft:     ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    completed: [],
    cancelled: ['draft'],
  }

  const currentStatus = current.status as BookingStatus
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? []
  if (!allowed.includes(status)) {
    throw new Error(
      `Cannot transition booking from '${currentStatus}' to '${status}'`
    )
  }

  return updateBooking(id, { status }, performedByUserId)
}

// ---------------------------------------------------------------------------
// Apply discount
// ---------------------------------------------------------------------------

export async function applyBookingDiscount(
  bookingId: string,
  data: {
    discount_type: 'percent' | 'fixed';
    discount_amount: number;
    discount_reason: string;
  }
): Promise<{ success: true }> {
  // Server-side discount validation
  if (data.discount_type !== 'percent' && data.discount_type !== 'fixed') {
    throw new Error('Invalid discount type -- must be "percent" or "fixed"');
  }
  if (typeof data.discount_amount !== 'number' || !Number.isFinite(data.discount_amount) || data.discount_amount <= 0) {
    throw new Error('Invalid discount value -- must be a positive number');
  }
  if (data.discount_type === 'percent' && data.discount_amount > 100) {
    throw new Error('Percentage discount cannot exceed 100%');
  }

  const supabase = await createClient();

  // For fixed discounts, validate against booking total
  if (data.discount_type === 'fixed') {
    const { data: booking, error: fetchError } = await supabase
      .from('private_bookings')
      .select('total_amount')
      .eq('id', bookingId)
      .maybeSingle();

    if (fetchError || !booking) {
      throw new Error('Booking not found');
    }

    const totalAmount = toNumber(booking.total_amount, 0);
    if (totalAmount > 0 && data.discount_amount > totalAmount) {
      throw new Error('Fixed discount cannot exceed the booking total');
    }
  }

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
    logger.error('Error applying booking discount:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to apply booking discount');
  }

  if (!updatedBooking) {
    throw new Error('Booking not found');
  }

  // Reconcile payment status — discount changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: bookingId });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after discount change:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Cancel booking
// ---------------------------------------------------------------------------

export async function cancelBooking(id: string, reason: string, performedByUserId?: string): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
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
          logger.error('Failed to clear calendar event id after cancellation:', { error: clearCalendarError instanceof Error ? clearCalendarError : new Error(String(clearCalendarError)) });
        } else if (!clearedCalendarRow) {
          logger.error('Failed to clear calendar event id after cancellation: booking row not found', { error: new Error('Failed to clear calendar event id after cancellation: booking row not found') });
        }
      }
    } catch (error) {
      logger.error('Failed to delete calendar event:', { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

  // 4. SMS Notification
  if (booking.contact_phone || booking.customer_id) {
    const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const firstName = booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there';
    // Pick the cancellation variant based on paid totals + dispute state.
    // See `resolveCancellationSmsVariant` for the four-outcome mapping.
    const variant = await resolveCancellationSmsVariant({
      bookingId: id,
      customerFirstName: firstName,
      eventDate: eventDate,
    })


    let smsResult: any
    try {
      smsResult = await SmsQueueService.queueAndSend({
        booking_id: id,
        trigger_type: variant.triggerType,
        template_key: variant.templateKey,
        message_body: variant.messageBody,
        customer_phone: booking.contact_phone,
        customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
        customer_id: booking.customer_id,
        created_by: performedByUserId,
        priority: 2,
        metadata: {
          template: variant.templateKey,
          event_date: eventDate,
          reason: reason || 'staff_cancelled',
          financial_outcome: variant.outcome,
          refund_amount: variant.refundAmount,
          retained_amount: variant.retainedAmount,
        }
      });
    } catch (smsError) {
      smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
    }

    const smsSafety = normalizeSmsSafetyMeta(smsResult)
    const smsSummary: PrivateBookingSmsSideEffectSummary = {
      triggerType: variant.triggerType,
      templateKey: variant.templateKey,
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

  await logAuditEvent({
    user_id: performedByUserId,
    operation_type: 'update',
    resource_type: 'private_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: { action: 'cancellation', reason: reason || 'staff_cancelled' },
  })

  return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
}

// ---------------------------------------------------------------------------
// Expire booking
// ---------------------------------------------------------------------------

export async function expireBooking(
  id: string,
  options?: { sendNotification?: boolean; asSystem?: boolean }
): Promise<{ success: true; smsSent: boolean; smsCode: string | null; smsLogFailure: boolean }> {
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
          logger.error('Failed to clear calendar event id after expiry:', { error: clearCalendarError instanceof Error ? clearCalendarError : new Error(String(clearCalendarError)) });
        } else if (!clearedCalendarRow) {
          logger.error('Failed to clear calendar event id after expiry: booking row not found', { error: new Error('Failed to clear calendar event id after expiry: booking row not found') });
        }
      }
    } catch (error) {
      logger.error('Failed to delete calendar event:', { error: error instanceof Error ? error : new Error(String(error)) });
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

    const smsMessage = bookingExpiredMessage({
      customerFirstName: booking.customer_first_name,
      eventDate: eventDate,
    });

     
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
      logger.error('Failed to queue expiry SMS notification:', { error: error instanceof Error ? error : new Error(String(error)) })
      smsResult = { error: 'Failed to queue SMS notification' }
    }

    const smsSafety = normalizeSmsSafetyMeta(smsResult)
    smsCode = smsSafety.code
    smsLogFailure = smsSafety.logFailure
    smsSent = Boolean(!smsResult.error && 'sent' in smsResult && smsResult.sent)
  }

  return { success: true, smsSent, smsCode, smsLogFailure };
}

// ---------------------------------------------------------------------------
// Extend hold
// ---------------------------------------------------------------------------

export async function extendHold(
  id: string,
  days: 7 | 14 | 30,
  extendedBy?: string
): Promise<{ success: true; newExpiry: string; smsSent: boolean }> {
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

    const smsMessage = holdExtendedMessage({
      customerFirstName: booking.customer_first_name,
      eventDate: eventDateReadable,
      newExpiryDate: expiryReadable,
    });

     
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
      logger.error('Failed to queue hold extension SMS:', { error: error instanceof Error ? error : new Error(String(error)) });
      smsResult = { error: 'Failed to queue SMS' };
    }

    if (smsResult?.error) {
      logger.error('Hold extension SMS failed:', {
        error: new Error(String(smsResult.error)),
        metadata: { bookingId: id, code: smsResult.code }
      });
    }

    const smsSafety = normalizeSmsSafetyMeta(smsResult);
    smsSent = Boolean(!smsResult?.error && 'sent' in smsResult && smsResult.sent);
  }

  return { success: true, newExpiry: newExpiryIso, smsSent };
}

// ---------------------------------------------------------------------------
// Delete booking
// ---------------------------------------------------------------------------

 
export async function deletePrivateBooking(id: string): Promise<{ deletedBooking: any }> {
  const supabase = await createClient();

  // GATE: block if any SMS was sent, or is approved-and-scheduled for a future
  // time — UNLESS the booking is already cancelled (customer already notified).
  // The DB trigger is the last-line defence; this action-layer check surfaces
  // a friendly error for the UI.
  const { data: bookingRow, error: bookingCheckError } = await supabase
    .from('private_bookings')
    .select('status')
    .eq('id', id)
    .single();

  if (bookingCheckError) {
    throw new Error('Booking not found or inaccessible.');
  }

  // Skip SMS gate for cancelled bookings — customer already notified
  if (bookingRow.status !== 'cancelled') {
    const { data: blockingRows, error: blockingError } = await supabase
      .from('private_booking_sms_queue')
      .select('id, status, scheduled_for')
      .eq('booking_id', id)
      .or('status.eq.sent,and(status.eq.approved,scheduled_for.gt.now())');

    if (blockingError) {
      const blockingErr = blockingError as { message?: string } | null;
      logger.error('deletePrivateBooking: failed to check SMS gate', {
        error: blockingError instanceof Error
          ? blockingError
          : new Error(String(blockingErr?.message ?? blockingError)),
        metadata: { bookingId: id },
      });
      throw new Error('Failed to verify delete eligibility; please try again.');
    }

    if (blockingRows && blockingRows.length > 0) {
      throw new Error(
        `Cannot delete booking: customer has received ${blockingRows.length} SMS message(s). Use Cancel instead so they're notified.`,
      );
    }
  }

  // Calendar Cleanup
  if (isCalendarConfigured()) {
    try {
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
      logger.error('Failed to delete calendar event during booking deletion:', { error: error instanceof Error ? error : new Error(String(error)) });
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
    logger.error('Error deleting private booking:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to delete private booking');
  }

  return { deletedBooking: data };
}

// ---------------------------------------------------------------------------
// Add note — userId required, caller handles auth
// ---------------------------------------------------------------------------

export async function addNote(bookingId: string, note: string, userId: string, userEmail?: string): Promise<{ success: true }> {
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

  if (error) throw new Error(`Failed to save note: ${error.message} (code: ${error.code})`);

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

// ---------------------------------------------------------------------------
// Booking items
// ---------------------------------------------------------------------------

export async function addBookingItem(data: {
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
}): Promise<{ success: true }> {
  const supabase = await createClient();

  const { data: lastItem, error: orderError } = await supabase
    .from('private_booking_items')
    .select('display_order')
    .eq('booking_id', data.booking_id)
    .order('display_order', { ascending: false })
    .limit(1);

  if (orderError) {
    logger.error('Error determining next item order:', { error: orderError instanceof Error ? orderError : new Error(String(orderError)) });
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
    logger.error('Error adding booking item:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to add booking item');
  }

  // Reconcile payment status — item changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: data.booking_id });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after item add:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  return { success: true };
}

export async function updateBookingItem(itemId: string, data: {
  quantity?: number;
  unit_price?: number;
  discount_value?: number;
  discount_type?: 'percent' | 'fixed';
  notes?: string | null;
}): Promise<{ success: true; bookingId: string }> {
  const supabase = await createClient();

  const { data: currentItem, error: fetchError } = await supabase
    .from('private_booking_items')
    .select('booking_id')
    .eq('id', itemId)
    .single();

  if (fetchError || !currentItem) {
    throw new Error('Item not found');
  }

   
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
    logger.error('Error updating booking item:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to update booking item');
  }

  if (!updatedItem) {
    throw new Error('Item not found');
  }

  // Reconcile payment status — item changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: currentItem.booking_id });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after item update:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  return { success: true, bookingId: currentItem.booking_id };
}

export async function deleteBookingItem(itemId: string): Promise<{ success: true; bookingId: string }> {
  const supabase = await createClient();

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
    logger.error('Error deleting booking item:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to delete booking item');
  }

  if (!deletedItem) {
    throw new Error('Item not found');
  }

  // Reconcile payment status — item changes can affect whether booking is still fully paid
  try {
    const admin = createAdminClient();
    await admin.rpc('apply_balance_payment_status', { p_booking_id: item.booking_id });
  } catch (reconcileError) {
    logger.error('Failed to reconcile payment status after item delete:', { error: reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)) });
  }

  return { success: true, bookingId: item.booking_id };
}

export async function reorderBookingItems(bookingId: string, orderedIds: string[]): Promise<{ success: true }> {
  const supabase = await createClient();

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('No booking items supplied for reordering');
  }

  const { data: existingItems, error: fetchError } = await supabase
    .from('private_booking_items')
    .select('id, display_order')
    .eq('booking_id', bookingId);

  if (fetchError) {
    logger.error('Error fetching booking items for reorder:', { error: fetchError instanceof Error ? fetchError : new Error(String(fetchError)) });
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
          logger.error('Failed to restore booking item order during rollback:', { error: restoreError instanceof Error ? restoreError : new Error(String(restoreError)) })
          return
        }

        if (!restoredRow) {
          logger.error('Failed to restore booking item order during rollback: item no longer exists', { error: new Error('item no longer exists'), metadata: { id, bookingId } })
        }
      })
    );

    logger.error('Error updating booking item order:', { error: updateFailure instanceof Error ? updateFailure : new Error(String(updateFailure)) });
    throw new Error(
      updateFailure instanceof Error
        ? updateFailure.message
        : 'Failed to update booking item order'
    );
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Venue Space Management — userId required, caller handles auth
// ---------------------------------------------------------------------------

 
export async function createVenueSpace(data: {
  name: string;
  capacity: number;
  capacity_standing: number;
  hire_cost: number;
  description?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
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
    logger.error('Error creating venue space:', { error: error instanceof Error ? error : new Error(String(error)) });
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

 
export async function updateVenueSpace(id: string, data: {
  name: string;
  capacity: number;
  capacity_standing: number;
  hire_cost: number;
  description?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
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
    logger.error('Error updating venue space:', { error: error instanceof Error ? error : new Error(String(error)) });
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

export async function deleteVenueSpace(id: string, userId: string, userEmail?: string): Promise<{ success: true }> {
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
    logger.error('Error deleting venue space:', { error: error instanceof Error ? error : new Error(String(error)) });
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

// ---------------------------------------------------------------------------
// Catering Package Management — userId required, caller handles auth
// ---------------------------------------------------------------------------

 
export async function createCateringPackage(data: {
  name: string;
  serving_style: string;
  category: 'food' | 'drink' | 'addon';
  per_head_cost: number;
  pricing_model?: 'per_head' | 'total_value';
  minimum_order?: number | null;
  summary?: string | null;
  includes?: string | null;
  served?: string | null;
  good_to_know?: string | null;
  guest_description?: string | null;
  dietary_notes?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
  const admin = createAdminClient();

  const dbData = {
    name: data.name,
    serving_style: data.serving_style,
    category: data.category,
    cost_per_head: data.per_head_cost,
    pricing_model: data.pricing_model || 'per_head',
    minimum_guests: data.minimum_order,
    summary: data.summary,
    includes: data.includes,
    served: data.served,
    good_to_know: data.good_to_know,
    guest_description: data.guest_description,
    dietary_notes: data.dietary_notes,
    active: data.is_active,
    display_order: 0
  };

  const { data: inserted, error } = await admin
    .from('catering_packages')
    .insert(dbData)
    .select()
    .single();

  if (error) {
    logger.error('Error creating catering package:', { error: error instanceof Error ? error : new Error(String(error)) });
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
        summary: inserted.summary,
        includes: inserted.includes,
        served: inserted.served,
        good_to_know: inserted.good_to_know,
        guest_description: inserted.guest_description,
        dietary_notes: inserted.dietary_notes,
        active: inserted.active
      }
    });
  }

  return inserted;
}

 
export async function updateCateringPackage(id: string, data: {
  name: string;
  serving_style: string;
  category: 'food' | 'drink' | 'addon';
  per_head_cost: number;
  pricing_model?: 'per_head' | 'total_value';
  minimum_order?: number | null;
  summary?: string | null;
  includes?: string | null;
  served?: string | null;
  good_to_know?: string | null;
  guest_description?: string | null;
  dietary_notes?: string | null;
  is_active: boolean;
}, userId: string, userEmail?: string): Promise<any> {
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
    summary: data.summary,
    includes: data.includes,
    served: data.served,
    good_to_know: data.good_to_know,
    guest_description: data.guest_description,
    dietary_notes: data.dietary_notes,
    active: data.is_active
  };

  const { data: updated, error } = await admin
    .from('catering_packages')
    .update(dbData)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('Error updating catering package:', { error: error instanceof Error ? error : new Error(String(error)) });
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
        cost_per_head: existing.cost_per_head,
        pricing_model: existing.pricing_model,
        minimum_guests: existing.minimum_guests,
        summary: existing.summary,
        includes: existing.includes,
        served: existing.served,
        good_to_know: existing.good_to_know,
        guest_description: existing.guest_description,
        dietary_notes: existing.dietary_notes,
        active: existing.active
      },
      new_values: {
        name: updated.name,
        cost_per_head: updated.cost_per_head,
        pricing_model: updated.pricing_model,
        minimum_guests: updated.minimum_guests,
        summary: updated.summary,
        includes: updated.includes,
        served: updated.served,
        good_to_know: updated.good_to_know,
        guest_description: updated.guest_description,
        dietary_notes: updated.dietary_notes,
        active: updated.active
      }
    });
  }

  return updated;
}

export async function deleteCateringPackage(id: string, userId: string, userEmail?: string): Promise<{ success: true }> {
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
    logger.error('Error deleting catering package:', { error: error instanceof Error ? error : new Error(String(error)) });
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

// ---------------------------------------------------------------------------
// Vendor Management — userId required, caller handles auth
// ---------------------------------------------------------------------------

 
export async function createVendor(data: {
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
}, userId: string, userEmail?: string): Promise<any> {
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
    logger.error('Error creating vendor:', { error: error instanceof Error ? error : new Error(String(error)) });
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

 
export async function updateVendor(id: string, data: {
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
}, userId: string, userEmail?: string): Promise<any> {
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
    logger.error('Error updating vendor:', { error: error instanceof Error ? error : new Error(String(error)) });
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

export async function deleteVendor(id: string, userId: string, userEmail?: string): Promise<{ success: true }> {
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
    logger.error('Error deleting vendor:', { error: error instanceof Error ? error : new Error(String(error)) });
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
