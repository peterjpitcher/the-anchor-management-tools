import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { authorizeCronRequest } from '@/lib/cron-auth';
import { logAuditEvent } from '@/app/actions/audit';
import { cancelPendingQueuedSms } from '@/lib/private-bookings/queue-cleanup';
import { isMessagingFlagOn } from '@/lib/messaging/flags';
import { settleWrite } from '@/lib/supabase/settle-write';
import { getPayPalOrder, isPayPalOrderNotFoundError } from '@/lib/paypal';
import { payPalCaptureOutcome } from '@/lib/paypal-capture-outcome';
import { finalizeDepositPayment } from '@/services/private-bookings';

// Vercel Cron: runs at 06:00 UTC daily (cron: "0 6 * * *")
// Cancels draft private bookings whose hold_expiry has passed.
// TBD bookings (date_tbd = true, null hold_expiry) are excluded.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = authorizeCronRequest(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Deposit confirmation (flag private_booking_deposit_confirmation): while it is on, a hold whose
  // deposit is still to be confirmed never expires by itself, and so never gets the hold-lapsed
  // message. The guest has not been told a deposit or a deadline. With the flag off the update
  // below is exactly as it was.
  const depositConfirmation = await isMessagingFlagOn('private_booking_deposit_confirmation');

  // The holds that have run out. hold_expiry IS NOT NULL leaves out TBD bookings (which have no
  // hold). Each one is then checked and cancelled on its own, below, so a deposit PayPal took
  // just before the deadline is recorded instead of the booking being cancelled under it (BK-063).
  let candidatesQuery = supabase
    .from('private_bookings')
    .select('id, paypal_deposit_order_id')
    .eq('status', 'draft')
    .not('hold_expiry', 'is', null)
    .lt('hold_expiry', now);
  if (depositConfirmation) {
    candidatesQuery = candidatesQuery.not('deposit_confirmed_at', 'is', null);
  }
  const { data: candidates, error: candidatesError } = await candidatesQuery;

  if (candidatesError) {
    logger.error('private-bookings-expire-holds: reading expired holds failed', {
      error: new Error(candidatesError.message),
      metadata: { message: candidatesError.message },
    });
    return NextResponse.json({ error: candidatesError.message }, { status: 500 });
  }

  const ids: string[] = [];
  const kept: Array<{ id: string; reason: string }> = [];
  for (const candidate of (candidates ?? []) as Array<{ id: string; paypal_deposit_order_id: string | null }>) {
    if (candidate.paypal_deposit_order_id) {
      const payment = await checkPayPalDepositBeforeExpiry(candidate.id, candidate.paypal_deposit_order_id);
      if (payment !== 'not_paid') {
        kept.push({ id: candidate.id, reason: payment });
        continue;
      }
    }

    // Status-guarded, so a booking confirmed or paid since it was read is left alone.
    let expireQuery = supabase
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
      .lt('hold_expiry', now);
    if (depositConfirmation) {
      expireQuery = expireQuery.not('deposit_confirmed_at', 'is', null);
    }
    const { data: expiredRow, error: updateError } = await expireQuery.select('id').maybeSingle();
    if (updateError) {
      logger.error('private-bookings-expire-holds: cancelling an expired hold failed', {
        error: new Error(updateError.message),
        metadata: { bookingId: candidate.id, message: updateError.message },
      });
      continue;
    }
    if (expiredRow) ids.push(candidate.id);
  }

  if (ids.length === 0) {
    logger.info('private-bookings-expire-holds: no expired holds cancelled', { metadata: { kept } });
    return NextResponse.json({ ok: true, cancelled: 0, kept });
  }

  // Per-row side effects: cancel pending SMS, clean up calendar, send expiry notification.
  const results: Array<{ id: string; smsSent: boolean; error?: string }> = [];

  for (const id of ids) {
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

      // expireBooking expects draft status — but we already set cancelled above.
      // Instead, perform per-row cleanup inline: cancel pending SMS, calendar, notification.

      // 1. Cancel pending SMS for this booking. The helper reads the returned error; the old
      // inline update wrote a column the queue table does not have and nothing noticed.
      try {
        await cancelPendingQueuedSms(supabase, id, 'hold_expired_cron');
      } catch (smsCleanupError) {
        logger.error('private-bookings-expire-holds: SMS cleanup failed', {
          error: smsCleanupError instanceof Error ? smsCleanupError : new Error(String(smsCleanupError)),
          metadata: { bookingId: id },
        });
      }

      // 2. Calendar cleanup — fetch calendar_event_id and delete if present
      try {
        const { data: bookingRow } = await supabase
          .from('private_bookings')
          .select('calendar_event_id')
          .eq('id', id)
          .maybeSingle();

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
            }
          }
        }
      } catch (calendarError) {
        logger.error('private-bookings-expire-holds: calendar cleanup failed', {
          error: calendarError instanceof Error ? calendarError : new Error(String(calendarError)),
          metadata: { bookingId: id },
        });
      }

      // 3. Send expiry SMS notification
      let smsSent = false;
      try {
        const { data: booking } = await supabase
          .from('private_bookings')
          .select('customer_first_name, customer_name, contact_phone, contact_email, customer_id, event_date, date_tbd, internal_notes, event_type, start_time, end_time, end_time_next_day, guest_count')
          .eq('id', id)
          .maybeSingle();

        // Email first (P6): a booking with only an email address hears about the lapse too.
        const { isPrivateBookingEmailFirstOn } = await import('@/lib/private-bookings/email-first');
        const emailFirst = await isPrivateBookingEmailFirstOn();

        if (booking && (emailFirst || booking.contact_phone || booking.customer_id)) {
          const { isBookingDateTbd } = await import('@/lib/private-bookings/tbd-detection');
          const { bookingExpiredMessage } = await import('@/lib/private-bookings/messages');
          const { sendPrivateBookingMessage } = await import('@/lib/private-bookings/messenger');
          const { buildHoldLapsedEmail } = await import('@/lib/email/private-booking-emails');
          const { buildPrivateBookingMessageFacts } = await import('@/lib/private-bookings/message-catalogue');

          const isTbd = isBookingDateTbd(booking);
          const eventDate = isTbd
            ? 'Date to be confirmed'
            : new Date(booking.event_date).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric'
              });

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
            // The same read that let an email-only booking through above.
            emailFirst,
          });

          smsSent = Boolean(smsResult?.sent);
        }
      } catch (smsError) {
        logger.error('private-bookings-expire-holds: expiry SMS failed', {
          error: smsError instanceof Error ? smsError : new Error(String(smsError)),
          metadata: { bookingId: id },
        });
      }

      results.push({ id, smsSent });
    } catch (error) {
      logger.error('private-bookings-expire-holds: per-row processing failed', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId: id },
      });
      results.push({ id, smsSent: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  logger.info('private-bookings-expire-holds: cancelled expired holds', {
    metadata: { count: ids.length, ids, results, kept },
  });

  return NextResponse.json({ ok: true, cancelled: ids.length, results, kept });
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
