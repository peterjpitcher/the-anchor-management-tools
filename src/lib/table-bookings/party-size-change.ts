import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppUrl } from '@/lib/env'
import { logAuditEvent } from '@/app/actions/audit'
import { CHRISTMAS_MAX_PARTY_SIZE, CHRISTMAS_MIN_PARTY_SIZE } from '@/lib/table-bookings/christmas'
import { requireBohTableBookingPermission, requireFohPermission, tableBookingsManagerCheck } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import {
  PartySizeUpdateFailedAfterMoveError,
  ChristmasCourseValidationError,
  mapSeatUpdateBlockedReason,
  updateTableBookingPartySizeWithLinkedEventSeats
} from '@/lib/events/staff-seat-updates'
import {
  applyPartySizeDepositTransition,
  PARTY_SIZE_DEPOSIT_COLUMNS,
  type PartySizeDepositTransitionResult
} from '@/lib/table-bookings/staff-deposit-transitions'
import {
  syncPreorderCovers,
  type PreorderRemovedCover
} from '@/lib/table-bookings/preorder'
import { sendTableBookingRescheduledNotificationIfAllowed } from '@/lib/table-bookings/bookings'
import type { GuestNotificationOutcome } from '@/lib/table-bookings/guest-notification-outcome'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { PARTY_SIZE_INPUT_CEILING, readTableBookingPartyLimit, staffPartyLimitMessage } from '@/lib/table-bookings/party-limit'

/**
 * A staff party-size change, for both staff screens (BK-129, customer bookings review of
 * 24 October 2026).
 *
 * The FOH iPad (api/foh/bookings/[id]/party-size) and the BOH booking page
 * (api/boh/table-bookings/[id]/party-size) each carried a copy of this route and had already
 * drifted: only BOH honoured a staff-picked larger table and answered with the deposit request it
 * made, and the FOH copy forgot committed_party_size on an unchanged size. Both routes now call this,
 * and differ only in who may use them and the name they put on logs and the audit row.
 */

export type PartySizeChangeSurface = 'foh' | 'boh'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UpdatePartySizeSchema = z.object({
  christmas_course_counts: z.array(z.number().int().min(1).max(3)).min(CHRISTMAS_MIN_PARTY_SIZE).max(CHRISTMAS_MAX_PARTY_SIZE).optional(),
  // The Christmas guests who are leaving, by their seat number now, so their own dishes go (BK-054).
  removed_seats: z.array(z.number().int().min(1).max(CHRISTMAS_MAX_PARTY_SIZE)).max(CHRISTMAS_MAX_PARTY_SIZE - 1).optional(),
  // The course list the dialog showed, so a change made against guests that have since changed is refused.
  expected_course_counts: z.array(z.number().int().min(1).max(3)).max(CHRISTMAS_MAX_PARTY_SIZE).nullable().optional(),
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(PARTY_SIZE_INPUT_CEILING)
  ),
  send_sms: z.boolean().optional().default(true),
  // Optional staff-picked larger table setup for the single-step grow+move:
  // honoured when still available, otherwise the server auto-picks as before.
  move_table_ids: z.array(z.string().uuid()).min(1).max(4).optional()
})

export async function changeTableBookingPartySize(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  surface: PartySizeChangeSurface
): Promise<NextResponse> {
  const label = surface.toUpperCase()
  const auth = surface === 'foh'
    ? await requireFohPermission('edit')
    : await requireBohTableBookingPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdatePartySizeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid party size',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const newPartySize = parsed.data.party_size
  // One party limit everywhere (D30, BK-146), read from the setting the booking functions use.
  const partyLimit = await readTableBookingPartyLimit(auth.supabase)
  if (newPartySize > partyLimit) {
    return NextResponse.json({ error: staffPartyLimitMessage(partyLimit) }, { status: 400 })
  }
  const appBaseUrl = getAppUrl()

  // Read current booking state before the update so we can detect threshold crossings
  const { data: currentBooking, error: fetchError } = await auth.supabase.from('table_bookings')
    // The deposit transition's columns, read BEFORE the change: its status and payment state decide
    // whether the deposit follows the new size or is flagged (D20). booking_period_answer, not the
    // period id, says whether a seasonal offer was taken (BK-042).
    .select(`committed_party_size, booking_reference, updated_at, ${PARTY_SIZE_DEPOSIT_COLUMNS}`)
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !currentBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const previousPartySize = Math.max(1, Number(currentBooking.party_size || 1))
  try {
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(auth.supabase, {
      tableBookingId: id,
      partySize: newPartySize,
      christmasCourseCounts: parsed.data.christmas_course_counts,
      christmasRemovedSeats: parsed.data.removed_seats,
      christmasExpectedCourses: parsed.data.expected_course_counts,
      // After the Christmas pre-order deadline only a manager may change the numbers (D21).
      canMakeLateChristmasChange: tableBookingsManagerCheck(auth),
      actor: surface,
      sendSms: parsed.data.send_sms,
      appBaseUrl,
      autoMoveTable: true,
      preferredTableIds: parsed.data.move_table_ids
    })

    if (result.state === 'blocked') {
      return NextResponse.json(
        {
          error: mapSeatUpdateBlockedReason(result.reason),
          reason: result.reason || null
        },
        { status: 409 }
      )
    }

    // Verify from the row returned by the update itself: a re-read here was
    // a TOCTOU false negative under concurrent edits. On 'unchanged' there is
    // no updated row, so fall back to the pre-read values.
    const updatedBooking = result.updated_booking ?? {
      id,
      party_size: result.new_party_size,
      committed_party_size: currentBooking.committed_party_size ?? null,
      updated_at: currentBooking.updated_at ?? null
    }

    if (result.state === 'updated' && !result.event_booking_id && !result.updated_booking) {
      logger.error(`${label} table-booking party-size update returned no updated row`, {
        metadata: {
          tableBookingId: id,
          requestedPartySize: newPartySize,
        },
      })
      return NextResponse.json({ error: 'Booking party size was not saved. Please refresh and try again.' }, { status: 409 })
    }

    if (result.updated_booking && Number(result.updated_booking.party_size) !== result.new_party_size) {
      logger.error(`${label} table-booking party-size update verification failed`, {
        metadata: {
          tableBookingId: id,
          requestedPartySize: newPartySize,
          savedPartySize: result.updated_booking.party_size,
        },
      })
      return NextResponse.json({ error: 'Booking party size was not saved. Please refresh and try again.' }, { status: 409 })
    }

    // The size is saved at this point. A deposit-transition failure must not
    // be reported as a failed update: return 200 with a separate warning.
    let depositTransition: PartySizeDepositTransitionResult | null = null
    let depositWarning: string | null = null
    try {
      depositTransition = await applyPartySizeDepositTransition(auth.supabase, {
        booking: currentBooking,
        previousPartySize,
        newPartySize,
        sendSms: parsed.data.send_sms,
        appBaseUrl,
      })
    } catch (depositError) {
      logger.error(`${label} party-size deposit transition failed after party size saved`, {
        error: depositError instanceof Error ? depositError : new Error(String(depositError)),
        metadata: { tableBookingId: id, previousPartySize, newPartySize },
      })
      depositWarning = 'Party size saved, but the deposit could not be brought in line with it. Check the deposit on the booking page.'
    }

    // A deposit left for a manager (paid, so settled on the bill, or not workable out) is said plainly,
    // and the booking carries the flag until a manager clears it (BK-043).
    if (depositTransition?.state === 'manual_review') {
      depositWarning = depositTransition.message
    }

    // Bring the pre-order seats back in line with the new party size. Only seasonal bookings can
    // have seats at all, so an ordinary Tuesday amendment skips this entirely rather than paying
    // for a round trip that has nothing to do. A booking whose seasonal answer has since been
    // switched off still qualifies: it may have seats left to tidy away. A manager shrinking a
    // Christmas table must not strand a seat the kitchen would cook for.
    //
    // Like the deposit above, a failure here must not be reported as a failed amendment. The size
    // is already saved, a stale cover list is recoverable, and the nightly drift check reports it.
    // Guests removed by seat are reported by the write itself; anything trimmed from the end, by the sync.
    let preorderRemoved: PreorderRemovedCover[] = result.removed_covers ?? []
    if (result.state === 'updated' && currentBooking.booking_period_id) {
      try {
        const sync = await syncPreorderCovers(auth.supabase, id)
        preorderRemoved = [...preorderRemoved, ...sync.removed]
      } catch (preorderError) {
        logger.error(`${label} party-size pre-order cover sync failed after party size saved`, {
          error: preorderError instanceof Error ? preorderError : new Error(String(preorderError)),
          metadata: { tableBookingId: id, previousPartySize, newPartySize },
        })
      }
    }

    // Tell the guest their booking now has a different party size (BK-091). Staff changes used to
    // reach the guest only when they crossed the deposit threshold. The amended-booking notice goes
    // email first and says where the deposit stands. Not sent when staff chose not to notify, when
    // the deposit request already went on this request (it states the new size), or for an event
    // booking, whose own seat-change text has gone. New guest wording, so it is behind the messaging
    // flag table_party_size_change_notice, off until the owner switches it on.
    let partySizeNotification: GuestNotificationOutcome | null = null
    const depositRequestWent = depositTransition?.state === 'deposit_required' && Boolean(depositTransition.notification)
    if (
      result.state === 'updated'
      && result.new_party_size !== previousPartySize
      && parsed.data.send_sms
      && !depositRequestWent
      && !result.event_booking_id
      && await isMessagingFlagOn('table_party_size_change_notice')
    ) {
      partySizeNotification = await sendTableBookingRescheduledNotificationIfAllowed(auth.supabase, {
        tableBookingId: id,
        previous: { startDateTime: currentBooking.start_datetime ?? null, partySize: previousPartySize },
      })
    }

    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'table_booking.party_size_changed',
      resource_type: 'table_booking',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        source: surface,
        previousPartySize,
        newPartySize,
        ...(parsed.data.removed_seats?.length ? { seats_removed: parsed.data.removed_seats } : {}),
        // A manager changing a Christmas party after the pre-order deadline (D21).
        ...(result.late_change ? { late_change: true } : {}),
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      data: result,
      booking: updatedBooking,
      depositTransition,
      warning: depositWarning,
      // An unpaid deposit that followed the new size (D20), for the success message.
      depositNote: depositTransition?.state === 'deposit_repriced' ? depositTransition.message : null,
      // What the shrink dropped, so staff can tell the booker whose food choice has gone.
      preorderRemoved,
      // Whether the guest was told about the new size, so the screens can say when nobody was.
      partySizeNotification,
      lateChange: result.late_change === true,
      depositRequired: depositTransition?.state === 'deposit_required',
      depositUrl: depositTransition?.state === 'deposit_required' ? depositTransition.depositUrl : null,
      depositAmount: depositTransition?.state === 'deposit_required' ? depositTransition.depositAmount : null,
      smsSent: depositTransition?.state === 'deposit_required' ? depositTransition.smsSent : false,
      // Which channel reached the guest, or why none did.
      ...(depositTransition?.state === 'deposit_required' && depositTransition.notification
        ? { depositNotification: depositTransition.notification }
        : {}),
    })
  } catch (error) {
    if (error instanceof ChristmasCourseValidationError) return NextResponse.json({ error: error.message }, { status: 409 })
    logger.error(`${label} table-booking party-size update failed`, {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: id },
    })
    if (error instanceof PartySizeUpdateFailedAfterMoveError) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(
      {
        error: 'Failed to update booking party size'
      },
      { status: 500 }
    )
  }
}
