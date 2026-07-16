import { logAuditEvent } from '@/app/actions/audit'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { logger } from '@/lib/logger'
import {
  sendEventPostponedEmail,
  sendEventRescheduledEmail,
} from '@/lib/email/event-ticket-emails'
import { buildEventRescheduledSms } from '@/lib/sms/templates'
import { sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'

function formatLondonDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return 'your event time'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12',
    }).format(new Date(isoDateTime))
  } catch {
    return 'your event time'
  }
}

export async function dispatchEventRescheduleNotifications(params: {
  eventId: string
  eventName: string
  oldDate: string | null
  oldTime: string | null
  newDate: string
  newTime: string
  userId: string
}): Promise<{ bookingsNotified: number; totalBookingsAffected: number }> {
  const { eventId, eventName, oldDate, oldTime, newDate, newTime, userId } = params
  const db = createAdminClient()

  const { data: bookings, error } = await db
    .from('bookings')
    .select('id, customer_id, seats, status, customers!inner(id, first_name, mobile_number, sms_status)')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending_payment'])

  if (error) {
    throw new Error(`Failed to load bookings for reschedule notifications: ${error.message}`)
  }

  if (!bookings || bookings.length === 0) {
    return { bookingsNotified: 0, totalBookingsAffected: 0 }
  }

  const newStartIso = `${newDate}T${newTime || '00:00'}:00`
  const formattedNewDate = formatLondonDateTime(newStartIso)

  const pendingBookingIds = bookings
    .filter((booking) => booking.status === 'pending_payment')
    .map((booking) => booking.id)

  if (pendingBookingIds.length > 0) {
    const newStartDatetime = new Date(newStartIso).toISOString()

    await db
      .from('bookings')
      .update({ hold_expires_at: newStartDatetime })
      .in('id', pendingBookingIds)
      .lt('hold_expires_at', newStartDatetime)

    await db
      .from('booking_holds')
      .update({ expires_at: newStartDatetime })
      .in('event_booking_id', pendingBookingIds)
      .eq('status', 'active')
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

  let bookingsNotified = 0
  const batchSize = 20

  for (let index = 0; index < bookings.length; index += batchSize) {
    const batch = bookings.slice(index, index + batchSize)
    await Promise.allSettled(
      batch.map((booking) =>
        sendEventRescheduledEmail(db, {
          bookingId: booking.id,
          eventName,
          oldDate,
          oldTime,
          newDate,
          newTime,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || '',
        }),
      ),
    )
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
            appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || '',
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

        await sendSMS(customer.mobile_number!, smsBody, {
          customerId: customer.id,
          metadata: {
            template_key: 'event_rescheduled',
            event_id: eventId,
            event_booking_id: booking.id,
            old_date: oldDate,
            new_date: newDate,
          },
        })
      }),
    )

    bookingsNotified += results.filter((result) => result.status === 'fulfilled').length

    if (index + batchSize < smsTargets.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  await logAuditEvent({
    user_id: userId,
    operation_type: 'reschedule',
    resource_type: 'event',
    resource_id: eventId,
    operation_status: 'success',
    additional_info: {
      old_date: oldDate,
      old_time: oldTime,
      new_date: newDate,
      new_time: newTime,
      bookings_notified: bookingsNotified,
      total_bookings_affected: bookings.length,
    },
  })

  return { bookingsNotified, totalBookingsAffected: bookings.length }
}

export async function dispatchEventPostponedNotifications(params: {
  eventId: string
  eventName: string
  userId: string
}): Promise<{ bookingsNotified: number; totalBookingsAffected: number }> {
  const { eventId, eventName, userId } = params
  const db = createAdminClient()

  const { data: bookings, error } = await db
    .from('bookings')
    .select('id')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending_payment'])

  if (error) {
    throw new Error(`Failed to load bookings for postponed notifications: ${error.message}`)
  }

  if (!bookings || bookings.length === 0) {
    return { bookingsNotified: 0, totalBookingsAffected: 0 }
  }

  let bookingsNotified = 0
  const batchSize = 20
  for (let index = 0; index < bookings.length; index += batchSize) {
    const batch = bookings.slice(index, index + batchSize)
    const results = await Promise.allSettled(
      batch.map((booking) =>
        sendEventPostponedEmail(db, {
          bookingId: booking.id,
          eventName,
        }),
      ),
    )
    bookingsNotified += results.filter((result) => result.status === 'fulfilled').length
  }

  await logAuditEvent({
    user_id: userId,
    operation_type: 'postpone',
    resource_type: 'event',
    resource_id: eventId,
    operation_status: 'success',
    additional_info: {
      bookings_notified: bookingsNotified,
      total_bookings_affected: bookings.length,
    },
  })

  return { bookingsNotified, totalBookingsAffected: bookings.length }
}
