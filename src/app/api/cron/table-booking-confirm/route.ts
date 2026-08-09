/**
 * Texting a guest the day before to ask whether they are still coming.
 *
 * WHY THIS EXISTS: 21% of table bookings in the ninety days to 9 August 2026 never
 * happened. 52 cancelled and 12 no-shows out of 308, and every no-show came from a
 * website booking. Nothing chased any of them.
 *
 * IT DOES NOT CANCEL ANYTHING. A guest who does not answer keeps their table and appears
 * in `table_bookings_awaiting_confirmation` for staff to ring, which is exactly how the
 * pub already handles an unfinished pre-order. Auto-release is a separate decision that
 * should not be taken until there is a real tap rate to look at, because twelve no-shows
 * a quarter does not justify wrongly cancelling even one genuine booking.
 *
 * WHO GETS ONE IS NOT DECIDED HERE. `decideConfirmReminder` owns that, so the rule can be
 * tested without a database, a clock or Twilio. This route loads, asks, claims and sends.
 *
 * THE LEDGER IS THE IDEMPOTENCY. `table_booking_confirm_reminders` is unique on
 * table_booking_id and the row is claimed BEFORE the send, so two crons racing or one
 * running twice both lose at the database and send nothing. A claimed row is never rolled
 * back on a failed send: deleting it to retry would turn an ambiguous failure (text
 * delivered, log write did not) into a second text to the guest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { reportCronFailure } from '@/lib/cron/alerting'
import { jobQueue } from '@/lib/unified-job-queue'
import { createBookingConfirmToken } from '@/lib/table-bookings/manage-booking'
import { formatDateWithTimeForSms, getLocalIsoDateDaysAhead, getTodayIsoDate } from '@/lib/dateUtils'
import {
  buildConfirmReminderMessage,
  CONFIRMABLE_BOOKING_STATUSES,
  decideConfirmReminder,
  type ConfirmCandidate,
} from '@/lib/table-bookings/confirm-reminder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** A runaway guard, not a page size. A busy Sunday is a few dozen bookings. */
const MAX_BOOKINGS_PER_RUN = 300

type BookingRow = {
  id: string
  booking_reference: string
  booking_date: string
  booking_time: string | null
  party_size: number | null
  status: string
  guest_confirmed_at: string | null
  customer_id: string | null
  customers: {
    id: string
    first_name: string | null
    mobile_e164: string | null
    mobile_number: string | null
    sms_status: string | null
  } | null
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  // Europe/London throughout, via the project's own date helpers. A booking stored as
  // 2026-08-10 means that date in the pub, and deriving "tomorrow" from the server's UTC
  // clock would skip or double a day either side of midnight.
  const todayIsoDate = getTodayIsoDate()
  const tomorrowIsoDate = getLocalIsoDateDaysAhead(1)
  const counts = { considered: 0, sent: 0, skipped: 0, failed: 0 }
  const skipReasons: Record<string, number> = {}

  try {
    const { data: bookings, error: bookingsError } = await supabase
      .from('table_bookings')
      .select(
        'id, booking_reference, booking_date, booking_time, party_size, status, guest_confirmed_at, customer_id, customers(id, first_name, mobile_e164, mobile_number, sms_status)',
      )
      .in('status', CONFIRMABLE_BOOKING_STATUSES as unknown as string[])
      .is('guest_confirmed_at', null)
      .eq('booking_date', tomorrowIsoDate)
      .limit(MAX_BOOKINGS_PER_RUN)

    if (bookingsError) throw bookingsError

    const rows = (bookings ?? []) as unknown as BookingRow[]
    counts.considered = rows.length

    if (rows.length === 0) {
      return NextResponse.json({ success: true, ...counts })
    }

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from('table_booking_confirm_reminders')
      .select('table_booking_id')
      .in(
        'table_booking_id',
        rows.map((row) => row.id),
      )

    if (ledgerError) throw ledgerError
    const alreadySent = new Set((ledgerRows ?? []).map((row) => row.table_booking_id as string))

    for (const row of rows) {
      const candidate: ConfirmCandidate = {
        id: row.id,
        bookingReference: row.booking_reference,
        status: row.status,
        bookingDate: row.booking_date,
        guestConfirmedAt: row.guest_confirmed_at,
        reminderAlreadySent: alreadySent.has(row.id),
        customer: row.customers
          ? {
              id: row.customers.id,
              firstName: row.customers.first_name,
              phone: row.customers.mobile_e164 || row.customers.mobile_number || null,
              smsActive: row.customers.sms_status === 'active',
            }
          : null,
      }

      const decision = decideConfirmReminder(candidate, todayIsoDate)
      if (!decision.send) {
        counts.skipped += 1
        skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1
        continue
      }

      // CLAIM FIRST. A duplicate key here means another run already has this booking, and
      // losing that race must be silent rather than an error.
      const { error: claimError } = await supabase
        .from('table_booking_confirm_reminders')
        .insert({ table_booking_id: row.id })

      if (claimError) {
        counts.skipped += 1
        skipReasons.claimed_by_another_run = (skipReasons.claimed_by_another_run ?? 0) + 1
        continue
      }

      try {
        const token = await createBookingConfirmToken(supabase, {
          customerId: candidate.customer!.id,
          tableBookingId: row.id,
          bookingStartIso: `${row.booking_date}T${row.booking_time || '00:00'}:00`,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
        })

        const message = buildConfirmReminderMessage({
          firstName: candidate.customer!.firstName,
          bookingMoment: formatDateWithTimeForSms(row.booking_date, row.booking_time),
          partySize: row.party_size,
          confirmUrl: token.url,
        })

        // No `unique` key on the enqueue: the ledger row above is the idempotency, and a
        // second mechanism would only add a lock round trip and another way to disagree.
        const enqueued = await jobQueue.enqueue('send_sms', {
          to: candidate.customer!.phone,
          message,
          customer_id: candidate.customer!.id,
          booking_id: row.id,
          metadata: {
            table_booking_id: row.id,
            template_key: 'table_booking_confirm_reminder',
          },
        })

        if (!enqueued.success) {
          throw new Error(enqueued.error || 'Failed to queue the confirmation SMS')
        }

        counts.sent += 1
      } catch (sendError) {
        // The ledger row STAYS. See the header: retrying an ambiguous failure is how a
        // guest gets texted twice, and the pub rings anyone this sweep could not reach.
        counts.failed += 1
        logger.error('Failed to send a table booking confirm reminder', {
          metadata: {
            tableBookingId: row.id,
            bookingReference: row.booking_reference,
            error: sendError instanceof Error ? sendError.message : String(sendError),
          },
        })
      }
    }

    logger.info('Table booking confirm reminders swept', { metadata: { ...counts, skipReasons } })
    return NextResponse.json({ success: true, ...counts, skipReasons })
  } catch (error) {
    logger.error('Table booking confirm reminder cron failed', {
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
    await reportCronFailure('table-booking-confirm', error)
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
