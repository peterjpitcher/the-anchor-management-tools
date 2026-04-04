import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { SmsQueueService } from '@/services/sms-queue';
import { syncCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { logger } from '@/lib/logger';
import {
  sendDepositReceivedEmail,
  sendBalancePaidEmail,
} from '@/lib/email/private-booking-emails';
import type {
  BookingStatus,
  PrivateBookingWithDetails,
  PaymentHistoryEntry,
  DepositPaymentEntry,
  BalancePaymentEntry,
} from '@/types/private-bookings';
import {
  type PrivateBookingSmsSideEffectSummary,
  normalizeSmsSafetyMeta,
  toNumber,
} from './types';

// ---------------------------------------------------------------------------
// Record deposit — caller handles auth check
// ---------------------------------------------------------------------------

export async function recordDeposit(bookingId: string, amount: number, method: string, performedByUserId?: string): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
  const supabase = await createClient();

  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, contact_email, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date, deposit_amount, balance_due_date, total_amount')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) throw new Error('Booking not found');

  if (booking.status === 'cancelled') {
    throw new Error('Cannot record a deposit on a cancelled booking');
  }

  if (booking.deposit_paid_date) {
    throw new Error('Deposit has already been recorded for this booking');
  }

  // Only transition status to confirmed when the booking is still a draft.
  // For already-confirmed or completed bookings, leave status and
  // cancellation_reason untouched to avoid unnecessary churn.
  const statusUpdate: Partial<{ status: BookingStatus; cancellation_reason: null }> =
    booking.status === 'draft'
      ? { status: 'confirmed', cancellation_reason: null }
      : {};

  const { data: updatedBooking, error } = await supabase
    .from('private_bookings')
    .update({
      deposit_paid_date: new Date().toISOString(),
      deposit_payment_method: method,
      deposit_amount: amount,
      ...statusUpdate,
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
      logger.error('Failed to record private booking confirmation analytics from deposit:', { error: analyticsError instanceof Error ? analyticsError : new Error(String(analyticsError)) });
    }
  }

  const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

  // SMS
  if (booking.contact_phone || booking.customer_id) {
    const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const smsMessage = `The Anchor: ${booking.customer_first_name}! Deposit received — your date on ${eventDate} is locked in. We'll be in touch closer to the time!`;

     
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

  // Send deposit received email (non-blocking)
  if (booking.contact_email) {
    sendDepositReceivedEmail({
      contact_email: booking.contact_email,
      customer_first_name: booking.customer_first_name,
      customer_name: booking.customer_name,
      event_date: booking.event_date,
      event_type: booking.event_type,
      deposit_amount: amount,
      deposit_payment_method: method,
      balance_due_date: booking.balance_due_date,
      total_amount: booking.total_amount,
    }).catch(e =>
      logger.error('Failed to send deposit received email', { error: e instanceof Error ? e : new Error(String(e)) })
    );
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
          logger.error('Failed to persist calendar event id after deposit:', { error: calendarUpdateError instanceof Error ? calendarUpdateError : new Error(String(calendarUpdateError)) });
        } else if (!updatedCalendarRow) {
          logger.error('Failed to persist calendar event id after deposit: booking row not found', { error: new Error('Failed to persist calendar event id after deposit: booking row not found') });
        }
      }
    } catch (error) {
      logger.error('Calendar sync failed during deposit record:', { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
}

// ---------------------------------------------------------------------------
// Record final payment — caller handles auth check
// ---------------------------------------------------------------------------

export async function recordFinalPayment(bookingId: string, method: string, performedByUserId?: string): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
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

  if (booking.contact_phone || booking.customer_id) {
    const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const smsMessage = `The Anchor: ${booking.customer_first_name}! Final payment received — you're all set for ${eventDate}. We'll be in touch with final details!`;

     
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

  return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
}

// ---------------------------------------------------------------------------
// Record balance payment (partial payments) — caller handles auth check
// ---------------------------------------------------------------------------

export async function recordBalancePayment(bookingId: string, amount: number, method: string, performedByUserId?: string): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
  const supabase = await createClient();

  // Fetch booking upfront -- needed for SMS context and calendar sync regardless of outcome.
  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, contact_email, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date, deposit_amount, total_amount')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) throw new Error('Booking not found');

  // Single atomic RPC: inserts payment, recalculates totals, and conditionally
  // stamps final_payment_date -- all within one transaction with a FOR UPDATE lock.
  const { data: result, error: rpcError } = await supabase
    .rpc('record_balance_payment', {
      p_booking_id: bookingId,
      p_amount: amount,
      p_method: method,
      p_recorded_by: performedByUserId ?? null,
    });

  if (rpcError) throw new Error('Failed to record payment');

  const isFullyPaid = result.is_fully_paid as boolean;

  // updatedBooking is only needed for calendar sync -- synthesise from known fields
  // when the booking is now fully paid (the RPC updated final_payment_date server-side).
  const updatedBooking = isFullyPaid
    ? { ...booking, final_payment_date: new Date().toISOString(), final_payment_method: method }
    : null;

  if (!isFullyPaid) {
    return { success: true };
  }

  const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

  // SMS
  if (booking.contact_phone || booking.customer_id) {
    const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const smsMessage = `The Anchor: ${booking.customer_first_name}! Final payment received — you're all set for ${eventDate}. We'll be in touch with final details!`;

     
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

  // Send balance paid email (non-blocking)
  if (booking.contact_email) {
    sendBalancePaidEmail({
      contact_email: booking.contact_email,
      customer_first_name: booking.customer_first_name,
      customer_name: booking.customer_name,
      event_date: booking.event_date,
      event_type: booking.event_type,
      total_amount: booking.total_amount,
    }).catch(e =>
      logger.error('Failed to send balance paid email', { error: e instanceof Error ? e : new Error(String(e)) })
    );
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
          logger.error('Failed to persist calendar event id after final payment:', { error: calendarUpdateError instanceof Error ? calendarUpdateError : new Error(String(calendarUpdateError)) });
        } else if (!updatedCalendarRow) {
          logger.error('Failed to persist calendar event id after final payment: booking row not found', { error: new Error('Failed to persist calendar event id after final payment: booking row not found') });
        }
      }
    } catch (error) {
      logger.error('Calendar sync failed during final payment record:', { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  return smsSideEffects.length > 0 ? { success: true, smsSideEffects } : { success: true };
}

// ---------------------------------------------------------------------------
// Payment history & admin payment CRUD
// NOTE: These functions use the admin client. Callers must verify auth before
// invoking them. The userId parameter is not required here because these are
// pure data operations -- audit logging is handled by the calling server action.
// ---------------------------------------------------------------------------

export async function getBookingPaymentHistory(bookingId: string): Promise<PaymentHistoryEntry[]> {
  const db = createAdminClient()

  const { data: booking, error: bookingError } = await db
    .from('private_bookings')
    .select('deposit_paid_date, deposit_amount, deposit_payment_method')
    .eq('id', bookingId)
    .single()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)

  const { data: payments, error: paymentsError } = await db
    .from('private_booking_payments')
    .select('id, amount, method, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })

  if (paymentsError) throw new Error(`Failed to fetch payments: ${paymentsError.message}`)

  const entries: PaymentHistoryEntry[] = []

  if (booking.deposit_paid_date) {
    entries.push({
      id: 'deposit',
      type: 'deposit',
      amount: booking.deposit_amount,
      method: booking.deposit_payment_method as DepositPaymentEntry['method'],
      date: toLocalIsoDate(new Date(booking.deposit_paid_date)),
    })
  }

  for (const payment of payments ?? []) {
    entries.push({
      id: payment.id,
      type: 'balance',
      amount: payment.amount,
      method: payment.method as BalancePaymentEntry['method'],
      date: toLocalIsoDate(new Date(payment.created_at)),
    })
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.type === 'deposit' && b.type === 'balance') return -1
    if (a.type === 'balance' && b.type === 'deposit') return 1
    return 0
  })

  return entries
}

export async function updateBalancePayment(
  paymentId: string,
  bookingId: string,
  data: { amount: number; method: string; notes?: string }
): Promise<void> {
  const db = createAdminClient()
  const { data: existing, error: checkError } = await db
    .from('private_booking_payments')
    .select('id')
    .eq('id', paymentId)
    .eq('booking_id', bookingId)
    .single()
  if (checkError || !existing) throw new Error('Payment not found or does not belong to this booking')

  const updatePayload: Record<string, unknown> = { amount: data.amount, method: data.method }
  if (data.notes !== undefined) updatePayload.notes = data.notes

  const { count: updateCount, error: updateError } = await db
    .from('private_booking_payments')
    .update(updatePayload, { count: 'exact' })
    .eq('id', paymentId)
  if (updateError) throw new Error(`Failed to update payment: ${updateError.message}`)
  if (updateCount !== 1) throw new Error(`Update affected ${updateCount} rows, expected 1`)

  const { error: rpcError } = await db.rpc('apply_balance_payment_status', { p_booking_id: bookingId })
  if (rpcError) throw new Error(`Failed to recalculate payment status: ${rpcError.message}`)
}

export async function deleteBalancePayment(paymentId: string, bookingId: string): Promise<void> {
  const db = createAdminClient()
  const { data: existing, error: checkError } = await db
    .from('private_booking_payments')
    .select('id')
    .eq('id', paymentId)
    .eq('booking_id', bookingId)
    .single()
  if (checkError || !existing) throw new Error('Payment not found or does not belong to this booking')

  const { count: deleteCount, error: deleteError } = await db
    .from('private_booking_payments')
    .delete({ count: 'exact' })
    .eq('id', paymentId)
  if (deleteError) throw new Error(`Failed to delete payment: ${deleteError.message}`)
  if (deleteCount !== 1) throw new Error(`Delete affected ${deleteCount} rows, expected 1`)

  const { error: rpcError } = await db.rpc('apply_balance_payment_status', { p_booking_id: bookingId })
  if (rpcError) throw new Error(`Failed to recalculate payment status: ${rpcError.message}`)
}

export async function updateDeposit(
  bookingId: string,
  data: { amount: number; method: string }
): Promise<void> {
  const db = createAdminClient()
  const { error } = await db
    .from('private_bookings')
    .update({ deposit_amount: data.amount, deposit_payment_method: data.method })
    .eq('id', bookingId)
  if (error) throw new Error(`Failed to update deposit: ${error.message}`)
}

// Returns statusReverted so the calling server action can include it in the audit log.
export async function deleteDeposit(bookingId: string): Promise<{ statusReverted: boolean }> {
  const db = createAdminClient()
  const { data: booking, error: fetchError } = await db
    .from('private_bookings')
    .select('status, deposit_paid_date, deposit_amount, deposit_payment_method')
    .eq('id', bookingId)
    .single()
  if (fetchError || !booking) throw new Error('Booking not found')

  const { error: updateError } = await db
    .from('private_bookings')
    .update({ deposit_paid_date: null, deposit_payment_method: null })
    .eq('id', bookingId)
  if (updateError) throw new Error(`Failed to clear deposit: ${updateError.message}`)

  let statusReverted = false
  if (booking.status === 'confirmed') {
    const { count, error: countError } = await db
      .from('private_booking_payments')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
    if (!countError && count === 0) {
      const { error: statusError } = await db
        .from('private_bookings')
        .update({ status: 'draft' })
        .eq('id', bookingId)
      if (statusError) throw new Error(`Failed to revert booking status: ${statusError.message}`)
      statusReverted = true
      if (isCalendarConfigured()) {
        const { data: fullBooking } = await db.from('private_bookings').select('*').eq('id', bookingId).single()
        if (fullBooking) syncCalendarEvent(fullBooking).catch(() => {})
      }
    }
  }
  return { statusReverted }
}
