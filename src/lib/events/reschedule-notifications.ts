import { logAuditEvent } from '@/app/actions/audit'
import { getAppUrl } from '@/lib/env'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { logger } from '@/lib/logger'
import {
  sendEventPostponedEmail,
  sendEventRescheduledEmail,
} from '@/lib/email/event-ticket-emails'
import { buildEventPostponedSms, buildEventRescheduledSms } from '@/lib/sms/templates'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { settleWrite } from '@/lib/supabase/settle-write'
import { formatEventWhenCompactLondon, resolveEventStartIso } from '@/lib/events/event-when'

/** How long an unpaid hold is given after its event moves (BK-140). */
export const RESCHEDULE_HOLD_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * The new expiry for an unpaid hold when its event moves, or null to leave it alone. A hold that
 * has already lapsed stays lapsed. A live hold gets at least the grace, never past the new start,
 * so a night moved earlier also shortens a hold that would now outlast it (BK-140).
 */
export function resolveRescheduledHoldExpiry(currentExpiryIso: string | null, newStartIso: string, nowMs: number): string | null {
  const newStartMs = Date.parse(newStartIso)
  if (!Number.isFinite(newStartMs)) return null
  const currentMs = currentExpiryIso ? Date.parse(currentExpiryIso) : NaN
  if (!Number.isFinite(currentMs) || currentMs <= nowMs) return null
  const nextMs = Math.min(newStartMs, Math.max(currentMs, nowMs + RESCHEDULE_HOLD_GRACE_MS))
  if (nextMs <= nowMs || nextMs === currentMs) return null
  return new Date(nextMs).toISOString()
}

export async function dispatchEventRescheduleNotifications(params: {
  eventId: string
  eventName: string
  oldDate: string | null
  oldTime: string | null
  newDate: string
  newTime: string
  userId: string
}): Promise<{ bookingsNotified: number; totalBookingsAffected: number; notReachedBookingIds?: string[] }> {
  const { eventId, eventName, oldDate, oldTime, newDate, newTime, userId } = params
  const db = createAdminClient()

  const { data: bookings, error } = await db
    .from('bookings')
    .select('id, customer_id, seats, status, hold_expires_at, customers!inner(id, first_name, mobile_number, sms_status)')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending_payment'])

  if (error) {
    throw new Error(`Failed to load bookings for reschedule notifications: ${error.message}`)
  }

  if (!bookings || bookings.length === 0) {
    return { bookingsNotified: 0, totalBookingsAffected: 0 }
  }

  // The new date and time are a London wall clock reading, not an instant. Parsing
  // `2026-09-16T19:00:00` with `new Date` makes a UTC server read 7pm as 8pm London, which both
  // announced the wrong time and set every unpaid hold to expire an hour late.
  const newStartIso = resolveEventStartIso({ date: newDate, time: newTime })
  // The text pays by the character, so it takes the compact form; the email spells it out.
  const formattedNewDate = formatEventWhenCompactLondon(newStartIso) ?? 'the new date'

  // BK-140: an unpaid hold is given a fixed grace after the move, capped at the new start, and
  // only while it is still live. It used to be stretched to the new start, so an abandoned
  // 15-minute website checkout could hold seats unpaid until the night, and holds that had just
  // lapsed came back. The booking, its hold row and any linked table booking get the same value.
  const pendingBookings = bookings.filter((booking) => booking.status === 'pending_payment')

  if (pendingBookings.length > 0) {
    if (newStartIso) {
      const nowMs = Date.now()
      for (const booking of pendingBookings) {
        const nextExpiry = resolveRescheduledHoldExpiry(
          (booking as { hold_expires_at?: string | null }).hold_expires_at ?? null,
          newStartIso,
          nowMs,
        )
        if (!nextExpiry) continue
        await settleWrite(
          db.from('bookings').update({ hold_expires_at: nextExpiry }).eq('id', booking.id).eq('status', 'pending_payment'),
          { table: 'bookings', what: 'Moving an unpaid booking hold with the event', ids: { eventId, bookingId: booking.id } }
        )
        await settleWrite(
          db.from('booking_holds').update({ expires_at: nextExpiry }).eq('event_booking_id', booking.id).eq('status', 'active'),
          { table: 'booking_holds', what: 'Moving an active booking hold with the event', ids: { eventId, bookingId: booking.id } }
        )
        await settleWrite(
          db.from('table_bookings').update({ hold_expires_at: nextExpiry }).eq('event_booking_id', booking.id).eq('status', 'pending_payment'),
          { table: 'table_bookings', what: 'Moving the linked table hold with the event', ids: { eventId, bookingId: booking.id } }
        )
      }
    } else {
      // Leaving a hold on its old expiry is recoverable; writing an Invalid Date is not.
      logger.error('Event reschedule could not resolve the new start, so unpaid holds were left alone', {
        metadata: { eventId, newDate, newTime, pendingBookings: pendingBookings.length },
      })
    }
  }

  const smsTargets = bookings.filter((booking) => {
    const customer = booking.customers as unknown as {
      id: string
      first_name: string | null
      mobile_number: string | null
      sms_status: string | null
    }
    return customer?.sms_status === 'active' && customer?.mobile_number
  })

  // A booking counts as told only when a channel really sent (BK-089). Failed texts used to count
  // and emails never did.
  const reached = new Set<string>()
  const batchSize = 20

  for (let index = 0; index < bookings.length; index += batchSize) {
    const batch = bookings.slice(index, index + batchSize)
    const emailResults = await Promise.allSettled(
      batch.map((booking) =>
        sendEventRescheduledEmail(db, {
          bookingId: booking.id,
          eventName,
          oldDate,
          oldTime,
          newDate,
          newTime,
          appBaseUrl: getAppUrl(),
        }),
      ),
    )
    emailResults.forEach((result, position) => {
      if (result.status === 'fulfilled' && result.value?.success === true) reached.add(batch[position].id)
    })
  }

  for (let index = 0; index < smsTargets.length; index += batchSize) {
    const batch = smsTargets.slice(index, index + batchSize)

    const results = await Promise.allSettled(
      batch.map(async (booking) => {
        const customer = booking.customers as unknown as {
          id: string
          first_name: string | null
          mobile_number: string | null
          sms_status: string | null
        }

        let manageLink: string | null = null
        try {
          const manageToken = await createEventManageToken(db, {
            customerId: customer.id,
            bookingId: booking.id,
            eventStartIso: newStartIso,
            appBaseUrl: getAppUrl(),
          })
          manageLink = manageToken.url
        } catch (error) {
          logger.warn('Failed to create manage-booking link for reschedule SMS', {
            error: error instanceof Error ? error : new Error(String(error)),
            metadata: { bookingId: booking.id, eventId },
          })
        }

        const smsBody = buildEventRescheduledSms({
          firstName: customer.first_name,
          eventName,
          newDate: formattedNewDate,
          seats: booking.seats || 1,
          manageLink,
        })

        const smsResult = await sendSMS(customer.mobile_number!, smsBody, {
          customerId: customer.id,
          metadata: {
            template_key: 'event_rescheduled',
            event_id: eventId,
            event_booking_id: booking.id,
            old_date: oldDate,
            new_date: newDate,
          },
        })
        if (smsResult?.success === true) reached.add(booking.id)
      }),
    )
    results.forEach((result) => {
      if (result.status === 'rejected') {
        logger.warn('Reschedule text failed', { metadata: { eventId, error: String(result.reason) } })
      }
    })

    if (index + batchSize < smsTargets.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  const bookingsNotified = reached.size
  const notReachedBookingIds = bookings.map((booking) => booking.id).filter((id) => !reached.has(id))

  await logAuditEvent({
    user_id: userId,
    operation_type: 'reschedule',
    resource_type: 'event',
    resource_id: eventId,
    operation_status: notReachedBookingIds.length > 0 ? 'failure' : 'success',
    ...(notReachedBookingIds.length > 0
      ? { error_message: `${notReachedBookingIds.length} of ${bookings.length} bookings could not be told the new date by email or text. Ring them from the event page.` }
      : {}),
    additional_info: {
      old_date: oldDate,
      old_time: oldTime,
      new_date: newDate,
      new_time: newTime,
      bookings_notified: bookingsNotified,
      total_bookings_affected: bookings.length,
      not_reached_booking_ids: notReachedBookingIds,
    },
  })

  return { bookingsNotified, totalBookingsAffected: bookings.length, notReachedBookingIds }
}

export async function dispatchEventPostponedNotifications(params: {
  eventId: string
  eventName: string
  userId: string
}): Promise<{ bookingsNotified: number; totalBookingsAffected: number; notReachedBookingIds: string[] }> {
  const { eventId, eventName, userId } = params
  const db = createAdminClient()

  const [{ data: bookings, error }, { data: eventRow, error: eventError }] = await Promise.all([
    db
      .from('bookings')
      .select('id, status, customers!inner(id, first_name, mobile_number, sms_status)')
      .eq('event_id', eventId)
      .in('status', ['confirmed', 'pending_payment']),
    db.from('events').select('date, time, start_datetime, payment_mode').eq('id', eventId).maybeSingle(),
  ])

  if (error) {
    throw new Error(`Failed to load bookings for postponed notifications: ${error.message}`)
  }
  if (eventError) {
    throw new Error(`Failed to load the event for postponed notifications: ${eventError.message}`)
  }

  if (!bookings || bookings.length === 0) {
    return { bookingsNotified: 0, totalBookingsAffected: 0, notReachedBookingIds: [] }
  }

  // The postponed notice went by email only, so a guest with no usable email was never told yet was
  // counted as notified (BK-089). Each guest now gets the email, or a text where the email cannot
  // reach them, and only a send that went through counts.
  const startIso = eventRow ? resolveEventStartIso({ date: eventRow.date, time: eventRow.time, start_datetime: eventRow.start_datetime }) : null
  const formattedDate = startIso ? formatEventWhenCompactLondon(startIso) : null
  const reached = new Set<string>()
  const batchSize = 20

  for (let index = 0; index < bookings.length; index += batchSize) {
    const batch = bookings.slice(index, index + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (booking) => {
        const email = await sendEventPostponedEmail(db, { bookingId: booking.id, eventName })
        if (email.success === true) {
          reached.add(booking.id)
          return
        }
        // Held back because the send log could not be read: it may already have gone, so no text.
        if ((email as { deferred?: boolean }).deferred === true) return
        const customer = booking.customers as unknown as {
          id: string
          first_name: string | null
          mobile_number: string | null
          sms_status: string | null
        }
        if (customer?.sms_status !== 'active' || !customer.mobile_number) return
        const smsResult = await sendSMS(
          customer.mobile_number,
          buildEventPostponedSms({
            firstName: customer.first_name,
            eventName,
            eventDate: formattedDate,
            paidOnline: eventRow?.payment_mode === 'prepaid' && booking.status === 'confirmed',
            phoneDisplay: GUEST_CONTACT.phoneDisplay,
          }),
          {
            customerId: customer.id,
            metadata: { template_key: 'event_postponed', event_id: eventId, event_booking_id: booking.id },
          },
        )
        if (smsResult?.success === true) reached.add(booking.id)
      }),
    )
    results.forEach((result) => {
      if (result.status === 'rejected') {
        logger.warn('Postponed notice failed', { metadata: { eventId, error: String(result.reason) } })
      }
    })
  }

  const bookingsNotified = reached.size
  const notReachedBookingIds = bookings.map((booking) => booking.id).filter((id) => !reached.has(id))

  await logAuditEvent({
    user_id: userId,
    operation_type: 'postpone',
    resource_type: 'event',
    resource_id: eventId,
    operation_status: notReachedBookingIds.length > 0 ? 'failure' : 'success',
    ...(notReachedBookingIds.length > 0
      ? { error_message: `${notReachedBookingIds.length} of ${bookings.length} bookings could not be told by email or text. Ring them from the event page.` }
      : {}),
    additional_info: {
      bookings_notified: bookingsNotified,
      total_bookings_affected: bookings.length,
      not_reached_booking_ids: notReachedBookingIds,
    },
  })

  return { bookingsNotified, totalBookingsAffected: bookings.length, notReachedBookingIds }
}
