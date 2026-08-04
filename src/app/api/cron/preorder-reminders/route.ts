/**
 * Chasing a seasonal pre-order. Spec section 7.
 *
 * One pass a day over future bookings that owe us food choices. Two messages per booking, ever:
 * a reminder to the booker seven days out, and an email to the manager once the booker has had that
 * reminder and the period's cutoff has come round. An incomplete order never cancels a booking. It
 * becomes a telephone call, which is exactly how the pub handles it today.
 *
 * WHICH CHASES ARE DUE IS NOT DECIDED HERE. `decidePreorderChases` in the shared library owns it,
 * including the rule that stops the manager escalation riding along with the booker's first reminder.
 * This route reads the ledger, asks, and sends.
 *
 * THE LEDGER IS THE IDEMPOTENCY. `booking_preorder_reminders` has a unique constraint on
 * (table_booking_id, kind), so the row is claimed BEFORE anything is sent and a duplicate key means
 * somebody already chased. There is deliberately no second mechanism: two crons racing, or one cron
 * running twice, both lose the race at the database and send nothing.
 *
 * A claimed row is never rolled back when the send itself fails. Deleting it to retry tomorrow would
 * turn an ambiguous failure (the SMS went out but the log write did not) into a second message to the
 * guest, and the spec caps this at two messages precisely to avoid that. A failed send is logged loudly
 * instead, and the pub rings the guest, which is the fallback for every case here anyway.
 *
 * WITHDRAWN DISHES ARE NOT CHASED. `getPreorderCompleteness` reports them separately from `complete`
 * and this cron only chases on `complete === false`. Deactivating one dish must not message every
 * affected Christmas booker; that is a short call list for a manager, per spec section 7.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { reportCronFailure } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import { jobQueue } from '@/lib/unified-job-queue'
import { createTableManageToken } from '@/lib/table-bookings/manage-booking'
import {
  decidePreorderChases,
  describePreorderGaps,
  getPreorderCompleteness,
  isPreorderEnabled,
  loadPreorderOrder,
  PREORDER_BOOKER_REMINDER_DAYS,
} from '@/lib/table-bookings/preorder'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import {
  eachIsoDateInRange,
  formatDateWithTimeForSms,
  getLocalIsoDateDaysAhead,
  getTodayIsoDate,
  toLocalIsoDate,
} from '@/lib/dateUtils'
import type { PreorderReminderKind } from '@/types/preorders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MANAGER_ESCALATION_EMAIL = 'manager@the-anchor.pub'
const DEAD_BOOKING_STATUSES = ['cancelled', 'no_show']
/** A season's worth of Christmas bookings is a few hundred; the cap is a runaway guard, not a page size. */
const MAX_BOOKINGS_PER_RUN = 500

type CandidateBooking = {
  id: string
  booking_reference: string
  booking_date: string
  booking_time: string | null
  party_size: number | null
  customer_id: string | null
  booking_period_id: string | null
  booking_period_name: string | null
}

type Booker = {
  id: string
  firstName: string
  fullName: string
  phone: string | null
  email: string | null
  smsActive: boolean
}

/**
 * Whole days from today to a booking date, counted on the London calendar rather than in
 * milliseconds. A run that straddles a clock change must not turn seven days into six and a half.
 * Returns null when the date is invalid or already past.
 */
function daysUntil(todayIso: string, bookingDateIso: string): number | null {
  const span = eachIsoDateInRange(todayIso, bookingDateIso)
  return span.length === 0 ? null : span.length - 1
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    if (!(await isPreorderEnabled(supabase))) {
      return NextResponse.json({ success: true, skipped: true, reason: 'preorder_disabled' })
    }

    const result = {
      checked: 0,
      alreadyComplete: 0,
      bookerReminders: 0,
      managerEscalations: 0,
      skipped: 0,
      failed: 0,
    }

    // Cutoffs are per period, so the window has to reach the furthest one. Without this a period
    // configured to escalate fourteen days out would never be looked at.
    const { data: periodRows, error: periodError } = await supabase
      .from('booking_periods')
      .select('id, preorder_cutoff_days')

    if (periodError) throw periodError

    const cutoffByPeriod = new Map<string, number>()
    for (const row of (periodRows ?? []) as Array<{ id: string; preorder_cutoff_days: number | null }>) {
      const days = Number(row.preorder_cutoff_days)
      if (Number.isFinite(days) && days >= 0) cutoffByPeriod.set(row.id, days)
    }

    const windowDays = Array.from(cutoffByPeriod.values()).reduce(
      (furthest, days) => Math.max(furthest, days),
      PREORDER_BOOKER_REMINDER_DAYS,
    )
    const today = getTodayIsoDate()
    const windowEnd = getLocalIsoDateDaysAhead(windowDays)

    const { data: bookingRows, error: bookingError } = await supabase
      .from('table_bookings')
      .select(
        'id, booking_reference, booking_date, booking_time, party_size, customer_id, ' +
          'booking_period_id, booking_period_name',
      )
      .gte('booking_date', today)
      .lte('booking_date', windowEnd)
      // Both halves matter: the period may require a pre-order, but a guest who answered "no, this is
      // not a Christmas dinner" owes nobody a choice and must never be chased.
      .eq('booking_period_requires_preorder', true)
      .eq('booking_period_answer', true)
      .not('status', 'in', `(${DEAD_BOOKING_STATUSES.join(',')})`)
      .order('booking_date', { ascending: true })
      .limit(MAX_BOOKINGS_PER_RUN)

    if (bookingError) throw bookingError

    const bookings = (bookingRows ?? []) as unknown as CandidateBooking[]
    if (bookings.length === 0) {
      return NextResponse.json({ success: true, result, window: { from: today, to: windowEnd } })
    }

    // One read of the ledger for the whole batch, so a booking already chased costs nothing further.
    // The claim below is still the authority; this only keeps the loop cheap.
    //
    // `sent_at` comes back as well as the kind, because the escalation rule needs to know not just
    // whether the booker was reminded but on which London day: a reminder claimed in this same sweep
    // has not been acted on yet.
    const { data: ledgerRows, error: ledgerError } = await supabase
      .from('booking_preorder_reminders')
      .select('table_booking_id, kind, sent_at')
      .in(
        'table_booking_id',
        bookings.map((booking) => booking.id),
      )

    if (ledgerError) throw ledgerError

    const sentOn = new Map<string, string>()
    for (const row of (ledgerRows ?? []) as Array<{
      table_booking_id: string
      kind: string
      sent_at: string | null
    }>) {
      const sentAt = row.sent_at ? new Date(row.sent_at) : null
      // A row with no readable timestamp is still a row: it was sent. Dating it today is the cautious
      // reading, because it defers the escalation to the next sweep rather than firing it early.
      const sentIsoDate = sentAt && !Number.isNaN(sentAt.getTime()) ? toLocalIsoDate(sentAt) : today
      sentOn.set(`${row.table_booking_id}:${row.kind}`, sentIsoDate)
    }

    for (const booking of bookings) {
      result.checked++

      const days = daysUntil(today, booking.booking_date)
      if (days === null) {
        result.skipped++
        continue
      }

      const cutoffDays = booking.booking_period_id
        ? cutoffByPeriod.get(booking.booking_period_id) ?? null
        : null

      const due: PreorderReminderKind[] = decidePreorderChases({
        daysUntilBooking: days,
        cutoffDays,
        bookerReminderSentOn: sentOn.get(`${booking.id}:booker_reminder`) ?? null,
        managerEscalationSent: sentOn.has(`${booking.id}:manager_escalation`),
        todayIso: today,
      })

      if (due.length === 0) {
        result.skipped++
        continue
      }

      const order = await loadPreorderOrder(supabase, booking.id)
      if (!order || !order.requiresPreorder) {
        result.skipped++
        continue
      }

      const completeness = getPreorderCompleteness(order)
      if (completeness.complete) {
        result.alreadyComplete++
        continue
      }

      const booker = await loadBooker(supabase, booking.customer_id)

      for (const kind of due) {
        const claimed = await claimReminder(supabase, booking.id, kind)
        if (!claimed) {
          result.skipped++
          continue
        }

        try {
          if (kind === 'booker_reminder') {
            await sendBookerReminder(supabase, booking, booker)
            result.bookerReminders++
          } else {
            await sendManagerEscalation(booking, booker, describePreorderGaps(completeness))
            result.managerEscalations++
          }
        } catch (sendError) {
          result.failed++
          logger.error('Pre-order chase claimed but not sent', {
            error: sendError instanceof Error ? sendError : new Error(String(sendError)),
            metadata: { bookingId: booking.id, reference: booking.booking_reference, kind },
          })
        }
      }
    }

    logger.info('Pre-order reminder sweep completed', {
      metadata: { ...result, window: { from: today, to: windowEnd } },
    })

    return NextResponse.json({ success: true, result, window: { from: today, to: windowEnd } })
  } catch (error) {
    logger.error('Pre-order reminder sweep failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await reportCronFailure('preorder-reminders', error)
    return NextResponse.json({ success: false, error: 'Pre-order reminder sweep failed' }, { status: 500 })
  }
}

/**
 * Take the one slot for this booking and kind. False means somebody already has it.
 * Any other database error is fatal for this booking: chasing without a ledger row is how a guest
 * gets the same message every night.
 */
async function claimReminder(
  supabase: ReturnType<typeof createAdminClient>,
  tableBookingId: string,
  kind: PreorderReminderKind,
): Promise<boolean> {
  const { error } = await supabase
    .from('booking_preorder_reminders')
    .insert({ table_booking_id: tableBookingId, kind })

  if (!error) return true
  if (isUniqueViolation(error)) return false
  throw error
}

async function loadBooker(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string | null,
): Promise<Booker | null> {
  if (!customerId) return null

  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_e164, mobile_number, email, sms_status')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const customer = data as unknown as {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_e164: string | null
    mobile_number: string | null
    email: string | null
    sms_status: string | null
  }

  return {
    id: customer.id,
    firstName: getSmartFirstName(customer.first_name),
    fullName: `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Unknown guest',
    phone: customer.mobile_e164 || customer.mobile_number || null,
    email: customer.email || null,
    smsActive: customer.sms_status === 'active',
  }
}

/**
 * SMS and email the booker the manage link they already use for this booking.
 *
 * The SMS goes through the jobs queue, which owns retries, rate limits and the outbound message log.
 * The email goes direct, because the queue has no email job type and adding one for two messages a
 * booking is the sort of new delivery subsystem this design exists to avoid.
 */
async function sendBookerReminder(
  supabase: ReturnType<typeof createAdminClient>,
  booking: CandidateBooking,
  booker: Booker | null,
): Promise<void> {
  if (!booker) throw new Error('Booking has no customer to chase')
  if (!booker.phone && !booker.email) throw new Error('Booker has neither a mobile number nor an email')

  const token = await createTableManageToken(supabase, {
    customerId: booker.id,
    tableBookingId: booking.id,
    bookingStartIso: null,
    appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
  })

  const bookingMoment = formatDateWithTimeForSms(booking.booking_date, booking.booking_time)
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || null

  if (booker.phone && booker.smsActive) {
    // Straight apostrophes and no dashes: one curly character drops the segment limit from 160 to 70.
    const message =
      `The Anchor: ${booker.firstName}, we still need the food choices for your booking on ` +
      `${bookingMoment}. Every guest needs a main course. Choose here: ${token.url}`

    // No `unique` key on the enqueue: the ledger row claimed above is the idempotency, and a second
    // mechanism here would only add a lock round trip and another way for the two to disagree.
    const enqueued = await jobQueue.enqueue('send_sms', {
      to: booker.phone,
      message,
      customer_id: booker.id,
      booking_id: booking.id,
      metadata: {
        table_booking_id: booking.id,
        template_key: 'table_booking_preorder_reminder',
      },
    })

    if (!enqueued.success) throw new Error(enqueued.error || 'Failed to queue the pre-order reminder SMS')
  }

  if (booker.email) {
    const html = [
      `<p>Hello ${escapeHtml(booker.firstName)},</p>`,
      `<p>We still need the food choices for your booking at The Anchor on ` +
        `${escapeHtml(bookingMoment)} (reference ${escapeHtml(booking.booking_reference)}).</p>`,
      '<p>Every guest needs to choose a main course. A starter and a dessert are optional.</p>',
      `<p><a href="${escapeHtml(token.url)}">Choose your food here</a></p>`,
      contactPhone
        ? `<p>Prefer to do it over the telephone? Ring us on ${escapeHtml(contactPhone)}.</p>`
        : '<p>Prefer to do it over the telephone? Please give us a ring.</p>',
    ].join('')

    const emailResult = await sendEmail({
      to: booker.email,
      subject: `Your food choices for ${booking.booking_reference}`,
      html,
      customerId: booker.id,
      tableBookingId: booking.id,
    })

    if (!emailResult.success) {
      throw new Error(emailResult.error || 'Failed to send the pre-order reminder email')
    }
  }
}

/**
 * Tell the manager which booking to ring and what is still missing.
 *
 * Deliberately carries no dietary notes and no guest names from the covers. Spec section 8 keeps that
 * information on permission-gated staff and kitchen screens, never in an email.
 */
async function sendManagerEscalation(
  booking: CandidateBooking,
  booker: Booker | null,
  missing: string,
): Promise<void> {
  const bookingMoment = formatDateWithTimeForSms(booking.booking_date, booking.booking_time)
  const details = [
    `<li><strong>Reference:</strong> ${escapeHtml(booking.booking_reference)}</li>`,
    `<li><strong>When:</strong> ${escapeHtml(bookingMoment)}</li>`,
    `<li><strong>Party size:</strong> ${escapeHtml(String(booking.party_size ?? 0))}</li>`,
    `<li><strong>Menu:</strong> ${escapeHtml(booking.booking_period_name || 'Seasonal menu')}</li>`,
    `<li><strong>Call:</strong> ${escapeHtml(booker?.fullName ?? 'Unknown guest')} on ` +
      `${escapeHtml(booker?.phone ?? 'no number on file')}</li>`,
    `<li><strong>Still needed:</strong> ${escapeHtml(missing)}</li>`,
  ]

  const html = [
    '<p>A seasonal pre-order has reached its cutoff and is still incomplete.</p>',
    '<ul>',
    ...details,
    '</ul>',
    '<p>Nothing has been cancelled. Ring the guest and take the choices over the telephone.</p>',
  ].join('')

  const emailResult = await sendEmail({
    to: MANAGER_ESCALATION_EMAIL,
    subject: `Pre-order still incomplete: ${booking.booking_reference}`,
    html,
    tableBookingId: booking.id,
  })

  if (!emailResult.success) {
    throw new Error(emailResult.error || 'Failed to send the pre-order escalation email')
  }
}
