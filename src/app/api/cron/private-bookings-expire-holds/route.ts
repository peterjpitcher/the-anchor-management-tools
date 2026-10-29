import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { logAuditEvent } from '@/app/actions/audit';
import { cancelPendingQueuedSms, expireStaleQueuedPrivateBookingTexts } from '@/lib/private-bookings/queue-cleanup';
import { settleWrite } from '@/lib/supabase/settle-write';
import { getPayPalOrder, isPayPalOrderNotFoundError } from '@/lib/paypal';
import { payPalCaptureOutcome } from '@/lib/paypal-capture-outcome';
import { finalizeDepositPayment } from '@/services/private-bookings';
import { alertMoneyNeedsAPerson, formatPounds } from '@/lib/money-alerts';
import { formatDateInLondon, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils';
import { withCronRun } from '@/lib/cron/run-recorder';
import { reportCronFailure } from '@/lib/cron/alerting';

// The 15-second project default is too tight for a run that tidies each lapsed hold (BK-212).
export const maxDuration = 60;

// Vercel Cron: runs at 06:00 UTC daily (cron: "0 6 * * *")
// Cancels draft private bookings whose hold_expiry has passed.
// TBD bookings (date_tbd = true, null hold_expiry) are excluded.
// It also cancels queued texts whose date has passed (BK-064), so none can be approved late.

/** A hire booked less than this many days before its event is never cancelled by this job (D26). */
const SHORT_NOTICE_DAYS = 14;

type ExpiredHold = {
  id: string;
  paypal_deposit_order_id: string | null;
  event_date: string | null;
  created_at: string | null;
  hold_expiry: string | null;
  deposit_amount: number | string | null;
};

async function expirePrivateBookingHolds(request: NextRequest): Promise<NextResponse> {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const nowDate = new Date();
  const now = nowDate.toISOString();

  // The holds that have run out. hold_expiry IS NOT NULL leaves out TBD bookings (which have no
  // hold). A hold whose deposit is still to be confirmed (owner decision, 11 September 2026) never
  // expires by itself, and so never gets the hold-lapsed message: the guest has not been told a
  // deposit or a deadline. A paid deposit never lapses (BK-068). Each one is then checked and
  // cancelled on its own, below, so a deposit PayPal took just before the deadline is recorded
  // instead of the booking being cancelled under it (BK-063).
  const { data: candidates, error: candidatesError } = await supabase
    .from('private_bookings')
    .select('id, paypal_deposit_order_id, event_date, created_at, hold_expiry, deposit_amount')
    .eq('status', 'draft')
    .not('hold_expiry', 'is', null)
    .lt('hold_expiry', now)
    .not('deposit_confirmed_at', 'is', null)
    .is('deposit_paid_date', null);

  if (candidatesError) {
    logger.error('private-bookings-expire-holds: reading expired holds failed', {
      error: new Error(candidatesError.message),
      metadata: { message: candidatesError.message },
    });
    return NextResponse.json({ error: candidatesError.message }, { status: 500 });
  }

  const ids: string[] = [];
  const kept: Array<{ id: string; reason: string }> = [];
  // Per-row side effects: cancel pending SMS, clean up calendar, send expiry notification.
  const results: HoldExpiryResult[] = [];
  for (const candidate of (candidates ?? []) as ExpiredHold[]) {
    if (candidate.paypal_deposit_order_id) {
      const payment = await checkPayPalDepositBeforeExpiry(candidate.id, candidate.paypal_deposit_order_id);
      if (payment !== 'not_paid') {
        kept.push({ id: candidate.id, reason: payment });
        continue;
      }
    }

    // Owner decision D26 (26 October 2026), BK-110: a hire booked less than 14 days ahead, or one
    // whose event is today or tomorrow, is never cancelled by this job. A guest who planned to pay
    // on the day lost the room on the morning of their party. A manager is told instead.
    const handover = holdNeedsAPerson(candidate, nowDate);
    if (handover) {
      await alertManagerToUnpaidHold(supabase, candidate, handover);
      kept.push({ id: candidate.id, reason: handover });
      continue;
    }

    // Status-guarded, so a booking confirmed or paid since it was read is left alone.
    const { data: expiredRow, error: updateError } = await supabase
      .from('private_bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: 'Deposit hold expired',
        cancelled_at: now,
        updated_at: now,
      })
      .eq('id', candidate.id)
      .eq('status', 'draft')
      .not('hold_expiry', 'is', null)
      .lt('hold_expiry', now)
      .not('deposit_confirmed_at', 'is', null)
      .is('deposit_paid_date', null)
      .select('id')
      .maybeSingle();
    if (updateError) {
      logger.error('private-bookings-expire-holds: cancelling an expired hold failed', {
        error: new Error(updateError.message),
        metadata: { bookingId: candidate.id, message: updateError.message },
      });
      results.push({ id: candidate.id, smsSent: false, error: `cancel failed: ${updateError.message}`, problems: [] });
      continue;
    }
    if (!expiredRow) continue;
    ids.push(candidate.id);

    // BK-155: each booking is cancelled and its guest told together, one booking at a time, so a
    // run that stops part-way leaves at most one guest cancelled without being told, and that one
    // is reported below. The bulk cancel that used to come first could leave every guest untold.
    results.push(await tidyCancelledHold(supabase, candidate.id, now));
  }

  if (ids.length === 0 && results.length === 0) {
    // Last, after any cancellation has cleared its own queue.
    const staleTexts = await expireStaleQueuedPrivateBookingTexts(supabase, toLocalIsoDate(nowDate));
    logger.info('private-bookings-expire-holds: no expired holds cancelled', { metadata: { kept, staleTexts } });
    return NextResponse.json({ ok: true, cancelled: 0, kept, staleTextsExpired: staleTexts.expired });
  }

  // Last, after each cancellation above has cleared its own queue.
  const staleTexts = await expireStaleQueuedPrivateBookingTexts(supabase, toLocalIsoDate(nowDate));

  // A guest cancelled without being told, or a calendar entry left behind, needs a person. The
  // run summary goes to the logs at warn, which production keeps, and the faults by email to
  // CRON_ALERT_EMAIL (BK-155). Booking ids only: no guest details leave the app.
  const faults = results.filter((result) => result.error || result.problems.length > 0);
  if (faults.length > 0) {
    logger.warn('private-bookings-expire-holds: cancelled expired holds, some need a person', {
      metadata: { count: ids.length, ids, results, kept, staleTexts },
    });
    await reportCronFailure(
      'private-bookings-expire-holds',
      new Error(
        `${faults.length} lapsed private hire hold${faults.length === 1 ? '' : 's'} could not be fully tidied. ` +
          'Check each booking: the guest may not have been told, or a calendar entry or queued text may be left behind.',
      ),
      {
        bookings: faults.map((fault) => ({
          bookingId: fault.id,
          guestTold: fault.smsSent,
          problems: fault.error ? [fault.error, ...fault.problems] : fault.problems,
        })),
      },
    ).catch((alertError: unknown) => {
      logger.error('private-bookings-expire-holds: the failure alert could not be sent', {
        error: alertError instanceof Error ? alertError : new Error(String(alertError)),
      });
    });
  } else {
    logger.warn('private-bookings-expire-holds: cancelled expired holds', {
      metadata: { count: ids.length, ids, results, kept, staleTexts },
    });
  }

  return NextResponse.json({ ok: true, cancelled: ids.length, results, kept, staleTextsExpired: staleTexts.expired });
}

type HoldExpiryResult = {
  id: string;
  /** True when the guest was told, by email or text. */
  smsSent: boolean;
  /** Set when the booking could not be cancelled or the tidy-up stopped part-way. */
  error?: string;
  /** Each tidy-up step that failed: the queued texts, the calendar entry or the guest's message. */
  problems: string[];
};

/**
 * Everything that follows cancelling one lapsed hold: the audit row, the queued texts, the Pub Ops
 * calendar entry and the guest's message. Each step is tried even when an earlier one failed, and
 * each failure is named in the result for the alert.
 */
async function tidyCancelledHold(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  now: string,
): Promise<HoldExpiryResult> {
  const problems: string[] = [];
  try {
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'private_booking',
      resource_id: id,
      operation_status: 'success',
      new_values: {
        status: 'cancelled',
        cancellation_reason: 'Deposit hold expired',
        cancelled_at: now,
      },
      additional_info: {
        action: 'expire_booking_hold',
        actor: 'system_cron',
        route: '/api/cron/private-bookings-expire-holds',
      },
    });

    // 1. Cancel pending SMS for this booking. The helper reads the returned error; the old
    // inline update wrote a column the queue table does not have and nothing noticed.
    try {
      await cancelPendingQueuedSms(supabase, id, 'hold_expired_cron');
    } catch (smsCleanupError) {
      problems.push('queued texts not cancelled');
      logger.error('private-bookings-expire-holds: SMS cleanup failed', {
        error: smsCleanupError instanceof Error ? smsCleanupError : new Error(String(smsCleanupError)),
        metadata: { bookingId: id },
      });
    }

    // 2. Calendar cleanup: fetch calendar_event_id and delete if present.
    try {
      const { data: bookingRow, error: calendarReadError } = await supabase
        .from('private_bookings')
        .select('calendar_event_id')
        .eq('id', id)
        .maybeSingle();
      if (calendarReadError) throw new Error(calendarReadError.message);

      if (bookingRow?.calendar_event_id) {
        const { isCalendarConfigured, deleteCalendarEvent } = await import('@/lib/google-calendar');
        if (isCalendarConfigured()) {
          const deleted = await deleteCalendarEvent(bookingRow.calendar_event_id);
          if (deleted) {
            await settleWrite(
              supabase
                .from('private_bookings')
                .update({ calendar_event_id: null })
                .eq('id', id),
              {
                table: 'private_bookings',
                what: 'Clearing the deleted calendar event id',
                ids: { bookingId: id },
                note: 'the calendar event itself was deleted',
              },
            );
          } else {
            problems.push('calendar entry not deleted');
          }
        }
      }
    } catch (calendarError) {
      problems.push('calendar entry not deleted');
      logger.error('private-bookings-expire-holds: calendar cleanup failed', {
        error: calendarError instanceof Error ? calendarError : new Error(String(calendarError)),
        metadata: { bookingId: id },
      });
    }

    // 3. Tell the guest.
    let smsSent = false;
    try {
      const { data: booking, error: bookingReadError } = await supabase
        .from('private_bookings')
        .select('customer_first_name, customer_name, contact_phone, contact_email, customer_id, event_date, date_tbd, internal_notes, event_type, start_time, end_time, end_time_next_day, guest_count')
        .eq('id', id)
        .maybeSingle();
      if (bookingReadError) throw new Error(bookingReadError.message);
      if (!booking) throw new Error('the booking could not be read back');

      // Email first (P6): a booking with only an email address hears about the lapse too.
      const { isBookingDateTbd } = await import('@/lib/private-bookings/tbd-detection');
      const { bookingExpiredMessage } = await import('@/lib/private-bookings/messages');
      const { sendPrivateBookingMessage } = await import('@/lib/private-bookings/messenger');
      const { buildHoldLapsedEmail } = await import('@/lib/email/private-booking-emails');
      const { buildPrivateBookingMessageFacts } = await import('@/lib/private-bookings/message-catalogue');

      const isTbd = isBookingDateTbd(booking);
      // The London calendar date, whatever the server's zone.
      const eventDate = isTbd
        ? 'Date to be confirmed'
        : formatDateInLondon(booking.event_date, { day: 'numeric', month: 'long', year: 'numeric' });

      const smsMessage = bookingExpiredMessage({
        customerFirstName: booking.customer_first_name,
        eventDate: eventDate,
      });

      const bookingForMessage = { ...booking, id };
      const smsResult = await sendPrivateBookingMessage({
        sms: {
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
            event_date: eventDate,
          },
        },
        booking: bookingForMessage,
        email: () => buildHoldLapsedEmail({ booking: bookingForMessage, firstName: booking.customer_first_name }),
        windowKey: 'expired',
        facts: buildPrivateBookingMessageFacts('booking_expired', bookingForMessage),
      });

      smsSent = Boolean(smsResult?.sent);
      const sendError = (smsResult as { error?: unknown } | null | undefined)?.error;
      if (!smsSent && sendError) {
        problems.push(`guest not told: ${typeof sendError === 'string' ? sendError : 'the message failed'}`);
      }
    } catch (smsError) {
      problems.push('guest not told: the message could not be sent');
      logger.error('private-bookings-expire-holds: expiry SMS failed', {
        error: smsError instanceof Error ? smsError : new Error(String(smsError)),
        metadata: { bookingId: id },
      });
    }

    return { id, smsSent, problems };
  } catch (error) {
    logger.error('private-bookings-expire-holds: per-row processing failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: id },
    });
    return { id, smsSent: false, error: error instanceof Error ? error.message : String(error), problems };
  }
}

/** Whole days from one London date to another. */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/**
 * Why a lapsed hold goes to a manager instead of being cancelled (D26, BK-110), or null to cancel
 * it. Dates are London calendar dates.
 */
function holdNeedsAPerson(hold: ExpiredHold, now: Date): 'event_within_a_day' | 'booked_short_notice' | null {
  const eventIso = hold.event_date ? hold.event_date.slice(0, 10) : null;
  if (!eventIso) return null;
  const todayIso = toLocalIsoDate(now);
  const tomorrowIso = shiftIsoDate(todayIso, 1) ?? todayIso;
  if (eventIso <= tomorrowIso) return 'event_within_a_day';
  const createdMs = hold.created_at ? Date.parse(hold.created_at) : Number.NaN;
  if (!Number.isFinite(createdMs)) return null;
  return daysBetween(toLocalIsoDate(new Date(createdMs)), eventIso) < SHORT_NOTICE_DAYS ? 'booked_short_notice' : null;
}

/** Once per booking (alertMoneyNeedsAPerson keeps the claim for 30 days). Staff only. */
async function alertManagerToUnpaidHold(
  supabase: ReturnType<typeof createAdminClient>,
  hold: ExpiredHold,
  why: 'event_within_a_day' | 'booked_short_notice',
): Promise<void> {
  const eventIso = hold.event_date ? hold.event_date.slice(0, 10) : null;
  const eventText = eventIso ? formatDateInLondon(eventIso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'an unknown date';
  const reason = why === 'event_within_a_day'
    ? 'the event is today or tomorrow'
    : 'it was booked less than 14 days before the event';
  await alertMoneyNeedsAPerson(supabase, {
    domain: 'private_bookings',
    bookingId: hold.id,
    kind: 'unpaid_hold_not_cancelled',
    title: `A private hire on ${eventText} has not paid its deposit`,
    summary: `The deposit hold on this private hire has run out without a payment. It has not been cancelled automatically, because ${reason}. Speak to the guest, then record the deposit, extend the hold or cancel the booking. No message has been sent to the customer.`,
    context: {
      'Event date': eventIso,
      'Hold ended': hold.hold_expiry ? formatDateInLondon(hold.hold_expiry, { day: 'numeric', month: 'long', year: 'numeric' }) : null,
      Deposit: formatPounds(Number(hold.deposit_amount ?? 0)),
      'Booked on': hold.created_at ? toLocalIsoDate(new Date(hold.created_at)) : null,
    },
  });
}

/**
 * Whether the guest has paid, or is paying, a deposit through the PayPal order on the booking
 * (BK-063). A completed capture is recorded now, as the reconciliation sweep would record it, and
 * the booking is not cancelled. An approved order is left to that sweep, which takes it within 15
 * minutes. If PayPal cannot be asked, the booking waits for tomorrow's run rather than being
 * cancelled while its payment is unknown.
 */
async function checkPayPalDepositBeforeExpiry(
  bookingId: string,
  orderId: string,
): Promise<'not_paid' | 'deposit_recorded' | 'payment_in_progress' | 'payment_unknown'> {
  let order: Awaited<ReturnType<typeof getPayPalOrder>>;
  try {
    order = await getPayPalOrder(orderId);
  } catch (error) {
    if (isPayPalOrderNotFoundError(error)) return 'not_paid';
    logger.error('private-bookings-expire-holds: PayPal order could not be checked; hold kept until the next run', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, orderId },
    });
    return 'payment_unknown';
  }

  if (order?.status === 'APPROVED') return 'payment_in_progress';
  if (order?.status !== 'COMPLETED') return 'not_paid';

  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
  if (payPalCaptureOutcome(capture?.status ?? null) !== 'completed') return 'payment_in_progress';

  try {
    await finalizeDepositPayment({
      bookingId,
      amount: Number(capture?.amount?.value ?? 0),
      method: 'paypal',
      paypalCaptureId: capture?.id ?? null,
    });
    return 'deposit_recorded';
  } catch (error) {
    // An amount that does not match, for example. The reconciliation sweep alerts a manager.
    logger.error('private-bookings-expire-holds: a captured deposit could not be recorded; hold kept', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, orderId, captureId: capture?.id ?? null },
    });
    return 'payment_unknown';
  }
}

// A run record per run, a failure email when the run fails, and the bookings whose clean-up
// failed counted on the record for the daily check (BK-116).
export const GET = withCronRun('private-bookings-expire-holds', expirePrivateBookingHolds, {
  recording: 'every_run',
  itemFailures: (body) =>
    Array.isArray(body.results)
      ? body.results.filter((entry) => {
          const result = entry as { error?: unknown; problems?: unknown[] } | null;
          return Boolean(result?.error) || (Array.isArray(result?.problems) && result.problems.length > 0);
        }).length
      : 0,
});
