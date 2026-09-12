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
import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import {
  decidePreorderChases,
  describePreorderGaps,
  getPreorderCompleteness,
  getPreorderCutoff,
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
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import {
  GUEST_CHANNEL_COLUMNS,
  notifyTableBookingGuestEmailFirst,
  type GuestChannelCustomer,
} from '@/lib/table-bookings/guest-notify'
import { buildTableBookingPreorderReminderEmail } from '@/lib/table-bookings/guest-emails'
import { buildPreorderReminderText } from '@/lib/table-bookings/guest-texts'
import { preorderReminderFacts } from '@/lib/table-bookings/fallback-details'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MANAGER_ESCALATION_EMAIL = 'manager@the-anchor.pub'
/**
 * Only a CONFIRMED booking is chased for food choices.
 *
 * An allow-list, not a list of dead statuses, because the failure modes point opposite ways. Miss a
 * status from a deny-list and the sweep messages a guest it should have left alone; miss one here and
 * it stays quiet, which is recoverable.
 *
 * `pending_payment` is the case that matters today. That guest has not paid their deposit, their hold
 * can still expire, and the booking may never exist. Texting them to choose three courses invites them
 * to plan a Christmas dinner they have not secured, and it spends an SMS on a booking that may
 * evaporate. Whatever is chasing them for the deposit is the right conversation, not this one. They
 * join the sweep the moment payment lands and they become confirmed.
 */
const CHASEABLE_BOOKING_STATUSES = ['confirmed']
/** A season's worth of Christmas bookings is a few hundred; the cap is a runaway guard, not a page size. */
const MAX_BOOKINGS_PER_RUN = 500

type CandidateBooking = {
  id: string
  booking_reference: string
  booking_date: string
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  customer_id: string | null
  booking_period_id: string | null
  booking_period_name: string | null
  /** The course tier each guest is on, which decides what is still owed. */
  christmas_course_counts: number[] | null
}

/** The deadline this booking is being chased against, for the wording of the chase. */
type PreorderDeadline = {
  cutoffDays: number | null
  closesAtIso: string | null
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

/** Still needed by the manager escalation below, which is written out here. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The chase, as both paths send it.
 *
 * The wording comes from the course tiers on the booking rather than from a fixed sentence. The
 * old line, "Every guest needs to choose a main course. A starter and a dessert are optional.",
 * contradicted the rule the sweep was chasing: a two or three course cover is only complete when
 * every one of its courses is chosen, so a guest who read it and picked a main was still
 * incomplete and still being escalated to the manager.
 */
function buildPreorderReminderEmail(
  booking: CandidateBooking,
  booker: Booker,
  manageUrl: string,
  deadline: PreorderDeadline,
) {
  return buildTableBookingPreorderReminderEmail({
    firstName: booker.firstName,
    bookingReference: booking.booking_reference,
    bookingDate: booking.booking_date,
    bookingTime: booking.booking_time,
    partySize: booking.party_size,
    manageLink: manageUrl,
    periodName: booking.booking_period_name,
    courseCounts: booking.christmas_course_counts,
    preorderCutoffDays: deadline.cutoffDays,
    preorderClosesAtIso: deadline.closesAtIso,
  })
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

    // Owner decision, 11 September 2026: the booker reminder goes by email first, with a text
    // only when there is no usable address or the email fails. Read once per sweep; off (and
    // any failure to read it) is today's text-and-email pair.
    const bookerReminderEmailFirst = await isMessagingFlagOn('table_preorder_email_first')

    const result = {
      checked: 0,
      alreadyComplete: 0,
      bookerReminders: 0,
      managerEscalations: 0,
      skipped: 0,
      failed: 0,
      // Chases that went out at full link length because shortening failed.
      shortLinkFallbacks: 0,
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
        'id, booking_reference, booking_date, booking_time, start_datetime, party_size, customer_id, ' +
          'booking_period_id, booking_period_name, christmas_course_counts',
      )
      .gte('booking_date', today)
      .lte('booking_date', windowEnd)
      // Both halves matter: the period may require a pre-order, but a guest who answered "no, this is
      // not a Christmas dinner" owes nobody a choice and must never be chased.
      .eq('booking_period_requires_preorder', true)
      .eq('booking_period_answer', true)
      .in('status', CHASEABLE_BOOKING_STATUSES)
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

      // The same rule the manage page uses to lock the form, so a guest is never texted a link to
      // a form that will refuse them, and the same instant the chase quotes as its deadline.
      const cutoff = getPreorderCutoff({ bookingDate: booking.booking_date, preorderCutoffDays: cutoffDays })
      const deadline: PreorderDeadline = {
        cutoffDays,
        closesAtIso: cutoff.closesAt ? cutoff.closesAt.toISOString() : null,
      }

      const due: PreorderReminderKind[] = decidePreorderChases({
        daysUntilBooking: days,
        cutoffDays,
        bookerReminderSentOn: sentOn.get(`${booking.id}:booker_reminder`) ?? null,
        managerEscalationSent: sentOn.has(`${booking.id}:manager_escalation`),
        todayIso: today,
        preorderClosed: cutoff.closed,
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
            const reminder = bookerReminderEmailFirst
              ? await sendBookerReminderEmailFirst(supabase, booking, booker, deadline)
              : await sendBookerReminder(supabase, booking, booker, deadline)
            result.bookerReminders++
            if (reminder.shortLinkFallback) result.shortLinkFallbacks++
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
 *
 * The email is built by the shared template, exactly as the email-first path builds it, so the
 * two cannot say different things. It used to be written out here with no text part and a
 * "please give us a ring" line that named no number whenever the contact-phone variable was
 * unset.
 */
async function sendBookerReminder(
  supabase: ReturnType<typeof createAdminClient>,
  booking: CandidateBooking,
  booker: Booker | null,
  deadline: PreorderDeadline,
): Promise<{ shortLinkFallback: boolean }> {
  if (!booker) throw new Error('Booking has no customer to chase')
  if (!booker.phone && !booker.email) throw new Error('Booker has neither a mobile number nor an email')

  const token = await createTableManageToken(supabase, {
    customerId: booker.id,
    tableBookingId: booking.id,
    // The booking's own start, so the link lives until the sitting rather than for a flat
    // fortnight from the chase.
    bookingStartIso: booking.start_datetime,
    appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
  })

  // Shortened once here so the queued SMS and the email carry the same link.
  const manage = await buildGuestShortLink({
    longUrl: token.url,
    linkKind: 'table_manage',
    customerId: booker.id,
    tableBookingId: booking.id,
  })

  if (booker.phone && booker.smsActive) {
    const message = buildPreorderReminderText({
      firstName: booker.firstName,
      bookingDate: booking.booking_date,
      bookingTime: booking.booking_time,
      manageLink: manage.url,
    })

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
    const email = buildPreorderReminderEmail(booking, booker, manage.url, deadline)

    const emailResult = await sendEmail({
      to: booker.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      customerId: booker.id,
      tableBookingId: booking.id,
    })

    if (!emailResult.success) {
      throw new Error(emailResult.error || 'Failed to send the pre-order reminder email')
    }
  }

  return { shortLinkFallback: !manage.shortened }
}

/**
 * The booker reminder by email first (messaging flag table_preorder_email_first).
 *
 * One message, not two: the email when the booker has a usable address, otherwise (or when the
 * email fails in the same attempt) the same text as today, sent straight away rather than
 * through the jobs queue. The email gains the comm type and the address health check the old
 * direct email lacked. Anything that reaches nobody is thrown, so the sweep counts it as failed,
 * and the audit row names the booking. The ledger row stays claimed, as for every other failure.
 */
async function sendBookerReminderEmailFirst(
  supabase: ReturnType<typeof createAdminClient>,
  booking: CandidateBooking,
  booker: Booker | null,
  deadline: PreorderDeadline,
): Promise<{ shortLinkFallback: boolean }> {
  if (!booker) throw new Error('Booking has no customer to chase')

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select(GUEST_CHANNEL_COLUMNS)
    .eq('id', booker.id)
    .maybeSingle()

  if (customerError) throw customerError
  if (!customerRow) throw new Error('Booker could not be loaded')
  const customer = customerRow as unknown as GuestChannelCustomer

  const token = await createTableManageToken(supabase, {
    customerId: booker.id,
    tableBookingId: booking.id,
    // The booking's own start, so the link lives until the sitting rather than for a flat
    // fortnight from the chase.
    bookingStartIso: booking.start_datetime,
    appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
  })

  // Shortened once so the email and a fallback text carry the same link.
  const manage = await buildGuestShortLink({
    longUrl: token.url,
    linkKind: 'table_manage',
    customerId: booker.id,
    tableBookingId: booking.id,
  })

  const templateKey = 'table_booking_preorder_reminder'

  const outcome = await notifyTableBookingGuestEmailFirst({
    supabase,
    templateKey,
    tableBookingId: booking.id,
    customer,
    email: buildPreorderReminderEmail(booking, booker, manage.url, deadline),
    sms: {
      to: booker.phone,
      // Today's text, word for word.
      body: buildPreorderReminderText({
        firstName: booker.firstName,
        bookingDate: booking.booking_date,
        bookingTime: booking.booking_time,
        manageLink: manage.url,
      }),
    },
    idempotencyKey: `${templateKey}:${booking.id}`,
    auditContext: { booking_reference: booking.booking_reference, short_link_fallback: !manage.shortened },
    fallback: {
      message: 'preorder_reminder',
      // The sweep only chases an order that is required, incomplete and still open.
      facts: preorderReminderFacts({
        bookingDate: booking.booking_date,
        bookingTime: booking.booking_time,
        choicesOutstanding: true,
      }),
      link: manage.shortened ? 'short_link' : 'full_url',
    },
  })

  if (outcome.status !== 'sent') {
    throw new Error(`Pre-order reminder reached nobody (${outcome.status}): ${outcome.error ?? 'unknown'}`)
  }

  return { shortLinkFallback: !manage.shortened }
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
