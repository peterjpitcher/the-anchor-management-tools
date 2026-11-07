'use server'

/**
 * Staff writes to a seasonal pre-order, from the booking detail page.
 *
 * Everything real happens in src/lib/table-bookings/preorder.ts, which is shared with the booker's
 * manage page so there is one completeness rule and one snapshotting rule. This file is the staff
 * gate around it: who is asking, whether they may, and whether the order is still open.
 *
 * LATE CHANGES (owner decision D21, BK-051). The form locks for guests and staff at the cutoff, noon
 * seven days out. After that a manager (table_bookings 'manage') may still record a choice, because
 * the escalation email tells them to ring the guest and take it over the telephone and it has to be
 * saved somewhere the kitchen reads. Every such save is audited with `late_change: true`, and the
 * sheet and the BOH totals mark it as changed after the cutoff.
 *
 * Every staff save goes through `savePreorderCover` as `{ savedBy: 'staff' }`, which passes the staff
 * override to the seat-course RPC, so a manager can also move a seat to 2 or 3 courses after the
 * cutoff (owner decision D8 of 6 November 2026: the organiser and guests cannot change choices after
 * it; staff can). The organiser's and guests' own pages refuse after the cutoff in their own routes.
 *
 * THE FOOD LINK. `sendPreorderFoodLink` emails the organiser their manage link, or texts it when they
 * have no usable email address, through the same email-first sender, channel rules and suppressions
 * as the pre-order reminder. `copyPreorderFoodLink` hands staff the link to paste. Manage tokens are
 * stored hashed, so an existing link can never be read back: both mint a fresh one, and any older
 * link the organiser holds keeps working until it expires.
 *
 * The three pre-order tables are service-role only under RLS, so the reads and writes go through
 * the admin client. Permission is proven first, on the cookie client, before that client is made.
 *
 * It sits beside the screen rather than in src/app/actions/ so the import path does not have to
 * cross the `[id]` route segment, which no other import in this codebase does.
 */

import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  getPreorderCompleteness,
  isPreorderEnabled,
  loadPreorderOrder,
  savePreorderCover,
  syncPreorderCovers,
  type PreorderCoverSyncResult,
  type PreorderSelectionInput,
} from '@/lib/table-bookings/preorder'
import { createTableManageToken } from '@/lib/table-bookings/manage-booking'
import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import {
  GUEST_CHANNEL_COLUMNS,
  notifyTableBookingGuestEmailFirst,
  type GuestChannelCustomer,
} from '@/lib/table-bookings/guest-notify'
import { preorderReminderFacts } from '@/lib/table-bookings/fallback-details'
import {
  buildPreorderFoodLinkEmail,
  buildPreorderFoodLinkText,
  type PreorderFoodLinkFacts,
} from '@/lib/table-bookings/preorder-food-link-messages'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { PreorderOrder, PreorderSeatCourseCount } from '@/types/preorders'
import { getPreorderCutoff } from './cutoff'

/** `message` carries something the screen should say out loud, such as which seats were dropped. */
type ActionResult = { success?: boolean; error?: string; message?: string }

export type StaffPreorderCoverInput = {
  coverId: string
  guestName?: string | null
  dietaryNote?: string | null
  /** Null is "not answered yet"; false clears the detail. Staff and kitchen only, never logged. */
  hasAllergies?: boolean | null
  allergyDetail?: string | null
  /** The seat's tier, 0 to 3. Only on a booking with a course list. Omit to leave it alone. */
  courseCount?: PreorderSeatCourseCount
  selections?: PreorderSelectionInput[]
  /** The complete set of add-ons this seat wants. Omit to leave them alone. */
  addonMenuItemIds?: string[]
}

const CLOSED_MESSAGE =
  'Pre-orders for this booking have closed. The kitchen has already ordered to these numbers, so a manager has to record any change now.'

/**
 * Prove the caller may edit this booking's pre-order, and hand back everything the write needs.
 *
 * Returns a plain `{ error }` rather than throwing, because every caller turns it straight into
 * the action's return value.
 */
async function openEditableOrder(tableBookingId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' } as const

  const canEdit = await checkUserPermission('table_bookings', 'edit', user.id)
  if (!canEdit) return { error: 'You do not have permission to edit table bookings.' } as const

  const admin = createAdminClient()

  const order = await loadPreorderOrder(admin, tableBookingId)
  if (!order) return { error: 'That booking no longer exists.' } as const
  // A Christmas party all on 1 course has no dishes to choose but a seat per guest for a name and a
  // dietary note (BK-148), so it may be saved too.
  if (!order.hasGuestSeats) {
    return { error: 'This booking is not on a seasonal menu, so there is nothing to pre-order.' } as const
  }

  if (!(await isPreorderEnabled(admin))) {
    return { error: 'Pre-orders are switched off at the moment. Take the order on paper.' } as const
  }

  const cutoff = getPreorderCutoff({
    bookingDate: order.bookingDate,
    preorderCutoffDays: order.preorderCutoffDays,
  })
  // After the cutoff only a manager may record a change, and it is marked as late.
  if (cutoff.closed) {
    const canManage = await checkUserPermission('table_bookings', 'manage', user.id)
    if (!canManage) return { error: CLOSED_MESSAGE } as const
  }

  return { user, admin, order, lateChange: cutoff.closed } as const
}

/**
 * Save one or more seats in a single go.
 *
 * Staff take a whole table's order in one telephone call, so the screen sends every seat it has
 * changed together: one gate, one audit entry, one refresh.
 */
export async function saveSeasonalPreorderCovers(
  tableBookingId: string,
  covers: StaffPreorderCoverInput[],
): Promise<ActionResult> {
  try {
    const gate = await openEditableOrder(tableBookingId)
    if ('error' in gate) return { error: gate.error }
    if (covers.length === 0) return { success: true }

    // A cover id is a client-supplied uuid, and the pre-order tables are keyed on the cover, not
    // the booking. Without this check a staff member with access to one booking could write a seat
    // belonging to another.
    const ordinalByCoverId = new Map(gate.order.covers.map((cover) => [cover.id, cover.ordinal]))
    if (covers.some((cover) => !ordinalByCoverId.has(cover.coverId))) {
      return { error: 'That seat is not on this booking. Refresh the page and try again.' }
    }
    // A tier only exists on a booking with a course list. An older booking keeps its main-only rule.
    if (!gate.order.courseCounts && covers.some((cover) => cover.courseCount !== undefined)) {
      return { error: 'This booking has no courses recorded, so the number of courses cannot be set here.' }
    }

    // One seat at a time, in seat order, so a refusal names the seat that failed and the seats before
    // it stay saved. The staff actor passes the staff override, so this works after the cutoff.
    for (const cover of covers) {
      await savePreorderCover(gate.admin, {
        coverId: cover.coverId,
        actor: { savedBy: 'staff' },
        tableBookingId,
        ...(cover.guestName !== undefined ? { guestName: cover.guestName } : {}),
        ...(cover.dietaryNote !== undefined ? { dietaryNote: cover.dietaryNote } : {}),
        ...(cover.hasAllergies !== undefined ? { hasAllergies: cover.hasAllergies } : {}),
        ...(cover.allergyDetail !== undefined ? { allergyDetail: cover.allergyDetail } : {}),
        ...(cover.courseCount !== undefined ? { courseCount: cover.courseCount } : {}),
        ...(cover.selections !== undefined ? { selections: cover.selections } : {}),
        ...(cover.addonMenuItemIds !== undefined ? { addonMenuItemIds: cover.addonMenuItemIds } : {}),
      })
    }

    await logAuditEvent({
      user_id: gate.user.id,
      user_email: gate.user.email ?? undefined,
      operation_type: 'update',
      resource_type: 'table_booking_preorder',
      resource_id: tableBookingId,
      operation_status: 'success',
      // Seat numbers only. A dietary note can amount to health information and must never reach
      // the audit log, an email or a manager digest (spec section 8).
      additional_info: {
        booking_reference: gate.order.bookingReference,
        seats_saved: covers.map((cover) => ordinalByCoverId.get(cover.coverId)).filter(Boolean),
        // Which seats changed tier, as seat numbers only.
        ...(covers.some((cover) => cover.courseCount !== undefined)
          ? {
              seats_course_changed: covers
                .filter((cover) => cover.courseCount !== undefined)
                .map((cover) => ordinalByCoverId.get(cover.coverId))
                .filter(Boolean),
            }
          : {}),
        // A manager recording a choice after the cutoff (D21). The kitchen has already ordered.
        ...(gate.lateChange ? { late_change: true } : {}),
      },
    })

    revalidatePath(`/table-bookings/${tableBookingId}`)
    return { success: true }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not save the pre-order.',
    }
  }
}

/**
 * Bring the seat rows in line with the party size.
 *
 * Used to start a pre-order that has no seats yet, and to repair a booking whose party size moved
 * before every amendment path learned to call the sync. Removing drops the highest seat numbers,
 * so the caller is told which choices went with them.
 */
export async function syncSeasonalPreorderCovers(tableBookingId: string): Promise<ActionResult> {
  try {
    const gate = await openEditableOrder(tableBookingId)
    if ('error' in gate) return { error: gate.error }

    const result = await syncPreorderCovers(gate.admin, tableBookingId)

    await logAuditEvent({
      user_id: gate.user.id,
      user_email: gate.user.email ?? undefined,
      operation_type: 'update',
      resource_type: 'table_booking_preorder',
      resource_id: tableBookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: gate.order.bookingReference,
        party_size: result.partySize,
        cover_count: result.coverCount,
        seats_added: result.added,
        seats_removed: result.removed.map((cover) => cover.ordinal),
        ...(gate.lateChange ? { late_change: true } : {}),
      },
    })

    revalidatePath(`/table-bookings/${tableBookingId}`)
    return { success: true, message: describeSyncResult(result) }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not set up the pre-order seats.',
    }
  }
}

/**
 * What just happened, in a sentence staff can read out. Dropped choices are named because the
 * guest paid attention to them and will ask.
 */
function describeSyncResult(result: PreorderCoverSyncResult): string {
  const parts: string[] = []
  if (result.added > 0) parts.push(`${result.added} seat${result.added === 1 ? '' : 's'} added`)

  for (const cover of result.removed) {
    const dishes = cover.courses.map((entry) => entry.itemName).join(', ')
    parts.push(`seat ${cover.ordinal} removed${dishes ? ` (was having ${dishes})` : ''}`)
  }

  if (parts.length === 0) return 'The seats already matched the party size.'
  return `${parts.join(', ')}.`
}

// ---------------------------------------------------------------------------
// The organiser's food link
// ---------------------------------------------------------------------------

/** What `sendPreorderFoodLink` tells the screen: the channel that reached the organiser. */
export type SendPreorderFoodLinkResult = ActionResult & { channel?: 'email' | 'sms' }

/** What `copyPreorderFoodLink` hands the screen: a freshly minted link to paste. */
export type CopyPreorderFoodLinkResult = ActionResult & { url?: string }

/**
 * The pre-order reminder's template key, deliberately. Every message sent through
 * notifyTableBookingGuestEmailFirst must have a bounce fallback renderer (delayed-fallback/renderers.ts),
 * and the reminder's is the one that rebuilds "choose your food" with the organiser's manage link.
 * The SMS duplicate guard is kept apart from the cron's reminder by the `stage` below.
 */
const FOOD_LINK_TEMPLATE_KEY = 'table_booking_preorder_reminder'

type FoodLinkBooking = {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  status: string | null
  customer_id: string | null
}

/**
 * Prove the caller may send this booking's food link and load what the link needs. The same
 * permission as editing the seats, since the link lets the organiser edit them.
 */
async function openFoodLinkBooking(tableBookingId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' } as const

  const canEdit = await checkUserPermission('table_bookings', 'edit', user.id)
  if (!canEdit) return { error: 'You do not have permission to edit table bookings.' } as const

  const admin = createAdminClient()

  const order = await loadPreorderOrder(admin, tableBookingId)
  if (!order) return { error: 'That booking no longer exists.' } as const
  if (!order.hasGuestSeats) {
    return { error: 'This booking is not on a seasonal menu, so it has no food link.' } as const
  }
  if (!(await isPreorderEnabled(admin))) {
    return { error: 'Food choices are switched off at the moment, so the link would not show the food page.' } as const
  }

  const { data, error } = await admin
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, start_datetime, party_size, status, customer_id')
    .eq('id', tableBookingId)
    .maybeSingle()
  if (error) throw error
  const booking = data as FoodLinkBooking | null
  if (!booking) return { error: 'That booking no longer exists.' } as const

  // The food link is for a booking that is going ahead. A deposit still owed is the conversation to
  // have first, and the organiser is sent their food link when it is paid (owner decision D3).
  if (booking.status === 'pending_payment') {
    return { error: 'The deposit has not been paid yet. The organiser gets their food link once it is.' } as const
  }
  if (booking.status !== 'confirmed') {
    return { error: 'This booking is not confirmed, so there is no food to choose.' } as const
  }
  if (!booking.customer_id) {
    return { error: 'This booking has no organiser on file to send the link to.' } as const
  }

  const cutoff = getPreorderCutoff({ bookingDate: order.bookingDate, preorderCutoffDays: order.preorderCutoffDays })

  return { user, admin, order, booking, customerId: booking.customer_id, cutoff } as const
}

/** A fresh manage link for the organiser, shortened when it can be. */
async function mintFoodLink(
  admin: ReturnType<typeof createAdminClient>,
  booking: FoodLinkBooking,
  customerId: string,
) {
  const token = await createTableManageToken(admin, {
    customerId,
    tableBookingId: booking.id,
    // The link lives until 48 hours after the sitting, the same as every other manage link.
    bookingStartIso: booking.start_datetime,
  })
  return buildGuestShortLink({
    longUrl: token.url,
    linkKind: 'table_manage',
    customerId,
    tableBookingId: booking.id,
  })
}

function describeClosedAt(closesAt: Date | null): string {
  return closesAt
    ? `Choices closed at noon on ${formatDateInLondon(closesAt, { weekday: 'long', day: 'numeric', month: 'long' })}`
    : 'Choices have closed'
}

/** Seat numbers only: what staff did, never the organiser's address or number. */
async function auditFoodLink(
  gate: { user: { id: string; email?: string | null }; booking: FoodLinkBooking },
  operation: 'table_booking.food_link_sent' | 'table_booking.food_link_copied',
  status: 'success' | 'failure',
  info: Record<string, unknown>,
  errorMessage?: string,
) {
  await logAuditEvent({
    user_id: gate.user.id,
    user_email: gate.user.email ?? undefined,
    operation_type: operation,
    resource_type: 'table_booking',
    resource_id: gate.booking.id,
    operation_status: status,
    ...(errorMessage ? { error_message: errorMessage } : {}),
    additional_info: { booking_reference: gate.booking.booking_reference, ...info },
  })
}

function foodLinkFacts(order: PreorderOrder, booking: FoodLinkBooking, firstName: string, link: string, closesAt: Date | null): PreorderFoodLinkFacts {
  return {
    firstName,
    bookingReference: booking.booking_reference,
    bookingDate: order.bookingDate,
    bookingTime: booking.booking_time,
    partySize: booking.party_size,
    link,
    closesAtIso: closesAt ? closesAt.toISOString() : null,
  }
}

/**
 * Email the organiser their food link, or text it when they have no usable email address.
 *
 * Staff confirm before this runs. It goes through `notifyTableBookingGuestEmailFirst`, so the email
 * health checks, SMS opt-outs, suppressions and the delivery audit row are exactly the reminder's.
 * Refused after the cutoff, because the organiser can no longer change anything: staff edit the
 * seats themselves then.
 */
export async function sendPreorderFoodLink(tableBookingId: string): Promise<SendPreorderFoodLinkResult> {
  try {
    const gate = await openFoodLinkBooking(tableBookingId)
    if ('error' in gate) return { error: gate.error }

    if (gate.cutoff.closed) {
      return {
        error: `${describeClosedAt(gate.cutoff.closesAt)}, so the organiser can no longer change them. Edit the seats here instead.`,
      }
    }

    const { data: customerRow, error: customerError } = await gate.admin
      .from('customers')
      .select(GUEST_CHANNEL_COLUMNS)
      .eq('id', gate.customerId)
      .maybeSingle()
    if (customerError) throw customerError
    if (!customerRow) return { error: 'The organiser could not be found on this booking.' }
    const customer = customerRow as unknown as GuestChannelCustomer

    const link = await mintFoodLink(gate.admin, gate.booking, gate.customerId)
    const facts = foodLinkFacts(
      gate.order,
      gate.booking,
      getSmartFirstName(customer.first_name),
      link.url,
      gate.cutoff.closesAt,
    )
    // One minute's bucket: a double press is one message, a deliberate resend later is a new one.
    const sendBucket = Math.floor(Date.now() / 60_000)

    const outcome = await notifyTableBookingGuestEmailFirst({
      supabase: gate.admin,
      templateKey: FOOD_LINK_TEMPLATE_KEY,
      tableBookingId: gate.booking.id,
      customer,
      email: buildPreorderFoodLinkEmail(facts),
      sms: {
        body: buildPreorderFoodLinkText(facts),
        // `stage` is part of the SMS duplicate guard's key, so this is not mistaken for the cron's
        // reminder to the same booking, and a resend a minute later is allowed.
        metadata: { stage: `staff_food_link:${sendBucket}` },
      },
      idempotencyKey: `table_booking_food_link:${gate.booking.id}:${sendBucket}`,
      auditContext: {
        booking_reference: gate.booking.booking_reference,
        trigger: 'staff_food_link',
        short_link_fallback: !link.shortened,
      },
      fallback: {
        message: 'preorder_reminder',
        facts: preorderReminderFacts({
          bookingDate: gate.order.bookingDate,
          bookingTime: gate.booking.booking_time,
          choicesOutstanding: !getPreorderCompleteness(gate.order).complete,
        }),
        link: link.shortened ? 'short_link' : 'full_url',
      },
    })

    if (outcome.status === 'sent' || outcome.status === 'already_sent') {
      const channel = outcome.channel === 'sms' ? 'sms' : 'email'
      await auditFoodLink(gate, 'table_booking.food_link_sent', 'success', { channel, outcome: outcome.status })
      revalidatePath(`/table-bookings/${tableBookingId}`)
      return {
        success: true,
        channel,
        message:
          channel === 'sms'
            ? 'Food link texted to the organiser.'
            : 'Food link emailed to the organiser.',
      }
    }

    await auditFoodLink(
      gate,
      'table_booking.food_link_sent',
      'failure',
      { outcome: outcome.status },
      outcome.error ?? undefined,
    )
    return {
      error:
        outcome.status === 'no_channel'
          ? 'The food link was not sent: the organiser has no email address or mobile number we can use. Copy the link and send it another way, or ring them.'
          : 'The food link did not send. Try again in a minute, or copy the link and send it another way.',
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not send the food link.' }
  }
}

/**
 * A fresh food link for staff to copy and paste. Tokens are stored hashed, so the organiser's
 * existing link cannot be read back; this mints a new one, and the old one keeps working.
 */
export async function copyPreorderFoodLink(tableBookingId: string): Promise<CopyPreorderFoodLinkResult> {
  try {
    const gate = await openFoodLinkBooking(tableBookingId)
    if ('error' in gate) return { error: gate.error }

    const link = await mintFoodLink(gate.admin, gate.booking, gate.customerId)
    await auditFoodLink(gate, 'table_booking.food_link_copied', 'success', {
      short_link_fallback: !link.shortened,
      after_cutoff: gate.cutoff.closed,
    })

    return {
      success: true,
      url: link.url,
      message: gate.cutoff.closed
        ? `New link made and copied. ${describeClosedAt(gate.cutoff.closesAt)}, so it opens read-only.`
        : 'New link made and copied. Any link the organiser already has still works.',
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not make a food link.' }
  }
}
