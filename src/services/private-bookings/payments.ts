import { readBookingPaymentLedger } from '@/lib/private-bookings/payment-ledger';
import { buildDepositRefundEntries, buildPaymentHistoryEntries } from '@/lib/private-bookings/payment-statement';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDateInLondon } from '@/lib/dateUtils';
import { syncCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';
import {
  sendBookingCalendarInvite,
  buildBalancePaidMessageEmail,
  buildBookingConfirmedMessageEmail,
  buildDepositReceivedMessageEmail,
  resolveConfirmationDepositState,
} from '@/lib/email/private-booking-emails';
import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger';
import { buildPrivateBookingMessageFacts } from '@/lib/private-bookings/message-catalogue';
import type {
  BookingStatus,
  PrivateBookingWithDetails,
  PaymentHistoryEntry,
  DepositRefundEntry,
} from '@/types/private-bookings';
import {
  type PrivateBookingSmsSideEffectSummary,
  normalizeSmsSafetyMeta,
  toNumber,
} from './types';
import { getBookingConflictSummary } from './conflicts'
import {
  hireConfirmationProblems,
  loadOneHireReadiness,
  type HireProblem,
} from './readiness';
import {
  bookingConfirmedMessage,
  depositReceivedMessage,
  finalPaymentMessage,
} from '@/lib/private-bookings/messages';
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection';
import { settleWrite } from '@/lib/supabase/settle-write';
import { alertMoneyNeedsAPerson, formatPounds } from '@/lib/money-alerts';

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
  /**
   * True when the deposit was recorded but the booking stayed a draft. The staff member who
   * recorded it, and a guest paying online, are told so rather than "confirmed" (review BK-005).
   */
  confirmationBlocked?: boolean
  /** Why it stayed a draft, in words staff can act on. */
  confirmationBlockedReasons?: string[]
  /**
   * True when PayPal took the deposit after the booking was cancelled or completed (BK-063). The
   * money is recorded on the booking so it can be refunded, a manager is told, and the guest is
   * sent nothing: the booking stays as it was.
   */
  paidAfterClose?: boolean
}

/** Why a paid deposit left the booking a draft, when the confirmation checks themselves failed. */
export const GATE_CHECK_FAILED_REASON =
  'The checks before confirming could not run, so the booking was left as a draft. Check its rooms, guest count and contract, then confirm it by hand.'

/** A room problem as the reason a paid deposit did not confirm the booking. */
function depositGateReason(problem: HireProblem): string {
  if (problem.code === 'no_room') return 'No room booked. Add the room the party will use, then confirm the booking.'
  if (problem.code === 'no_guest_count') return 'No guest count set. Add the number of guests, then confirm the booking.'
  if (problem.code === 'contract_not_sent') {
    return 'Contract not sent. Send the contract, or record that the customer accepted it another way, then confirm the booking.'
  }
  return problem.message
}

/** What to tell the staff member who recorded a deposit that did not confirm the booking. */
export function describeBlockedDeposit(reasons: string[]): string {
  const sentences = reasons.map((reason) => (/[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`))
  return `The deposit is recorded, but the booking is still a draft. ${sentences.join(' ')}`
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

/**
 * A total worth showing, or null.
 *
 * Deposits are often taken to hold a date before anything is priced, and the emails printed the
 * unpriced booking as "Total event cost £0.00, Event balance due £0.00" (review PB-7).
 */
function positiveTotal(value: unknown): number | null {
  const amount = toNumber(value)
  return amount > 0 ? amount : null
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
  /**
   * True when the SOP gate held the booking back: the deposit is recorded but the booking stays a
   * draft (space conflict, capacity, outstanding risk review or GM approval). The guest still gets
   * a receipt, but neither the email nor the text may say the booking is confirmed (review PB-2).
   */
  confirmationBlocked?: boolean
}): Promise<PrivateBookingSmsSideEffectSummary[]> {
  const { db, booking, updatedBooking, amount, method, performedByUserId, calculatedTotal } = input
  const bookingConfirmed = input.confirmationBlocked !== true
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

  // Email first (P6): the "Booking Confirmed" email has always gone alongside this text. One email
  // carries both, and the text goes only if that email does not.
  const eventDate = formatEventDate(booking.event_date, booking)
  const smsMessage = depositReceivedMessage({
    customerFirstName: booking.customer_first_name,
    eventDate,
    bookingConfirmed,
  });

  let smsResult: any
  try {
    smsResult = await sendPrivateBookingMessage({
      sms: {
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
      },
      booking,
      email: () => buildDepositReceivedMessageEmail({
        booking,
        firstName: booking.customer_first_name,
        depositAmount: amount,
        totalAmount: positiveTotal(calculatedTotal ?? booking.total_amount),
        balanceDueDate: booking.balance_due_date ?? null,
        bookingConfirmed,
      }),
      windowKey: 'deposit',
      // From the row as the payment left it: `booking` was read before the deposit was recorded.
      facts: buildPrivateBookingMessageFacts('deposit_received', { ...booking, ...(updatedBooking ?? {}) }),
    });
  } catch (smsError) {
    smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
  }

  smsSideEffects.push(
    summarizeSmsResult('deposit_received', 'private_booking_deposit_received', smsResult, bookingId)
  )

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

  // Email first (P6): one corrected confirmation email replaces both the old confirmation email
  // (which called a waived-deposit booking a "Provisional Booking Hold") and the text. The
  // calendar invite still goes as before.

  const resolveGrossTotal = async (): Promise<number | null> => {
    // Stored prices are net; the confirmation email must show the VAT-inclusive gross
    // total (view-only column). Pass null when there is no positive total so the
    // "Total event cost" row is omitted rather than shown as £0.00.
    try {
      const { data: viewRow } = await db
        .from('private_bookings_with_details')
        .select('gross_total, calculated_total')
        .eq('id', bookingId)
        .maybeSingle()
      const g = toNumber(viewRow?.gross_total ?? viewRow?.calculated_total)
      return g > 0 ? g : null
    } catch (grossError) {
      logger.error('Failed to resolve gross total for confirmation email', { error: grossError instanceof Error ? grossError : new Error(String(grossError)) })
      return null
    }
  }

  if (booking.contact_email) {
    sendBookingCalendarInvite(booking).catch(e =>
      logger.error('Failed to send calendar invite', { error: e instanceof Error ? e : new Error(String(e)) })
    )
  }

  const messageBody = bookingConfirmedMessage({
    customerFirstName: firstName,
    eventDate,
  })
  const confirmationGrossTotal = await resolveGrossTotal()

  let smsResult: any
  try {
    smsResult = await sendPrivateBookingMessage({
      sms: {
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
      },
      booking,
      email: () => buildBookingConfirmedMessageEmail({
        booking,
        firstName,
        depositState: resolveConfirmationDepositState(booking),
        depositAmount: toNumber(booking.deposit_amount),
        holdExpiry: booking.hold_expiry ?? null,
        totalAmount: confirmationGrossTotal,
      }),
      windowKey: `confirmed-${String(booking.event_date ?? 'tbd').slice(0, 10)}`,
      facts: buildPrivateBookingMessageFacts('booking_confirmed', booking),
    })
  } catch (smsError) {
    smsResult = { error: smsError instanceof Error ? smsError.message : String(smsError) }
  }

  smsSideEffects.push(
    summarizeSmsResult('booking_confirmed', 'private_booking_confirmed', smsResult, bookingId)
  )

  if (input.syncCalendar !== false && isCalendarConfigured()) {
    try {
      const eventId = await syncCalendarEvent(booking as PrivateBookingWithDetails)
      if (eventId && eventId !== booking.calendar_event_id) {
        await settleWrite(
          db
            .from('private_bookings')
            .update({ calendar_event_id: eventId })
            .eq('id', bookingId),
          {
            table: 'private_bookings',
            what: 'Saving the synced calendar event id',
            ids: { bookingId, calendarEventId: eventId },
            note: 'the calendar event itself was synced'
          }
        )
      }
    } catch (error) {
      logger.error('Calendar sync failed during booking confirmation:', {
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }

  return smsSideEffects
}

/**
 * A PayPal deposit captured for a booking already cancelled or completed (BK-063).
 *
 * The payment is written on the booking (deposit_paid_date, method and capture id) and nothing
 * else moves: the status, hold and contract stay as they are and the guest is sent nothing. Once
 * the capture is on the booking, the page's Process Refund can return it. A manager is emailed
 * once per capture. A second capture on a booking that already holds a different deposit is not
 * written over it: the manager is told about that one too, and it is refunded in PayPal.
 */
async function recordDepositPaidAfterClose(
  db: SupabaseClientLike,
  booking: {
    id: string
    status: string
    deposit_paid_date?: string | null
    paypal_deposit_capture_id?: string | null
  },
  payment: { amount: number; paypalCaptureId: string },
): Promise<FinalizeDepositPaymentResult> {
  const bookingId = booking.id
  const capture = payment.paypalCaptureId
  const admin = createAdminClient()

  if (booking.deposit_paid_date && booking.paypal_deposit_capture_id === capture) {
    return { success: true, alreadyRecorded: true, paidAfterClose: true }
  }

  let recorded = false
  if (!booking.deposit_paid_date) {
    const nowIso = new Date().toISOString()
    const { data: updated, error } = await db
      .from('private_bookings')
      .update({
        deposit_paid_date: nowIso,
        deposit_payment_method: 'paypal',
        paypal_deposit_capture_id: capture,
        updated_at: nowIso,
      })
      .eq('id', bookingId)
      .is('deposit_paid_date', null)
      .select('id')
      .maybeSingle()
    if (error) {
      // The alert below still goes: the money is in PayPal whether or not it could be written here.
      logger.error('A deposit paid after the booking closed could not be recorded on it', {
        error: new Error(error.message),
        metadata: { bookingId, captureId: capture, status: booking.status },
      })
    }
    recorded = Boolean(updated)
  }

  const { error: auditError } = await admin.from('private_booking_audit').insert({
    booking_id: bookingId,
    action: 'deposit_paid_after_close',
    performed_by: null,
    metadata: { capture_id: capture, amount: payment.amount, booking_status: booking.status, recorded_on_booking: recorded },
  })
  if (auditError) {
    logger.error('Failed to audit a deposit paid after the booking closed', {
      error: new Error(auditError.message),
      metadata: { bookingId, captureId: capture },
    })
  }

  const closedAs = booking.status === 'cancelled' ? 'cancelled' : 'completed'
  await alertMoneyNeedsAPerson(admin, {
    domain: 'private_bookings',
    bookingId,
    kind: 'deposit_paid_after_close',
    onceKey: `money-alert:private_bookings:deposit_paid_after_close:${capture}`,
    title: `A private hire deposit of ${formatPounds(payment.amount)} was paid after the booking was ${closedAs}`,
    summary: recorded
      ? `PayPal took ${formatPounds(payment.amount)} for this private booking after it was ${closedAs}. The payment is recorded on the booking and the booking itself has not changed. Open the booking and refund it with Process Refund, unless the guest is coming after all. No message has been sent to the customer.`
      : `PayPal took ${formatPounds(payment.amount)} for this private booking after it was ${closedAs}, but the booking already holds a deposit, so this payment is not recorded on it and may be a second payment. Refund it in PayPal using the capture below. No message has been sent to the customer.`,
    context: { Amount: formatPounds(payment.amount), 'PayPal capture': capture, 'Booking status': booking.status },
  })

  return { success: true, paidAfterClose: true, ...(recorded ? {} : { alreadyRecorded: true }) }
}

async function finalizeDepositPaymentWithClient(
  db: SupabaseClientLike,
  input: FinalizeDepositPaymentInput,
): Promise<FinalizeDepositPaymentResult> {
  const { bookingId, amount, method, performedByUserId, paypalCaptureId } = input

  const { data: booking, error: fetchError } = await db
    .from('private_bookings')
    .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, contact_email, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date, deposit_amount, balance_due_date, total_amount, date_tbd, internal_notes, contract_sent_at, contract_accepted_at, layout, risk_status, paypal_deposit_capture_id')
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
    // PayPal has already taken this money (BK-063): a capture that raced a cancellation, or one
    // the webhook or reconciliation found afterwards. Refusing it left the money in PayPal with
    // nothing on the booking, and made the webhook answer 500 so PayPal kept retrying. A deposit
    // without a capture is staff recording one by hand, which a closed booking still refuses.
    if (paypalCaptureId) {
      return recordDepositPaidAfterClose(db, booking, { amount, paypalCaptureId })
    }
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

  // SOP §6/§18/§28 and owner decisions D24 and D25: gate the draft→confirmed
  // flip on space conflicts, a room being booked, a guest count, the capacity
  // (or a manager's override), the contract having been sent or accepted
  // another way, and an outstanding risk review. The payment is ALWAYS
  // recorded, because the money has already been taken (especially PayPal);
  // when gated the booking stays 'draft', the reasons go on its audit trail,
  // the booking page and list show "Deposit paid, not confirmed" with them,
  // and staff resolve them, then confirm by a status change.
  //
  // A check that cannot run keeps the booking a draft too (review BK-005 and
  // BK-007). It used to confirm as if clear, which is how a paid hire with no
  // room confirmed itself. The money is never held up: only the status is.
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

      const { facts, rooms } = await loadOneHireReadiness(bookingId)
      for (const problem of hireConfirmationProblems(facts, rooms)) {
        confirmationBlockedReasons.push(depositGateReason(problem))
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
      logger.error('Deposit confirmation gate check failed: the booking stays a draft', {
        error: gateError instanceof Error ? gateError : new Error(String(gateError)),
        metadata: { bookingId },
      })
      confirmationBlockedReasons = [GATE_CHECK_FAILED_REASON]
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
    // The hold has been honoured, so it no longer applies. Leaving a past
    // hold_expiry on a paid booking is what let deleteDeposit hand a live
    // booking back to the expire-holds cron with a deadline already gone.
    hold_expiry: null,
    ...statusUpdate,
    updated_at: new Date().toISOString()
  }

  if (paypalCaptureId) {
    updatePayload.paypal_deposit_capture_id = paypalCaptureId
  }

  // SOP §11: payment of the deposit constitutes acceptance only if the
  // customer received the terms first. Stamp the acceptance when the contract
  // was sent beforehand; otherwise flag a compliance issue for review.
  //
  // The first acceptance stands. A contract the customer has already signed online
  // (src/lib/signing) keeps that record: until 13 October 2026 a deposit paid afterwards
  // overwrote it with 'deposit_payment' and the time of the payment.
  const contractSentBeforePayment = Boolean((booking as { contract_sent_at?: string | null }).contract_sent_at)
  const alreadyAccepted = Boolean((booking as { contract_accepted_at?: string | null }).contract_accepted_at)
  if (contractSentBeforePayment && !alreadyAccepted) {
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
    // The gate kept the booking a draft, so the receipt must not call it confirmed (review PB-2).
    confirmationBlocked,
  })

  return {
    success: true,
    ...(smsSideEffects.length > 0 ? { smsSideEffects } : {}),
    ...(confirmationBlocked ? { confirmationBlocked: true, confirmationBlockedReasons } : {}),
  }
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

export async function recordDeposit(bookingId: string, amount: number, method: string, performedByUserId?: string): Promise<FinalizeDepositPaymentResult> {
  const supabase = await createClient();
  return finalizeDepositPaymentWithClient(supabase, {
    bookingId,
    amount,
    method,
    performedByUserId,
  });
}

// ---------------------------------------------------------------------------
// There is deliberately no "record final payment" helper here.
//
// Marking a booking settled is never a direct write to final_payment_date. The
// legacy helper stamped that column from a payment method alone, so a booking
// could read "paid in full" with no money recorded against it (live example:
// a July 2025 booking that read as settled with GBP 232.98 of cash missing
// from the ledger, reconciled 2026-08-27).
//
// The column is owned by the database: record_balance_payment inserts the
// payment and stamps it, apply_balance_payment_status re-derives it whenever
// payments or items change. Settlement includes booking and linked invoice
// payments once, plus any deposit actually applied to the linked invoice.
// A separately held deposit never counts towards the event balance.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Record balance payment (partial payments) — caller handles auth check
// ---------------------------------------------------------------------------

export async function recordBalancePayment(bookingId: string, amount: number, method: string, performedByUserId?: string): Promise<{ success: true; smsSideEffects?: PrivateBookingSmsSideEffectSummary[] }> {
  const supabase = await createClient();

  // Fetch booking upfront -- needed for SMS context and calendar sync regardless of outcome.
  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    // invoice_deposit_treatment: a deposit applied to the invoice is not a refundable bond, so the
    // balance-paid email must not promise to return it (review PB-8).
    .select('id, customer_first_name, customer_last_name, customer_name, event_date, start_time, end_time, end_time_next_day, contact_phone, contact_email, customer_id, calendar_event_id, status, guest_count, event_type, deposit_paid_date, deposit_amount, total_amount, invoice_deposit_treatment, date_tbd, internal_notes')
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
  // Routed through the service role deliberately. `recordFinalPayment` checks
  // private_bookings.manage_deposits before reaching here, and that is the
  // gate. Calling as `authenticated` gained nothing (the function is SECURITY
  // DEFINER either way) and forced an EXECUTE grant that also let any signed-in
  // user POST to the RPC directly, past that check. Reads above stay on the
  // caller's client so RLS behaviour is unchanged.
  const { data: result, error: rpcError } = await createAdminClient()
    .rpc('record_balance_payment', {
      p_booking_id: bookingId,
      p_amount: amount,
      p_method: method,
      p_recorded_by: performedByUserId ?? null,
    });

  if (rpcError) {
    // The RPC raises the reason staff need to act on ("Amount (x) exceeds
    // remaining balance (y)", "Cannot record payment on a cancelled booking",
    // "Permission denied: manage_deposits required"). Swallowing it left the
    // till with a generic failure and no way to tell those cases apart.
    logger.error('Failed to record balance payment', {
      error: new Error(rpcError.message),
      metadata: { bookingId, amount, method },
    });
    throw new Error(rpcError.message || 'Failed to record payment');
  }

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

  // Email first (P6): the "Payment Complete" email has always gone alongside this text. One email
  // carries both, and the text goes only if that email does not.
  const eventDate = formatEventDate(booking.event_date, booking)

  const smsMessage = finalPaymentMessage({
    customerFirstName: booking.customer_first_name,
    eventDate: eventDate,
  });


  let smsResult: any
  try {
    smsResult = await sendPrivateBookingMessage({
      sms: {
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
      },
      booking,
      email: () => buildBalancePaidMessageEmail({
        booking,
        firstName: booking.customer_first_name,
        totalAmount: positiveTotal(balanceCalculatedTotal ?? booking.total_amount),
        depositAmount: booking.deposit_amount ?? null,
        depositPaidDate: booking.deposit_paid_date ?? null,
        invoiceDepositTreatment: (booking as { invoice_deposit_treatment?: string | null }).invoice_deposit_treatment ?? null,
      }),
      windowKey: 'final-payment',
      facts: buildPrivateBookingMessageFacts('final_payment_received', booking),
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
    .select('deposit_paid_date, deposit_amount, deposit_payment_method, invoice_id, invoice_deposit_treatment, paypal_deposit_capture_id')
    .eq('id', bookingId)
    .single()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)

  const ledger = await readBookingPaymentLedger(bookingId)

  // The same list a balance reminder email carries (payment-statement.ts).
  return buildPaymentHistoryEntries(booking, ledger)
}

/**
 * The deposit refunds the booking page lists under its payments. Throws rather than returning an
 * empty list when the read fails, so the page never shows a refunded deposit as still held.
 */
export async function getBookingDepositRefunds(bookingId: string): Promise<DepositRefundEntry[]> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('payment_refunds')
    .select('id, amount, refund_method, status, created_at, completed_at')
    .eq('source_type', 'private_booking')
    .eq('source_id', bookingId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch booking refunds: ${error.message}`)

  return buildDepositRefundEntries(data ?? [])
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

/** Why a PayPal deposit cannot be edited or deleted by hand (BK-069). */
export const PAYPAL_DEPOSIT_REFUND_ONLY =
  'This deposit was paid through PayPal, so it cannot be edited or deleted here. Use Process Refund to return it.'

async function assertDepositNotPaidThroughPayPal(
  db: ReturnType<typeof createAdminClient>,
  bookingId: string,
): Promise<void> {
  const { data, error } = await db
    .from('private_bookings')
    .select('paypal_deposit_capture_id')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(`Failed to check how the deposit was paid: ${error.message}`)
  if (data?.paypal_deposit_capture_id) throw new Error(PAYPAL_DEPOSIT_REFUND_ONLY)
}

export async function updateDeposit(
  bookingId: string,
  data: { amount: number; method: string }
): Promise<void> {
  const db = createAdminClient()
  await assertDepositNotPaidThroughPayPal(db, bookingId)
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
): Promise<{ confirmationBlockedReasons?: string[] }> {
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

    // Waiving the deposit confirms a draft only when nothing else stops it (owner decisions D24
    // and D25, reviews BK-066 and BK-006: this path confirmed a hire with no capacity check and no
    // contract). Otherwise the waiver is saved, the booking stays a draft and staff are told why.
    // A check that cannot run keeps it a draft too.
    let confirmationBlockedReasons: string[] = []
    if (booking.status === 'draft') {
      try {
        const { facts, rooms } = await loadOneHireReadiness(bookingId, db)
        confirmationBlockedReasons = hireConfirmationProblems(facts, rooms).map(depositGateReason)
      } catch (gateError) {
        logger.error('Deposit waiver confirmation check failed: the booking stays a draft', {
          error: gateError instanceof Error ? gateError : new Error(String(gateError)),
          metadata: { bookingId },
        })
        confirmationBlockedReasons = [GATE_CHECK_FAILED_REASON]
      }
    }

    const shouldConfirm = booking.status === 'draft' && confirmationBlockedReasons.length === 0
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

    return confirmationBlockedReasons.length > 0 ? { confirmationBlockedReasons } : {}
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
  return {}
}

// Returns statusReverted so the calling server action can include it in the audit log.
export async function deleteDeposit(bookingId: string): Promise<{ statusReverted: boolean }> {
  const db = createAdminClient()
  const { data: booking, error: fetchError } = await db
    .from('private_bookings')
    .select('status, deposit_paid_date, deposit_amount, deposit_payment_method, paypal_deposit_capture_id')
    .eq('id', bookingId)
    .single()
  if (fetchError || !booking) throw new Error('Booking not found')
  if (booking.paypal_deposit_capture_id) throw new Error(PAYPAL_DEPOSIT_REFUND_ONLY)

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
        // Clear the hold deadline alongside the revert. A booking dropped back
        // to draft with a hold_expiry already in the past is cancelled outright
        // by the expire-holds cron the next morning.
        .update({ status: 'draft', hold_expiry: null })
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
