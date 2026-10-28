/**
 * Chasing missing event guest details (BK-132, owner decision D5). Runs once a day.
 *
 * - Each booking still missing guest names or answers is reminded once, 3 days before the night
 *   (or on the first run inside that window), by email first and a text only when there is no
 *   usable email (D14). Behind the same messaging flag as the first request
 *   (event_guest_details_request), so the whole "details to follow" chase is switched on at once.
 * - The day before, the manager is emailed the bookings still incomplete for each event.
 *
 * THE LEDGER IS THE IDEMPOTENCY. `event_guest_details_reminders` has one row per booking reminder
 * and one per event list, claimed BEFORE anything is sent; a duplicate key means it was done. A
 * claimed row stays when a send fails, because a send whose outcome is unknown may have reached
 * the guest. The one exception is a message the email log could not check (deferred): nothing
 * went, so the claim is released and tomorrow's run tries again.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getAppUrl } from '@/lib/env'
import { withCronRun } from '@/lib/cron/run-recorder'
import { settleWrite } from '@/lib/supabase/settle-write'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName, buildSmartFullName } from '@/lib/sms/name-utils'
import { getTodayIsoDate, shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { bookingQuestionsSchema, requiresGuestDetails } from '@/lib/events/booking-questions'
import { ticketsMissingDetails } from '@/lib/events/guest-details-edit'
import { GUEST_DETAILS_REQUEST_FLAG } from '@/lib/events/guest-details-request'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { formatEventWhenLondon, resolveEventStartIso } from '@/lib/events/event-when'
import { buildEventGuestDetailsReminderText, formatEventTextWhen } from '@/lib/events/event-guest-texts'
import { sendEventMessageEmailFirst } from '@/lib/events/event-guest-notify'
import { sendEventGuestDetailsReminderEmail } from '@/lib/email/event-ticket-emails'
import {
  GUEST_DETAILS_REMINDER_DAYS,
  buildGuestDetailsManagerEmail,
  isBookerReminderDue,
  isManagerListDay,
  type ManagerListRow,
} from '@/lib/events/guest-details-chase'

export const maxDuration = 120

/** The same inbox the pre-order escalation and feedback use. */
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'manager@the-anchor.pub'

type EventRow = {
  id: string
  name: string | null
  start_datetime: string | null
  date: string | null
  time: string | null
  event_status: string | null
  collect_guest_details: boolean | null
  payment_mode: string | null
  booking_questions: unknown
}

type CustomerRow = { id: string; first_name: string | null; last_name: string | null; mobile_number: string | null; sms_status: string | null }

type BookingRow = {
  id: string
  event_id: string
  seats: number | null
  status: string | null
  source: string | null
  attendees: unknown
  created_at: string | null
  is_reminder_only: boolean | null
  customer: CustomerRow | CustomerRow[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

async function claim(
  supabase: ReturnType<typeof createAdminClient>,
  row: { kind: 'booker_reminder' | 'manager_list'; event_id: string; event_booking_id?: string | null; metadata?: Record<string, unknown> }
): Promise<{ claimed: boolean; id: string | null; error?: string }> {
  const { data, error } = await (supabase.from('event_guest_details_reminders') as any)
    .insert({ ...row, event_booking_id: row.event_booking_id ?? null, metadata: row.metadata ?? {} })
    .select('id')
    .maybeSingle()
  if (error) {
    if (isUniqueViolation(error)) return { claimed: false, id: null }
    return { claimed: false, id: null, error: error.message || 'claim failed' }
  }
  return { claimed: true, id: data?.id ?? null }
}

async function sendGuestDetailsReminderText(
  supabase: ReturnType<typeof createAdminClient>,
  input: { booking: BookingRow; customer: CustomerRow; event: EventRow; missing: number; appBaseUrl: string }
): Promise<{ success: boolean; code: string | null; logFailure: boolean; sid?: string | null } | null> {
  const { customer, booking, event } = input
  if (customer.sms_status !== 'active' || !customer.mobile_number) return null
  let link: string
  try {
    link = (await createEventManageToken(supabase, {
      customerId: customer.id,
      bookingId: booking.id,
      eventStartIso: resolveEventStartIso(event),
      appBaseUrl: input.appBaseUrl,
    })).url
  } catch {
    return { success: false, code: 'link_unavailable', logFailure: false }
  }
  const body = buildEventGuestDetailsReminderText({
    firstName: getSmartFirstName(customer.first_name),
    eventName: event.name || 'your event',
    when: formatEventTextWhen(resolveEventStartIso(event)),
    missingCount: input.missing,
    detailsLink: link,
  })
  try {
    const result = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: { event_booking_id: booking.id, event_id: event.id, template_key: 'event_guest_details_reminder' },
    })
    const code = typeof result.code === 'string' ? result.code : null
    return {
      success: result.success === true,
      code: result.success ? code : code ?? 'send_failed',
      logFailure: result.logFailure === true || code === 'logging_failed',
      sid: result.sid ?? null,
    }
  } catch {
    return { success: false, code: 'unexpected_exception', logFailure: false }
  }
}

async function runGuestDetailsReminders(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const today = getTodayIsoDate()
  const firstDay = shiftIsoDate(today, 1)
  const dayAfterWindow = shiftIsoDate(today, GUEST_DETAILS_REMINDER_DAYS + 1)
  const windowStart = firstDay ? whenLondonClockReaches(firstDay, '00:00') : null
  const windowEnd = dayAfterWindow ? whenLondonClockReaches(dayAfterWindow, '00:00') : null
  if (!windowStart || !windowEnd) {
    return NextResponse.json({ error: 'Could not work out the reminder window' }, { status: 500 })
  }
  const appBaseUrl = getAppUrl()
  const result = { events: 0, bookingsChecked: 0, remindersSent: 0, remindersFailed: 0, remindersDeferred: 0, managerLists: 0, failed: 0 }

  const { data: eventRows, error: eventError } = await supabase
    .from('events')
    .select('id, name, start_datetime, date, time, event_status, collect_guest_details, payment_mode, booking_questions')
    .gte('start_datetime', windowStart.toISOString())
    .lt('start_datetime', windowEnd.toISOString())
  if (eventError) {
    logger.error('Guest details reminders could not load events', { error: new Error(eventError.message) })
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }

  const events = ((eventRows ?? []) as EventRow[]).filter((event) => event.event_status !== 'cancelled' && requiresGuestDetails(event))
  result.events = events.length
  if (events.length === 0) return NextResponse.json({ success: true, result })

  const eventIds = events.map((event) => event.id)
  const [{ data: bookingRows, error: bookingError }, { data: ledgerRows, error: ledgerError }] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, event_id, seats, status, source, attendees, created_at, is_reminder_only, customer:customers(id, first_name, last_name, mobile_number, sms_status)')
      .in('event_id', eventIds)
      .in('status', ['confirmed', 'pending_payment']),
    (supabase.from('event_guest_details_reminders') as any)
      .select('event_booking_id, event_id, kind')
      .in('event_id', eventIds),
  ])
  if (bookingError || ledgerError) {
    logger.error('Guest details reminders could not load bookings or the ledger', {
      error: new Error(bookingError?.message ?? ledgerError?.message ?? 'load failed'),
    })
    return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 })
  }

  const reminded = new Set<string>()
  const listed = new Set<string>()
  for (const row of (ledgerRows ?? []) as Array<{ event_booking_id: string | null; event_id: string; kind: string }>) {
    if (row.kind === 'booker_reminder' && row.event_booking_id) reminded.add(row.event_booking_id)
    if (row.kind === 'manager_list') listed.add(row.event_id)
  }

  const flagOn = await isMessagingFlagOn(GUEST_DETAILS_REQUEST_FLAG)
  const bookings = (bookingRows ?? []) as BookingRow[]

  for (const event of events) {
    const startIso = resolveEventStartIso(event)
    if (!startIso) continue
    const eventDate = toLocalIsoDate(new Date(startIso))
    const parsedQuestions = bookingQuestionsSchema.safeParse(event.booking_questions ?? [])
    const questions = parsedQuestions.success ? parsedQuestions.data : []
    const incomplete: ManagerListRow[] = []

    for (const booking of bookings.filter((row) => row.event_id === event.id)) {
      // A walk-in is in the room; a reminder-only entry has no tickets.
      if (booking.source === 'walk-in' || booking.is_reminder_only === true || Number(booking.seats ?? 0) < 1) continue
      result.bookingsChecked++
      const missing = ticketsMissingDetails([{ seats: booking.seats, attendees: booking.attendees }], questions)
      if (missing <= 0) continue
      const customer = one(booking.customer)
      incomplete.push({
        reference: booking.id.slice(0, 8).toUpperCase(),
        bookerName: buildSmartFullName(customer?.first_name, customer?.last_name),
        missing,
      })

      if (!flagOn || !customer) continue
      if (!isBookerReminderDue({ today, eventDate, bookingCreatedAt: booking.created_at, now, alreadyReminded: reminded.has(booking.id), missing })) continue

      const claimed = await claim(supabase, { kind: 'booker_reminder', event_id: event.id, event_booking_id: booking.id, metadata: { missing_count: missing } })
      if (claimed.error) {
        result.failed++
        logger.error('Guest details reminder could not be claimed', { metadata: { bookingId: booking.id, error: claimed.error } })
        continue
      }
      if (!claimed.claimed) continue

      const outcome = await sendEventMessageEmailFirst({
        templateKey: 'event_guest_details_reminder',
        bookingId: booking.id,
        eventId: event.id,
        customerId: customer.id,
        retriesLater: true,
        email: () => sendEventGuestDetailsReminderEmail(supabase, { bookingId: booking.id, missingCount: missing, appBaseUrl }),
        text: () => sendGuestDetailsReminderText(supabase, { booking, customer, event, missing, appBaseUrl }),
      })

      if (outcome.status === 'deferred' && claimed.id) {
        // Nothing went, so tomorrow's run may try again.
        await settleWrite(
          (supabase.from('event_guest_details_reminders') as any).delete().eq('id', claimed.id),
          { table: 'event_guest_details_reminders', what: 'Releasing a deferred guest details reminder', ids: { bookingId: booking.id } }
        )
        result.remindersDeferred++
      } else if (outcome.status === 'sent' || outcome.status === 'already_sent') {
        result.remindersSent++
      } else {
        result.remindersFailed++
      }
      if (claimed.id && outcome.status !== 'deferred') {
        await settleWrite(
          (supabase.from('event_guest_details_reminders') as any)
            .update({ metadata: { missing_count: missing, outcome: outcome.status, sent_channel: outcome.channel } })
            .eq('id', claimed.id),
          { table: 'event_guest_details_reminders', what: 'Recording the guest details reminder outcome', ids: { bookingId: booking.id } }
        )
      }
    }

    if (incomplete.length === 0 || listed.has(event.id) || !isManagerListDay({ today, eventDate })) continue
    const claimedList = await claim(supabase, { kind: 'manager_list', event_id: event.id, metadata: { bookings: incomplete.length } })
    if (claimedList.error) {
      result.failed++
      logger.error('Guest details manager list could not be claimed', { metadata: { eventId: event.id, error: claimedList.error } })
      continue
    }
    if (!claimedList.claimed) continue

    const email = buildGuestDetailsManagerEmail({
      eventName: event.name || 'the event',
      when: formatEventWhenLondon(startIso),
      eventUrl: `${appBaseUrl}/events/${event.id}`,
      rows: incomplete,
    })
    const sent = await sendEmail({ to: MANAGER_EMAIL, subject: email.subject, html: email.html, text: email.text })
    if (sent.success) {
      result.managerLists++
    } else {
      result.failed++
      logger.error('Guest details manager list did not send', { metadata: { eventId: event.id, error: sent.error ?? null } })
    }
  }

  return NextResponse.json({ success: true, result })
}

// A run record per run and a failure email when the run fails (BK-116).
export const GET = withCronRun('event-guest-details-reminders', runGuestDetailsReminders, {
  recording: 'every_run',
  itemFailures: (body) => Number((body.result as { failed?: number; remindersFailed?: number } | undefined)?.failed ?? 0)
    + Number((body.result as { remindersFailed?: number } | undefined)?.remindersFailed ?? 0),
})
