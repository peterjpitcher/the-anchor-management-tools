import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { hashGuestToken } from '@/lib/guest/tokens'
import { AuditService } from '@/services/audit'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { checkNoShowCanComeBack } from '@/lib/table-bookings/reinstate-check'
import { buildNoShowAttendedPlan } from '@/lib/table-bookings/staff-status-actions'
import { formatBookingMomentForEmail } from '@/lib/table-bookings/guest-emails'
import { formatNoShowReason } from '@/lib/table-bookings/no-show-reasons'

/**
 * A guest's reply to the morning-after no-show email (owner decisions of 22 November 2026): the
 * link lookup, and the two answers. Split from the page and the route because both read the link,
 * and a difference between the two reads is how a guest answers something the page did not offer.
 *
 * "I did come in": we assume the mistake was ours. The no-show is undone and the visit stamped at
 * the booking's own time, after the same check a staff undo runs (the table was not given to
 * someone else, the deposit has not been refunded). When that check or the write refuses, the
 * guest's word is still kept on the booking and the manager is asked to put it right by hand, so
 * the guest is never told "no". Either way the manager gets a short note.
 *
 * "I couldn't make it": an optional reason, never required, kept on the booking for staff. Nothing
 * else changes and nothing more is sent.
 *
 * One answer per booking: the first one stands.
 */

// `any` as in src/lib/foh/bookings.ts: the admin client is untyped where it is passed around.
type Db = SupabaseClient<any, 'public', any>

export type NoShowReplyBooking = {
  id: string
  customerId: string | null
  bookingReference: string | null
  bookingDate: string
  bookingTime: string
  startDatetime: string | null
  endDatetime: string | null
  partySize: number | null
  committedPartySize: number | null
  status: string
  paymentStatus: string | null
  depositWaived: boolean | null
  bookingType: string | null
  response: string | null
  customerFirstName: string | null
}

export type NoShowReplyLookup = { ok: true; booking: NoShowReplyBooking } | { ok: false }

/**
 * Resolve a raw link to its booking. A bad link, an expired one and a missing booking all answer
 * the same way, so the page never reveals whether a link existed.
 */
export async function lookupNoShowFollowUpToken(supabase: Db, rawToken: string, now: Date = new Date()): Promise<NoShowReplyLookup> {
  const { data: guestToken, error } = await supabase
    .from('guest_tokens')
    .select('id, table_booking_id, expires_at')
    .eq('hashed_token', hashGuestToken(rawToken))
    .eq('action_type', 'no_show_follow_up')
    .maybeSingle()
  if (error || !guestToken?.table_booking_id) return { ok: false }
  if (!guestToken.expires_at || Date.parse(guestToken.expires_at) <= now.getTime()) return { ok: false }

  const { data: booking } = await supabase
    .from('table_bookings')
    .select(
      'id, customer_id, booking_reference, booking_date, booking_time, start_datetime, end_datetime, party_size, committed_party_size, status, payment_status, deposit_waived, booking_type, no_show_guest_response, customer:customers!table_bookings_customer_id_fkey(first_name)'
    )
    .eq('id', guestToken.table_booking_id)
    .maybeSingle()
  if (!booking) return { ok: false }

  const embedded = booking.customer as unknown
  const customer = (Array.isArray(embedded) ? embedded[0] : embedded) as { first_name: string | null } | null | undefined

  return {
    ok: true,
    booking: {
      id: booking.id as string,
      customerId: (booking.customer_id as string | null) ?? null,
      bookingReference: (booking.booking_reference as string | null) ?? null,
      bookingDate: booking.booking_date as string,
      bookingTime: booking.booking_time as string,
      startDatetime: (booking.start_datetime as string | null) ?? null,
      endDatetime: (booking.end_datetime as string | null) ?? null,
      partySize: (booking.party_size as number | null) ?? null,
      committedPartySize: (booking.committed_party_size as number | null) ?? null,
      status: booking.status as string,
      paymentStatus: (booking.payment_status as string | null) ?? null,
      depositWaived: (booking.deposit_waived as boolean | null) ?? null,
      bookingType: (booking.booking_type as string | null) ?? null,
      response: (booking.no_show_guest_response as string | null) ?? null,
      customerFirstName: customer?.first_name ?? null,
    },
  }
}

export type NoShowReplyOutcome =
  /** Saved. `putRight` is true when the booking itself was changed back to attended. */
  | { state: 'recorded'; putRight: boolean }
  | { state: 'already_answered' }
  /** Staff have already changed the booking, so there is nothing to answer. */
  | { state: 'not_no_show' }
  | { state: 'failed' }

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(error)
}

async function audit(bookingId: string, info: Record<string, unknown>): Promise<void> {
  // No user: the guest did this from their link.
  await AuditService.logAuditEvent({
    operation_type: 'table_booking.no_show_guest_reply',
    resource_type: 'table_booking',
    resource_id: bookingId,
    operation_status: 'success',
    additional_info: { source: 'no_show_follow_up_email', ...info },
  })
}

export async function recordGuestAttended(supabase: Db, booking: NoShowReplyBooking, now: Date = new Date()): Promise<NoShowReplyOutcome> {
  if (booking.response) return { state: 'already_answered' }
  if (booking.status !== 'no_show') return { state: 'not_no_show' }
  const nowIso = now.toISOString()

  // The check a staff undo runs: the table was not given away and the deposit not refunded.
  let notPutRightBecause: string | null = null
  try {
    notPutRightBecause = await checkNoShowCanComeBack(supabase, {
      id: booking.id,
      status: booking.status,
      payment_status: booking.paymentStatus,
      deposit_waived: booking.depositWaived,
      party_size: booking.partySize,
      committed_party_size: booking.committedPartySize,
      booking_type: booking.bookingType,
    })
  } catch (checkError) {
    notPutRightBecause = 'The booking could not be checked automatically.'
    logger.error('Could not check a no-show before putting it right for a guest', {
      error: checkError instanceof Error ? checkError : new Error(describeError(checkError)),
      metadata: { tableBookingId: booking.id },
    })
  }

  let putRight = false
  if (!notPutRightBecause) {
    const transition = buildNoShowAttendedPlan({
      booking: {
        status: booking.status,
        booking_date: booking.bookingDate,
        booking_time: booking.bookingTime,
        start_datetime: booking.startDatetime,
        end_datetime: booking.endDatetime,
      },
      nowIso,
    })
    if (!transition.ok) {
      notPutRightBecause = transition.error
    } else {
      const { data, error } = await supabase
        .from('table_bookings')
        .update({
          ...transition.plan.update,
          no_show_guest_response: 'attended',
          no_show_guest_responded_at: nowIso,
        })
        .eq('id', booking.id)
        .eq('status', 'no_show')
        .is('no_show_guest_response', null)
        .select('id')
        .maybeSingle()
      if (error) {
        // A database rule refused the change (the table no longer fits the party, say). The
        // guest's word is still kept below and a person finishes it.
        notPutRightBecause = 'The booking could not be changed automatically.'
        logger.error('A no-show could not be put right from the guest link', {
          error: new Error(describeError(error)),
          metadata: { tableBookingId: booking.id, code: (error as { code?: string }).code ?? null },
        })
      } else if (!data) {
        return { state: 'already_answered' }
      } else {
        putRight = true
      }
    }
  }

  if (!putRight) {
    const { data, error } = await supabase
      .from('table_bookings')
      .update({ no_show_guest_response: 'attended', no_show_guest_responded_at: nowIso })
      .eq('id', booking.id)
      .is('no_show_guest_response', null)
      .select('id')
      .maybeSingle()
    if (error) {
      logger.error('A guest said they did come in and it could not be saved', {
        error: new Error(describeError(error)),
        metadata: { tableBookingId: booking.id },
      })
      return { state: 'failed' }
    }
    if (!data) return { state: 'already_answered' }
  }

  await audit(booking.id, {
    reply: 'attended',
    put_right: putRight,
    status_from: 'no_show',
    status_to: putRight ? 'confirmed' : 'no_show',
    ...(notPutRightBecause ? { not_put_right_because: notPutRightBecause } : {}),
  })

  // The manager's note. Ids and booking facts only, never the guest's name or address.
  await alertMoneyNeedsAPerson(supabase, {
    domain: 'table_bookings',
    bookingId: booking.id,
    kind: 'no_show_guest_says_attended',
    subjectTag: putRight ? 'GUEST REPLY' : 'BOOKING ACTION NEEDED',
    title: 'A guest marked as a no-show says they did come in',
    summary: putRight
      ? 'They replied to the morning-after email. The booking has been put back to attended at its booked time, and the no-show has come off their record. Nothing to do unless this looks wrong.'
      : `They replied to the morning-after email. The booking has NOT been changed: ${notPutRightBecause} Please check it and put it right from the booking.`,
    context: {
      Reference: booking.bookingReference,
      'Booked for': formatBookingMomentForEmail(booking.bookingDate, booking.bookingTime, booking.startDatetime),
      'Party size': booking.partySize,
    },
  })

  return { state: 'recorded', putRight }
}

export async function recordGuestCouldNotMakeIt(
  supabase: Db,
  booking: NoShowReplyBooking,
  answer: { code: unknown; detail: unknown },
  now: Date = new Date()
): Promise<NoShowReplyOutcome> {
  if (booking.response) return { state: 'already_answered' }
  if (booking.status !== 'no_show') return { state: 'not_no_show' }

  const reason = formatNoShowReason(answer.code, answer.detail)
  const { data, error } = await supabase
    .from('table_bookings')
    .update({
      no_show_guest_response: 'could_not_make_it',
      no_show_guest_reason: reason,
      no_show_guest_responded_at: now.toISOString(),
    })
    .eq('id', booking.id)
    .eq('status', 'no_show')
    .is('no_show_guest_response', null)
    .select('id')
    .maybeSingle()
  if (error) {
    logger.error('A no-show reason could not be saved', {
      error: new Error(describeError(error)),
      metadata: { tableBookingId: booking.id },
    })
    return { state: 'failed' }
  }
  if (!data) return { state: 'already_answered' }

  // The code only: the guest's own words stay on the booking, out of the audit log.
  await audit(booking.id, { reply: 'could_not_make_it', reason_code: reason ? reason.split(':')[0] : null })
  return { state: 'recorded', putRight: false }
}
