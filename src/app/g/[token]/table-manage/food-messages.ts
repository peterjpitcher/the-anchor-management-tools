/**
 * The two emails the organiser's food page sends when asked: a guest's own link (D5) and the
 * organiser's copy of the choices so far.
 *
 * Both fail closed. A send that does not go through is returned as words the organiser sees, with
 * the phone number, and logged as an error; nothing is recorded as sent unless it was. A guest's
 * link is sent before anything is written, so the organiser's page never says "Waiting for Sam"
 * about an email Sam never got.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAppUrl } from '@/lib/env'
import { sendEmail } from '@/lib/email/emailService'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { logger } from '@/lib/logger'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { isEmailUsable } from '@/lib/notifications/channel'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { buildTableBookingPreorderChoicesEmail } from '@/lib/table-bookings/guest-emails'
import { getPreorderCompleteness, getPreorderCutoff } from '@/lib/table-bookings/preorder'
import { toChoicesCopySeats } from '@/lib/table-bookings/preorder-cutoff-digest'
import { buildPreorderGuestInviteEmail } from '@/lib/table-bookings/preorder-food-link-emails'
import { createPreorderGuestToken } from '@/lib/table-bookings/preorder-guest-token'
import { PREORDER_ADDON_GUEST_NOTE, PREORDER_INVITE_EMAIL_MAX_LENGTH, type PreorderCover, type PreorderOrder } from '@/types/preorders'
import { canResendInvite, type FoodInviteLedger } from './food-data'

type Db = SupabaseClient<any, 'public', any>

/** The organiser's typed address, checked the same way the rest of the app checks one. */
export const InviteEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(PREORDER_INVITE_EMAIL_MAX_LENGTH)
  .email()

const SEND_FAILED = `We couldn't send that email just now, so nothing has changed. Please try again in a few minutes, or call us on ${GUEST_CONTACT.phoneDisplay}.`

export type FoodMessageResult = { ok: true } | { ok: false; error: string }

type BookingFacts = {
  customer_id: string | null
  booking_time: string | null
  start_datetime: string | null
}

async function loadBookingFacts(supabase: Db, tableBookingId: string): Promise<BookingFacts | null> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select('customer_id, booking_time, start_datetime')
    .eq('id', tableBookingId)
    .maybeSingle()
  if (error) throw error
  return (data as BookingFacts | null) ?? null
}

async function loadOrganiser(
  supabase: Db,
  customerId: string,
): Promise<{ id: string; first_name: string | null; email: string | null; email_status: string | null; email_deactivated_at: string | null } | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, email, email_status, email_deactivated_at')
    .eq('id', customerId)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

/**
 * Send one guest their own link to choose (D5). The link is scoped to their seat and stops working
 * at the cutoff. Once sent, the seat records the address and the time, and the first send writes a
 * `guest_invite` ledger row. The organiser may resend once per line.
 */
export async function sendFoodGuestInvite(
  supabase: Db,
  input: { order: PreorderOrder; cover: PreorderCover; email: string; ledger: FoodInviteLedger; now?: Date },
): Promise<FoodMessageResult> {
  const { order, cover } = input
  const now = input.now ?? new Date()

  const parsed = InviteEmailSchema.safeParse(input.email)
  if (!parsed.success) return { ok: false, error: "That email address doesn't look right. Check it and try again." }
  const email = parsed.data

  const cutoff = getPreorderCutoff({ bookingDate: order.bookingDate, preorderCutoffDays: order.preorderCutoffDays, now })
  // A guest link must stop at the cutoff, so a booking with no cutoff cannot have one.
  if (!cutoff.closesAt || cutoff.closed) {
    return { ok: false, error: `Choices have closed for this booking. Call us on ${GUEST_CONTACT.phoneDisplay} if something needs to change.` }
  }

  const firstInvite = !input.ledger.has(cover.id) && !cover.inviteSentAt
  if (!firstInvite && !canResendInvite(cover, input.ledger)) {
    return {
      ok: false,
      error: `You've already resent this guest's link. You can still fill in their choices yourself, or call us on ${GUEST_CONTACT.phoneDisplay}.`,
    }
  }

  try {
    const booking = await loadBookingFacts(supabase, order.tableBookingId)
    if (!booking?.customer_id) return { ok: false, error: SEND_FAILED }
    const organiser = await loadOrganiser(supabase, booking.customer_id)

    const token = await createPreorderGuestToken(supabase, {
      customerId: booking.customer_id,
      tableBookingId: order.tableBookingId,
      coverId: cover.id,
      expiresAt: cutoff.closesAt.toISOString(),
      appBaseUrl: getAppUrl(),
    })

    const message = buildPreorderGuestInviteEmail({
      guestName: cover.guestName,
      organiserFirstName: getSmartFirstName(organiser?.first_name),
      bookingDate: order.bookingDate,
      bookingTime: order.bookingTime ?? booking.booking_time,
      startDateTime: booking.start_datetime,
      closesAt: cutoff.closesAt,
      url: token.url,
    })

    const result = await sendEmail({
      to: email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // The guest is not the booking's customer, so the message is filed against the booking only.
      customerId: null,
      tableBookingId: order.tableBookingId,
      commType: 'table_booking_preorder_guest_invite',
      // The link is the guest's key to their seat; the stored copy of the email must not carry it.
      logRedactions: [token.rawToken],
    })
    if (!result.success) {
      logger.error('Christmas food link invite was not sent', {
        error: new Error(result.error || 'Email not sent'),
        metadata: { tableBookingId: order.tableBookingId, ordinal: cover.ordinal },
      })
      return { ok: false, error: SEND_FAILED }
    }
  } catch (error) {
    logger.error('Christmas food link invite failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: order.tableBookingId, ordinal: cover.ordinal },
    })
    return { ok: false, error: SEND_FAILED }
  }

  // The email has gone. A failure to record it is ours to fix, so it is logged as an error, and the
  // organiser is still told it went, because it did.
  const sentAt = now.toISOString()
  const { error: coverError } = await supabase
    .from('booking_preorder_covers')
    .update({ invite_email: email, invite_sent_at: sentAt })
    .eq('id', cover.id)
  if (coverError) {
    logger.error('Christmas food link invite sent but not recorded on the seat', {
      error: new Error(coverError.message),
      metadata: { tableBookingId: order.tableBookingId, ordinal: cover.ordinal },
    })
  }
  if (firstInvite || !input.ledger.has(cover.id)) {
    const { error: ledgerError } = await supabase
      .from('booking_preorder_reminders')
      .insert({ table_booking_id: order.tableBookingId, kind: 'guest_invite', cover_id: cover.id, sent_at: sentAt })
    if (ledgerError && ledgerError.code !== '23505') {
      logger.error('Christmas food link invite sent but not written to the ledger', {
        error: new Error(ledgerError.message),
        metadata: { tableBookingId: order.tableBookingId, ordinal: cover.ordinal },
      })
    }
  }
  return { ok: true }
}

/**
 * The organiser's copy of the choices so far, on request. Respects `table_preorder_choices_copy`,
 * the switch for this email, and the organiser's own email state.
 */
export async function sendFoodChoicesCopy(
  supabase: Db,
  input: { order: PreorderOrder },
): Promise<FoodMessageResult> {
  const { order } = input
  try {
    if (!(await isMessagingFlagOn('table_preorder_choices_copy'))) {
      return { ok: false, error: `We can't email a copy just now. Your choices are saved on this page, or call us on ${GUEST_CONTACT.phoneDisplay}.` }
    }
    const booking = await loadBookingFacts(supabase, order.tableBookingId)
    const organiser = booking?.customer_id ? await loadOrganiser(supabase, booking.customer_id) : null
    if (!organiser || !isEmailUsable(organiser)) {
      return {
        ok: false,
        error: `We don't have a working email address for you. Call us on ${GUEST_CONTACT.phoneDisplay} and we'll update it.`,
      }
    }

    const message = buildTableBookingPreorderChoicesEmail({
      firstName: getSmartFirstName(organiser.first_name),
      bookingReference: order.bookingReference,
      bookingDate: order.bookingDate,
      bookingTime: order.bookingTime,
      startDateTime: booking?.start_datetime ?? null,
      partySize: order.partySize,
      periodName: order.periodName,
      seats: toChoicesCopySeats(order),
      complete: getPreorderCompleteness(order).complete,
      addonNote: PREORDER_ADDON_GUEST_NOTE,
    })

    const result = await sendEmail({
      to: organiser.email as string,
      subject: message.subject,
      html: message.html,
      text: message.text,
      customerId: organiser.id,
      tableBookingId: order.tableBookingId,
      commType: 'table_booking_preorder_copy',
    })
    if (!result.success) {
      logger.error('Christmas food choices copy was not sent', {
        error: new Error(result.error || 'Email not sent'),
        metadata: { tableBookingId: order.tableBookingId },
      })
      return { ok: false, error: SEND_FAILED }
    }
    return { ok: true }
  } catch (error) {
    logger.error('Christmas food choices copy failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: order.tableBookingId },
    })
    return { ok: false, error: SEND_FAILED }
  }
}
