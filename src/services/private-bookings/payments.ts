import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDateInLondon, toLocalIsoDate } from '@/lib/dateUtils';
import { SmsQueueService } from '@/services/sms-queue';
import { syncCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';
import {
  sendDepositReceivedEmail,
  sendBalancePaidEmail,
  sendBookingConfirmationEmail,
  sendBookingCalendarInvite,
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
import {
  checkCapacity,
  getBookingConflictSummary,
  getBookingSpaceIds,
} from './conflicts';
import {
  bookingConfirmedMessage,
  depositReceivedMessage,
  finalPaymentMessage,
} from '@/lib/private-bookings/messages';
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection';

type SupabaseClientLike = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient> | any

type FinalizeDepositPaymentInput = {
  bookingId: string
  amount: number
  method: string
  performedByUserId?: string
  paypalCaptureId?: string | null
}

type FinalizeDepositPaymentResult = {
  success: true
  alreadyRecorded?: boolean
  smsSideEffects?: PrivateBookingSmsSideEffectSummary[]
}

function formatEventDate(eventDate: string | null | undefined, booking?: { date_tbd?: boolean | null; internal_notes?: string | null }): string {
  if (booking && isBookingDateTbd(booking)) return 'Date to be confirmed'
  return eventDate
    ? formatDateInLondon(eventDate, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ''
}

function summarizeSmsResult(
  triggerType: string,
  templateKey: string,
  result: any,
  bookingId: string,
): PrivateBookingSmsSideEffectSummary {
  const smsSafety = normalizeSmsSafetyMeta(result)
  const summary: PrivateBookingSmsSideEffectSummary = {
    triggerType,
    templateKey,
    queueId: typeof result?.queueId === 'string' ? result.queueId : undefined,
    sent: result?.sent === true,
    suppressed: result?.suppressed === true,
    requiresApproval: result?.requiresApproval === true,
    code: smsSafety.code,
    logFailure: smsSafety.logFailure,
    error: typeof result?.error === 'string' ? result.error : undefined
  }

  if (summary.logFailure) {
    logger.error('Private booking SMS logging failed', {
      metadata: {
        bookingId,
        triggerType,
        templateKey,
        code: summary.code ?? null
      }
    })
  }

  if (summary.error) {
    logger.error('Private booking SMS queue/send failed', {
      metadata: {
        bookingId,
        triggerType,
        templateKey,
        error: summary.error
      }
    })
  }

  return summary
}

async function sendDepositReceivedSideEffects(input: {
  db: SupabaseClientLike
  booking: any
  updatedBooking: any
  amount: number
  method: string
  performedByUserId?: string
  calculatedTotal?: number | null
}): Promise<PrivateBookingSmsSideEffectSummary[]> {
  const { db, booking, updatedBooking, amount, method, performedByUserId, calculatedTotal } = input
  const bookingId = booking.id
  const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

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

  if (booking.contact_phone || booking.customer_id) {
    const eventDate = formatEventDate(booking.event_date, booking)
    const smsMessage = depositReceivedMessage({
      customerFirstName: booking.customer_first_name,
      eventDate,
    });

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
          amount,
          event_date: eventDate
        }
      });
    } catch (smsError) {
      smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
    }

    smsSideEffects.push(
      summarizeSmsResult('deposit_received', 'private_booking_deposit_received', smsResult, bookingId)
    )
  }

  if (booking.contact_email) {
    const depositEmailDate = isBookingDateTbd(booking) ? 'Date to be confirmed' : booking.event_date;
    sendDepositReceivedEmail({
      id: booking.id,
      customer_id: booking.customer_id,
      contact_email: booking.contact_email,
      customer_first_name: booking.customer_first_name,
      customer_name: booking.customer_name,
      event_date: depositEmailDate,
      event_type: booking.event_type,
      start_time: booking.start_time,
      end_time: booking.end_time,
      guest_count: booking.guest_count,
      deposit_amount: amount,
      deposit_payment_method: method,
      balance_due_date: booking.balance_due_date,
      total_amount: calculatedTotal ?? booking.total_amount,
    }).catch(e =>
      logger.error('Failed to send deposit received email', { error: e instanceof Error ? e : new Error(String(e)) })
    );
  }

  if (updatedBooking && isCalendarConfigured()) {
    try {
      const fullBookingForSync = {
        ...booking,
        ...updatedBooking,
      } as PrivateBookingWithDetails;

      const eventId = await syncCalendarEvent(fullBookingForSync);
      if (eventId && eventId !== booking.calendar_event_id) {
        const { data: updatedCalendarRow, error: calendarUpdateError } = await db
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

  return smsSideEffects
}

export async function sendBookingConfirmedSideEffects(input: {
  db?: SupabaseClientLike
  booking: any
  performedByUserId?: string
  analyticsVia: string
  syncCalendar?: boolean
}): Promise<PrivateBookingSmsSideEffectSummary[]> {
  const db = input.db ?? createAdminClient()
  const booking = input.booking
  const bookingId = booking.id
  const eventDate = formatEventDate(booking.event_date, booking)
  const firstName =
    booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there'
  const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

  if (booking.customer_id) {
    try {
      const adminClient = createAdminClient()
      await recordAnalyticsEvent(adminClient, {
        customerId: booking.customer_id,
        privateBookingId: bookingId,
        eventType: 'private_booking_confirmed',
        metadata: {
          via: input.analyticsVia,
          event_type: booking.event_type ?? null
        }
      })
    } catch (analyticsError) {
      logger.error('Failed to record private booking confirmation analytics:', {
        error: analyticsError instanceof Error ? analyticsError : new Error(String(analyticsError))
      })
    }
  }

  if (booking.contact_email) {
    sendBookingConfirmationEmail(booking).catch(e =>
      logger.error('Failed to send booking confirmation email', { error: e instanceof Error ? e : new Error(String(e)) })
    )
    sendBookingCalendarInvite(booking).catch(e =>
      logger.error('Failed to send calendar invite', { error: e instanceof Error ? e : new Error(String(e)) })
    )
  }

  if (booking.contact_phone || booking.customer_id) {
    const messageBody = bookingConfirmedMessage({
      customerFirstName: firstName,
      eventDate,
    })

    let smsResult: any
    try {
      smsResult = await SmsQueueService.queueAndSend({
        booking_id: bookingId,
        trigger_type: 'booking_confirmed',
        template_key: 'private_booking_confirmed',
        message_body: messageBody,
        customer_phone: booking.contact_phone,
        customer_name:
          booking.customer_name ||
          `${booking.customer_first_name ?? ''} ${booking.customer_last_name ?? ''}`.trim(),
        customer_id: booking.customer_id,
        created_by: input.performedByUserId,
        priority: 1,
        metadata: {
          template: 'private_booking_confirmed',
          event_date: eventDate,
          event_type: booking.event_type ?? null
        }
      })
    } catch (smsError) {
      smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
    }

    smsSideEffects.push(
      summarizeSmsResult('booking_confirmed', 'private_booking_confirmed', smsResult, bookingId)
    )
  }

  if (input.syncCalendar !== false && isCalendarConfigured()) {
    try {
      const eventId = await syncCalendarEvent(booking as PrivateBookingWithDetails)
      if (eventId && eventId !== booking.calendar_event_id) {
        await db
          .from('private_bookings')
          .update({ calendar_event_id: eventId })
          .eq('id', bookingId)
      }
    } catch (error) {
      logger.error('Calendar sync failed during booking confirmation:', {
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }

  return smsSideEffects
}

async function finalizeDepositPaymentWithClient(
  db: SupabaseClientLike,
  input: FinalizeDepositPaymentInput,
): Promise<FinalizeDepositPaymentResult> {
  const { bookingId, amount, method, performedByUserId, paypalCaptureId } = input

  const { data: booking, error: fetchError } = await db
    .from('private_bookings')
    .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, contact_email, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date, deposit_amount, balance_due_date, total_amount, date_tbd, internal_notes, contract_sent_at, layout, risk_status')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) throw new Error('Booking not found');

  // Fetch the customer-payable total from the view for accurate email totals
  // (gross_total is VAT-inclusive; stored prices are net)
  let calculatedTotal: number | null = null;
  const { data: viewRow } = await db
    .from('private_bookings_with_details')
    .select('calculated_total, gross_total')
    .eq('id', bookingId)
    .maybeSingle();
  if (viewRow?.gross_total != null || viewRow?.calculated_total != null) {
    calculatedTotal = toNumber(viewRow.gross_total ?? viewRow.calculated_total);
  }

  if (booking.status === 'cancelled' || booking.status === 'completed') {
    throw new Error('Cannot record a deposit on a cancelled or completed booking');
  }

  const requiredDepositAmount = toNumber(booking.deposit_amount, amount)
  if (requiredDepositAmount <= 0) {
    throw new Error('No deposit is required for this booking');
  }
  if (Math.abs(amount - requiredDepositAmount) > 0.01) {
    logger.error('Private booking deposit amount mismatch during finalization', {
      metadata: { bookingId, amount, requiredDepositAmount, method }
    })
    throw new Error(
      `Deposit amount must be exactly £${requiredDepositAmount.toFixed(2)}, received £${amount.toFixed(2)}`
    )
  }
  const recordedAmount = amount

  if (booking.deposit_paid_date) {
    return { success: true, alreadyRecorded: true }
  }

  // SOP §6/§18/§28: gate the draft→confirmed flip on space conflicts,
  // capacity and an outstanding risk review. The payment is ALWAYS recorded —
  // the money has already been taken (especially PayPal); when gated the
  // booking stays 'draft' and staff resolve then confirm via a status change.
  // Fail-open rule: if the checks themselves throw (infrastructure), log and
  // proceed as if clear — never block money flows on a broken check.
  let confirmationBlockedReasons: string[] = []
  if (booking.status === 'draft') {
    try {
      const conflicts = await getBookingConflictSummary(bookingId)
      if (conflicts.length > 0) {
        const first = conflicts[0]
        confirmationBlockedReasons.push(
          `Space conflict: ${first.space_name} is held by ${first.customer_name || 'another booking'} (${first.booking_status})`
        )
      }

      const spaceIds = await getBookingSpaceIds(bookingId)
      if (spaceIds.length > 0) {
        const { data: spaces, error: spacesError } = await db
          .from('venue_spaces')
          .select('name, capacity_seated, capacity_standing')
          .in('id', spaceIds)
        if (!spacesError) {
          const capacityResult = checkCapacity({
            spaces: spaces || [],
            guestCount: booking.guest_count,
            layout: (booking as { layout?: 'seated' | 'standing' | 'mixed' | null }).layout ?? null,
          })
          if (!capacityResult.ok) {
            confirmationBlockedReasons.push(
              capacityResult.reason || 'Guest count exceeds the capacity for the selected space'
            )
          }
        }
      }

      const riskStatus = (booking as { risk_status?: string | null }).risk_status
      if (riskStatus === 'high' || riskStatus === 'gm_approval_required') {
        confirmationBlockedReasons.push(
          riskStatus === 'high'
            ? 'Risk review outstanding: high-risk booking has not been approved (outside food, high-power equipment or other §18 trigger)'
            : 'General Manager approval required before confirmation (SOP §6.7)'
        )
      }
    } catch (gateError) {
      logger.error('Deposit confirmation gate check failed — proceeding (fail open)', {
        error: gateError instanceof Error ? gateError : new Error(String(gateError)),
        metadata: { bookingId },
      })
      confirmationBlockedReasons = []
    }
  }
  const confirmationBlocked = confirmationBlockedReasons.length > 0

  const statusUpdate: Partial<{ status: BookingStatus; cancellation_reason: null }> =
    booking.status === 'draft' && !confirmationBlocked
      ? { status: 'confirmed', cancellation_reason: null }
      : {};

  const updatePayload: Record<string, unknown> = {
    deposit_paid_date: new Date().toISOString(),
    deposit_payment_method: method,
    ...statusUpdate,
    updated_at: new Date().toISOString()
  }

  if (paypalCaptureId) {
    updatePayload.paypal_deposit_capture_id = paypalCaptureId
  }

  // SOP §11: payment of the deposit constitutes acceptance only if the
  // customer received the terms first. Stamp the acceptance when the contract
  // was sent beforehand; otherwise flag a compliance issue for review.
  const contractSentBeforePayment = Boolean((booking as { contract_sent_at?: string | null }).contract_sent_at)
  if (contractSentBeforePayment) {
    updatePayload.contract_accepted_at = new Date().toISOString()
    updatePayload.contract_acceptance_method = 'deposit_payment'
  }

  const { data: updatedBooking, error } = await db
    .from('private_bookings')
    .update(updatePayload)
    .eq('id', bookingId)
    .is('deposit_paid_date', null)
    .select()
    .maybeSingle();

  if (error) throw new Error('Failed to record deposit');
  if (!updatedBooking) return { success: true, alreadyRecorded: true }

  if (confirmationBlocked) {
    logger.warn('Private booking deposit recorded but confirmation blocked (SOP gate)', {
      metadata: { bookingId, method, reasons: confirmationBlockedReasons },
    })
    try {
      const { error: blockAuditError } = await createAdminClient().from('private_booking_audit').insert({
        booking_id: bookingId,
        action: 'confirmation_blocked',
        performed_by: performedByUserId ?? null,
        metadata: {
          reasons: confirmationBlockedReasons,
          method,
          amount: recordedAmount,
        },
      })
      if (blockAuditError) throw new Error(blockAuditError.message)
    } catch (blockAuditFailure) {
      logger.error('Failed to audit blocked confirmation (non-blocking)', {
        error: blockAuditFailure instanceof Error ? blockAuditFailure : new Error(String(blockAuditFailure)),
        metadata: { bookingId },
      })
    }
  }

  if (!contractSentBeforePayment) {
    logger.warn('Private booking deposit received before the contract was sent (SOP compliance flag)', {
      metadata: { bookingId, method },
    })
    void logAuditEvent({
      user_id: performedByUserId,
      operation_type: 'update',
      resource_type: 'private_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        action: 'compliance_flag',
        flag: 'payment_received_before_contract_sent',
        method,
      },
    }).catch(() => {})
  }

  const smsSideEffects = await sendDepositReceivedSideEffects({
    db,
    booking,
    updatedBooking,
    amount: recordedAmount,
    method,
    performedByUserId,
    calculatedTotal,
  })

  return smsSideEffects.length > 0
    ? { success: true, smsSideEffects }
    : { success: true }
}

export async function finalizeDepositPayment(
  input: FinalizeDepositPaymentInput,
  db?: SupabaseClientLike,
): Promise<FinalizeDepositPaymentResult> {
  return finalizeDepositPaymentWithClient(db ?? createAdminClient(), input)
}

// ---------------------------------------------------------------------------
// Record deposit — caller handles auth check
// ---------------------------------------------------------------------------

export async function recordDeposit(bookingId: string, amount: number, method: string, performedByUserId?: string): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
  const supabase = await createClient();
  return finalizeDepositPaymentWithClient(supabase, {
    bookingId,
    amount,
    method,
    performedByUserId,
  });
}

// ---------------------------------------------------------------------------
// Record final payment — caller handles auth check
// ---------------------------------------------------------------------------

export async function recordFinalPayment(bookingId: string, method: string, performedByUserId?: string): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
  const supabase = await createClient();

  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date, final_payment_date, date_tbd, internal_notes')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) throw new Error('Booking not found');

  // D17: Idempotency — if final payment already recorded, return success
  if (booking.final_payment_date) {
    return { success: true };
  }

  // D17: Optimistic lock — only update if final_payment_date is still null
  const { data: updatedBooking, error } = await supabase
    .from('private_bookings')
    .update({
      final_payment_date: new Date().toISOString(),
      final_payment_method: method,
      updated_at: new Date().toISOString()
    })
    .eq('id', bookingId)
    .is('final_payment_date', null)
    .select()
    .maybeSingle();

  if (error) throw new Error('Failed to record final payment');
  // D17: If no row returned, another request beat us — idempotent success
  if (!updatedBooking) return { success: true };

  const smsSideEffects: PrivateBookingSmsSideEffectSummary[] = []

  if (booking.contact_phone || booking.customer_id) {
    const eventDate = formatEventDate(booking.event_date, booking)

    const smsMessage = finalPaymentMessage({
      customerFirstName: booking.customer_first_name,
      eventDate: eventDate,
    });

     
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
    .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, contact_email, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date, deposit_amount, total_amount, date_tbd, internal_notes')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) throw new Error('Booking not found');

  // Fetch the customer-payable (VAT-inclusive) total from the view for
  // accurate email totals — stored prices are net
  let balanceCalculatedTotal: number | null = null;
  const { data: balanceViewRow } = await supabase
    .from('private_bookings_with_details')
    .select('calculated_total, gross_total')
    .eq('id', bookingId)
    .maybeSingle();
  if (balanceViewRow?.gross_total != null || balanceViewRow?.calculated_total != null) {
    balanceCalculatedTotal = toNumber(balanceViewRow.gross_total ?? balanceViewRow.calculated_total);
  }

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
    const eventDate = formatEventDate(booking.event_date, booking)

    const smsMessage = finalPaymentMessage({
      customerFirstName: booking.customer_first_name,
      eventDate: eventDate,
    });


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
    const balanceEmailDate = isBookingDateTbd(booking) ? 'Date to be confirmed' : booking.event_date;
    sendBalancePaidEmail({
      id: booking.id,
      customer_id: booking.customer_id,
      contact_email: booking.contact_email,
      customer_first_name: booking.customer_first_name,
      customer_name: booking.customer_name,
      event_date: balanceEmailDate,
      event_type: booking.event_type,
      total_amount: balanceCalculatedTotal ?? booking.total_amount,
      deposit_amount: booking.deposit_amount,
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

/**
 * Update only the deposit amount for an unpaid deposit.
 * Unlike updateDeposit, this does NOT write deposit_payment_method (avoids method pollution).
 * Also clears paypal_deposit_order_id to invalidate any in-flight PayPal order (CR-1).
 *
 * SOP §12: reducing the £250 default requires a recorded reason (General
 * Manager discretion); setting £0 requires an explicit waiver — a £0 deposit
 * no longer confirms a booking silently.
 */
export async function updateDepositAmount(
  bookingId: string,
  amount: number,
  performedByUserId?: string,
  options?: { reductionReason?: string; waived?: boolean; waivedReason?: string }
): Promise<void> {
  const db = createAdminClient()

  if (amount <= 0) {
    if (!options?.waived || !(options.waivedReason || '').trim()) {
      throw new Error('A £0 deposit requires a General Manager waiver with a reason')
    }

    const { data: booking, error: fetchError } = await db
      .from('private_bookings')
      .select('id, status, customer_first_name, customer_last_name, customer_name, contact_phone, contact_email, customer_id, event_date, event_type, calendar_event_id')
      .eq('id', bookingId)
      .single()

    if (fetchError || !booking) throw new Error('Booking not found')

    const shouldConfirm = booking.status === 'draft'
    const { error } = await db
      .from('private_bookings')
      .update({
        deposit_amount: 0,
        deposit_payment_method: null,
        paypal_deposit_order_id: null,
        hold_expiry: null,
        deposit_waived: true,
        deposit_waived_reason: options.waivedReason,
        ...(shouldConfirm ? { status: 'confirmed', cancellation_reason: null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)

    if (error) throw new Error(`Failed to update deposit amount: ${error.message}`)

    if (shouldConfirm) {
      await sendBookingConfirmedSideEffects({
        db,
        booking: {
          ...booking,
          status: 'confirmed',
          deposit_amount: 0,
          hold_expiry: null,
        },
        performedByUserId,
        analyticsVia: 'private_booking_no_deposit',
      })
    }

    return
  }

  if (amount < 250 && !(options?.reductionReason || '').trim()) {
    throw new Error('Reducing the deposit below £250 requires a reason (General Manager discretion)')
  }

  const { error } = await db
    .from('private_bookings')
    .update({
      deposit_amount: amount,
      paypal_deposit_order_id: null,
      deposit_waived: false,
      deposit_waived_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
  if (error) throw new Error(`Failed to update deposit amount: ${error.message}`)
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
