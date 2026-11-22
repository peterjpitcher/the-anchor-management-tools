import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { getAppUrl } from '@/lib/env'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { currentEmailSuspensionReason } from '@/lib/email/suspension'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { isEmailUsable } from '@/lib/notifications/channel'
import { preferBookingContactEmail } from '@/lib/bookings/contact-email'
import { createGuestToken } from '@/lib/guest/tokens'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { AuditService } from '@/services/audit'
import { formatTimeInLondon, shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { buildNoShowFollowUpEmail, noShowFollowUpProblem } from '@/lib/table-bookings/no-show-follow-up-email'

/**
 * The morning-after email to a guest whose table booking was marked a no-show, by staff or by the
 * end-of-day sweep (owner decisions of 22 November 2026), run by api/cron/table-booking-no-shows.
 *
 * The cron runs every hour and this acts only on the run that falls at 10:00 London, in winter
 * and in summer time.
 *
 * A booking is emailed once, and only when ALL of these hold:
 *  - it is a no-show now (one put right before 10:00 is not emailed) and has never been claimed;
 *  - it was for yesterday, by its date AND by the London date of its real start, because the
 *    subject says "yesterday". A no-show marked days late from the strip is never emailed;
 *  - it is not the table half of an event booking;
 *  - there is a usable email address: the one typed for this booking, else the customer's, well
 *    formed and not invalid, bounced, complained, deactivated or suppressed;
 *  - the same guest has not already been emailed in this run (two tables, one email).
 *
 * EMAIL ONLY. It goes through sendEmail directly, never through the email-first helper, so there
 * is no text to fall back to, now or after a bounce. A guest with no usable address gets nothing.
 *
 * THE CLAIM IS THE IDEMPOTENCY. Each booking is claimed with a conditional update that returns the
 * row, before the link is made or anything is sent, and the claim is never released. A send that
 * was refused, or whose outcome is unknown, is logged and never retried automatically. The
 * provider idempotency key stops a retry inside one run sending twice.
 *
 * Honours the messaging flag table_no_show_follow_up and the email kill switches: while
 * SUSPEND_ALL_EMAIL or SUSPEND_ALL_COMMS is on nothing is claimed. Those bookings are not picked
 * up the next day (they are no longer "yesterday"), which is the safe way round for this email.
 */

// `any` matches the untyped admin client the crons pass around.
type Db = SupabaseClient<any, 'public', any>

export const NO_SHOW_FOLLOW_UP_FLAG = 'table_no_show_follow_up'
export const NO_SHOW_FOLLOW_UP_LONDON_HOUR = 10
export const NO_SHOW_FOLLOW_UP_COMM_TYPE = 'table_no_show_follow_up'
export const NO_SHOW_FOLLOW_UP_TOKEN_ACTION = 'no_show_follow_up'
/** How long the link in the email works. */
export const NO_SHOW_FOLLOW_UP_LINK_DAYS = 14
/** A ceiling on one run. A normal morning has a handful. */
export const NO_SHOW_FOLLOW_UP_MAX_PER_RUN = 100

export function noShowFollowUpIdempotencyKey(tableBookingId: string): string {
  return `table-booking-no-show-follow-up:${tableBookingId}`
}

export function noShowFollowUpUrl(rawToken: string, appBaseUrl: string = getAppUrl()): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/g/${rawToken}/no-show-follow-up`
}

/** True on the run that falls at 10:00 London. */
export function isNoShowFollowUpHour(now: Date): boolean {
  return Number(formatTimeInLondon(now).slice(0, 2)) === NO_SHOW_FOLLOW_UP_LONDON_HOUR
}

export type NoShowFollowUpSkipReason =
  | 'not_yesterday'
  | 'no_usable_email'
  | 'missing_details'
  | 'same_guest'
  | 'claimed_elsewhere'

export type NoShowFollowUpRunResult =
  | { state: 'not_due'; londonTime: string }
  | {
      state: 'ran'
      flag: 'on' | 'off'
      held: 'email_suspended' | null
      considered: number
      sent: number
      refused: number
      uncertain: number
      skipped: Partial<Record<NoShowFollowUpSkipReason, number>>
      /** Database faults: a booking not claimed, not linked or not marked as sent. */
      errors: number
    }

export type NoShowFollowUpDeps = {
  db: Db
  now?: Date
  /** Defaults to the real sendEmail; tests pass a fake. */
  send?: typeof sendEmail
  flagOn?: () => Promise<boolean>
  suspended?: () => boolean
  /** Defaults to the suppression list. */
  isSuppressed?: (email: string) => Promise<boolean>
  appBaseUrl?: string
}

type CustomerRow = {
  id: string
  first_name: string | null
  email: string | null
  email_status: string | null
  email_deactivated_at: string | null
}

type BookingRow = {
  id: string
  customer_id: string | null
  booking_date: string
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  contact_email: string | null
  customer: CustomerRow | CustomerRow[] | null
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(error)
}

/** The London date the booking really started on, or null when it cannot be worked out. */
function londonStartDate(booking: Pick<BookingRow, 'booking_date' | 'booking_time' | 'start_datetime'>): string | null {
  const stored = booking.start_datetime ? Date.parse(booking.start_datetime) : Number.NaN
  if (Number.isFinite(stored)) return toLocalIsoDate(new Date(stored))
  if (!booking.booking_time) return null
  const start = whenLondonClockReaches(booking.booking_date, booking.booking_time.slice(0, 5))
  return start ? toLocalIsoDate(start) : null
}

export async function runNoShowFollowUps(deps: NoShowFollowUpDeps): Promise<NoShowFollowUpRunResult> {
  const now = deps.now ?? new Date()
  if (!isNoShowFollowUpHour(now)) return { state: 'not_due', londonTime: formatTimeInLondon(now) }

  const db = deps.db
  const send = deps.send ?? sendEmail
  const isSuppressed = deps.isSuppressed ?? isEmailSuppressed
  const nowIso = now.toISOString()
  const result: Extract<NoShowFollowUpRunResult, { state: 'ran' }> = {
    state: 'ran',
    flag: 'off',
    held: null,
    considered: 0,
    sent: 0,
    refused: 0,
    uncertain: 0,
    skipped: {},
    errors: 0,
  }
  const skip = (reason: NoShowFollowUpSkipReason) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1
  }

  const flagOn = deps.flagOn ? await deps.flagOn() : await isMessagingFlagOn(NO_SHOW_FOLLOW_UP_FLAG)
  if (!flagOn) return result
  result.flag = 'on'

  // A kill switch holds the run rather than burning each booking's one claim on a refused send.
  if (deps.suspended ? deps.suspended() : currentEmailSuspensionReason() !== null) {
    result.held = 'email_suspended'
    return result
  }

  const yesterday = shiftIsoDate(toLocalIsoDate(now), -1)
  if (!yesterday) {
    result.errors += 1
    return result
  }

  const { data, error } = await db
    .from('table_bookings')
    .select(
      'id, customer_id, booking_date, booking_time, start_datetime, party_size, contact_email, customer:customers!table_bookings_customer_id_fkey(id, first_name, email, email_status, email_deactivated_at)'
    )
    .eq('status', 'no_show')
    .eq('booking_date', yesterday)
    .is('event_booking_id', null)
    .is('no_show_follow_up_claimed_at', null)
    .order('booking_time', { ascending: true })
    .limit(NO_SHOW_FOLLOW_UP_MAX_PER_RUN)
  if (error) throw new Error(`Could not read yesterday's no-shows: ${error.message}`)

  const bookings = (data ?? []) as BookingRow[]
  result.considered = bookings.length
  const emailedCustomers = new Set<string>()

  for (const booking of bookings) {
    const customer = Array.isArray(booking.customer) ? booking.customer[0] ?? null : booking.customer
    if (!customer || !booking.customer_id) {
      skip('no_usable_email')
      continue
    }
    if (emailedCustomers.has(customer.id)) {
      skip('same_guest')
      continue
    }
    if (londonStartDate(booking) !== yesterday) {
      skip('not_yesterday')
      continue
    }

    // The address typed for this booking wins over the customer's, as every booking email reads it.
    const recipient = preferBookingContactEmail(customer, booking.contact_email)
    const to = recipient.email?.trim().toLowerCase() ?? ''
    const facts = {
      firstName: getSmartFirstName(customer.first_name),
      partySize: Number(booking.party_size),
      bookingDate: booking.booking_date,
      bookingTime: booking.booking_time ?? '',
    }

    try {
      if (!isEmailUsable(recipient) || (await isSuppressed(to))) {
        skip('no_usable_email')
        continue
      }
      if (noShowFollowUpProblem(facts)) {
        skip('missing_details')
        continue
      }

      // The claim: written before anything is sent, never released.
      const { data: claimed, error: claimError } = await db
        .from('table_bookings')
        .update({ no_show_follow_up_claimed_at: nowIso })
        .eq('id', booking.id)
        .eq('status', 'no_show')
        .is('no_show_follow_up_claimed_at', null)
        .select('id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) {
        skip('claimed_elsewhere')
        continue
      }
      emailedCustomers.add(customer.id)

      const expiresAt = new Date(now.getTime() + NO_SHOW_FOLLOW_UP_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const token = await createGuestToken(db, {
        customerId: customer.id,
        actionType: NO_SHOW_FOLLOW_UP_TOKEN_ACTION,
        tableBookingId: booking.id,
        expiresAt,
      })

      const email = buildNoShowFollowUpEmail({ ...facts, replyUrl: noShowFollowUpUrl(token.rawToken, deps.appBaseUrl) })

      const sent = await send({
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        commType: NO_SHOW_FOLLOW_UP_COMM_TYPE,
        customerId: customer.id,
        tableBookingId: booking.id,
        idempotencyKey: noShowFollowUpIdempotencyKey(booking.id),
        // The raw link token never reaches the email log.
        logRedactions: [token.rawToken],
        metadata: { table_booking_id: booking.id, template_key: NO_SHOW_FOLLOW_UP_COMM_TYPE, channel_policy: 'email_only' },
      })

      const outcome = sent.success ? 'sent' : sent.uncertain ? 'uncertain' : 'refused'
      if (outcome === 'sent') result.sent += 1
      else if (outcome === 'uncertain') result.uncertain += 1
      else result.refused += 1

      if (sent.success) {
        const { error: markError } = await db
          .from('table_bookings')
          .update({ no_show_follow_up_sent_at: nowIso })
          .eq('id', booking.id)
        if (markError) {
          // The claim stands, so nothing is sent again; only the send time is missing.
          result.errors += 1
          logger.error('No-show follow-up was sent but its send time could not be recorded', {
            error: new Error(describeError(markError)),
            metadata: { tableBookingId: booking.id },
          })
        }
      } else {
        logger.error('No-show follow-up email did not go; it will not be retried automatically', {
          error: new Error(sent.error ?? 'Email send failed'),
          metadata: {
            tableBookingId: booking.id,
            code: sent.code ?? null,
            providerStatus: sent.providerStatus ?? null,
            uncertain: sent.uncertain === true,
          },
        })
      }

      await AuditService.logAuditEvent({
        operation_type: sent.success ? 'table_booking.notification_sent' : 'table_booking.notification_failed',
        resource_type: 'table_booking',
        resource_id: booking.id,
        operation_status: sent.success ? 'success' : 'failure',
        error_message: sent.success ? undefined : sent.error ?? undefined,
        additional_info: {
          comm_type: NO_SHOW_FOLLOW_UP_COMM_TYPE,
          customer_id: customer.id,
          channel_policy: 'email_only',
          outcome,
          sent_channel: sent.success ? 'email' : null,
        },
      })
    } catch (bookingError) {
      result.errors += 1
      logger.error('No-show follow-up could not be processed for a booking', {
        error: bookingError instanceof Error ? bookingError : new Error(describeError(bookingError)),
        metadata: { tableBookingId: booking.id },
      })
    }
  }

  return result
}
