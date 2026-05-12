import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { authorizeCronRequest } from '@/lib/cron-auth';

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

  // Atomically update expired draft bookings and return the affected rows.
  // hold_expiry IS NOT NULL filters out TBD bookings (which have null hold_expiry).
  // Re-checking status='draft' prevents cancelling bookings confirmed between cron runs.
  const { data: expiredRows, error: updateError } = await supabase
    .from('private_bookings')
    .update({
      status: 'cancelled',
      cancellation_reason: 'Deposit hold expired',
      cancelled_at: now,
      updated_at: now,
    })
    .eq('status', 'draft')
    .not('hold_expiry', 'is', null)
    .lt('hold_expiry', now)
    .select('id');

  if (updateError) {
    logger.error('private-bookings-expire-holds: atomic update failed', {
      error: new Error(updateError.message),
      metadata: { message: updateError.message },
    });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const ids = (expiredRows ?? []).map((r) => r.id);

  if (ids.length === 0) {
    logger.info('private-bookings-expire-holds: no expired holds found');
    return NextResponse.json({ ok: true, cancelled: 0 });
  }

  // Per-row side effects: cancel pending SMS, clean up calendar, send expiry notification.
  // expireBooking() handles all of this. Since the status is already 'cancelled' from the
  // atomic update above, we call it with asSystem and sendNotification to handle cleanup.
  const results: Array<{ id: string; smsSent: boolean; error?: string }> = [];

  for (const id of ids) {
    try {
      // expireBooking expects draft status — but we already set cancelled above.
      // Instead, perform per-row cleanup inline: cancel pending SMS, calendar, notification.

      // 1. Cancel pending SMS for this booking
      try {
        await supabase
          .from('private_booking_sms_queue')
          .update({ status: 'cancelled', updated_at: now })
          .eq('booking_id', id)
          .in('status', ['pending', 'approved']);
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
              await supabase
                .from('private_bookings')
                .update({ calendar_event_id: null })
                .eq('id', id);
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
          .select('customer_first_name, customer_name, contact_phone, customer_id, event_date, date_tbd, internal_notes')
          .eq('id', id)
          .maybeSingle();

        if (booking && (booking.contact_phone || booking.customer_id)) {
          const { isBookingDateTbd } = await import('@/lib/private-bookings/tbd-detection');
          const { bookingExpiredMessage } = await import('@/lib/private-bookings/messages');
          const { SmsQueueService } = await import('@/services/sms-queue');

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

          const smsResult = await SmsQueueService.queueAndSend({
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
    metadata: { count: ids.length, ids, results },
  });

  return NextResponse.json({ ok: true, cancelled: ids.length, results });
}
