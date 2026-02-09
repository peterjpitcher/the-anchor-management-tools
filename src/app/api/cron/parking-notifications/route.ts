import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import {
  buildPaymentReminderSmsForStage,
  buildSessionThreeDayReminderSms,
} from '@/lib/parking/notifications'
import { logParkingNotification } from '@/lib/parking/repository'
import type { ParkingBooking } from '@/types/parking'
import { authorizeCronRequest } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DAY_MS = 24 * 60 * 60 * 1000

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const supabase = await createAdminClient()
    const now = new Date()

    const [pendingPaymentLifecycle, paidSessionReminders] = await Promise.all([
      processPendingPaymentLifecycle(supabase, now),
      processPaidSessionReminders(supabase, now),
    ])

    return NextResponse.json({
      success: true,
      pendingPaymentLifecycle,
      paidSessionReminders,
    })
  } catch (error) {
    console.error('Parking notifications cron failed:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}

async function processPendingPaymentLifecycle(supabase: ReturnType<typeof createAdminClient>, now: Date) {
  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'pending_payment')
    .eq('payment_status', 'pending')
    .not('payment_due_at', 'is', null)

  if (error) {
    console.error('Failed to fetch pending parking payment lifecycle bookings', error)
    return { sent: 0, expired: 0, errors: 1, skipped: 0 }
  }

  if (!bookings || bookings.length === 0) {
    return { sent: 0, expired: 0, errors: 0, skipped: 0 }
  }

  let sent = 0
  let expired = 0
  let errors = 0
  let skipped = 0

  for (const booking of bookings as ParkingBooking[]) {
    const dueAt = new Date(booking.payment_due_at || booking.expires_at || '')
    if (Number.isNaN(dueAt.getTime())) {
      skipped += 1
      continue
    }

    const msUntilDue = dueAt.getTime() - now.getTime()
    if (msUntilDue <= 0) {
      const { error: expireError } = await supabase
        .from('parking_bookings')
        .update({
          status: 'expired',
          payment_status: 'expired',
          updated_at: now.toISOString(),
        })
        .eq('id', booking.id)

      if (expireError) {
        console.error('Failed to expire unpaid parking booking', booking.id, expireError)
        errors += 1
      } else {
        expired += 1
      }

      continue
    }

    const shouldSendDayBefore =
      !booking.unpaid_day_before_sms_sent &&
      msUntilDue <= DAY_MS

    const shouldSendWeekBefore =
      !booking.unpaid_week_before_sms_sent &&
      msUntilDue <= 7 * DAY_MS &&
      msUntilDue > DAY_MS

    if (!shouldSendDayBefore && !shouldSendWeekBefore) {
      skipped += 1
      continue
    }

    const paymentLink = await lookupPendingPaymentLink(supabase, booking.id)

    if (shouldSendDayBefore) {
      const smsResult = await sendParkingReminderSms({
        supabase,
        booking,
        eventType: 'payment_reminder',
        smsBody: buildPaymentReminderSmsForStage(booking, 'day_before_expiry', paymentLink || undefined),
        payload: { stage: 'day_before_expiry' },
      })

      if (smsResult.sent) {
        sent += 1
        const { error: updateError } = await supabase
          .from('parking_bookings')
          .update({ unpaid_day_before_sms_sent: true })
          .eq('id', booking.id)

        if (updateError) {
          console.error('Failed to mark day-before reminder sent', booking.id, updateError)
        }
      } else if (smsResult.skipped) {
        skipped += 1
      } else {
        errors += 1
      }

      continue
    }

    const smsResult = await sendParkingReminderSms({
      supabase,
      booking,
      eventType: 'payment_reminder',
      smsBody: buildPaymentReminderSmsForStage(booking, 'week_before_expiry', paymentLink || undefined),
      payload: { stage: 'week_before_expiry' },
    })

    if (smsResult.sent) {
      sent += 1
      const { error: updateError } = await supabase
        .from('parking_bookings')
        .update({ unpaid_week_before_sms_sent: true })
        .eq('id', booking.id)

      if (updateError) {
        console.error('Failed to mark week-before reminder sent', booking.id, updateError)
      }
    } else if (smsResult.skipped) {
      skipped += 1
    } else {
      errors += 1
    }
  }

  return { sent, expired, errors, skipped }
}

async function processPaidSessionReminders(supabase: ReturnType<typeof createAdminClient>, now: Date) {
  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .eq('payment_status', 'paid')

  if (error) {
    console.error('Failed to fetch paid parking bookings for reminders', error)
    return { startSent: 0, endSent: 0, errors: 1, skipped: 0 }
  }

  if (!bookings || bookings.length === 0) {
    return { startSent: 0, endSent: 0, errors: 0, skipped: 0 }
  }

  let startSent = 0
  let endSent = 0
  let errors = 0
  let skipped = 0

  for (const booking of bookings as ParkingBooking[]) {
    const startAt = new Date(booking.start_at)
    const endAt = new Date(booking.end_at)

    const msUntilStart = startAt.getTime() - now.getTime()
    const msUntilEnd = endAt.getTime() - now.getTime()

    const shouldSendStart =
      !booking.paid_start_three_day_sms_sent &&
      msUntilStart > 0 &&
      msUntilStart <= 3 * DAY_MS

    const shouldSendEnd =
      !booking.paid_end_three_day_sms_sent &&
      msUntilEnd > 0 &&
      msUntilEnd <= 3 * DAY_MS

    if (!shouldSendStart && !shouldSendEnd) {
      skipped += 1
      continue
    }

    if (shouldSendStart) {
      const smsResult = await sendParkingReminderSms({
        supabase,
        booking,
        eventType: 'session_start',
        smsBody: buildSessionThreeDayReminderSms(booking, 'start'),
        payload: { stage: 'three_days_before_start' },
      })

      if (smsResult.sent) {
        startSent += 1
        const { error: updateError } = await supabase
          .from('parking_bookings')
          .update({ paid_start_three_day_sms_sent: true })
          .eq('id', booking.id)

        if (updateError) {
          console.error('Failed to mark paid start reminder sent', booking.id, updateError)
        }
      } else if (smsResult.skipped) {
        skipped += 1
      } else {
        errors += 1
      }
    }

    if (shouldSendEnd) {
      const smsResult = await sendParkingReminderSms({
        supabase,
        booking,
        eventType: 'session_end',
        smsBody: buildSessionThreeDayReminderSms(booking, 'end'),
        payload: { stage: 'three_days_before_end' },
      })

      if (smsResult.sent) {
        endSent += 1
        const { error: updateError } = await supabase
          .from('parking_bookings')
          .update({ paid_end_three_day_sms_sent: true })
          .eq('id', booking.id)

        if (updateError) {
          console.error('Failed to mark paid end reminder sent', booking.id, updateError)
        }
      } else if (smsResult.skipped) {
        skipped += 1
      } else {
        errors += 1
      }
    }
  }

  return { startSent, endSent, errors, skipped }
}

async function sendParkingReminderSms(params: {
  supabase: ReturnType<typeof createAdminClient>
  booking: ParkingBooking
  eventType: 'payment_reminder' | 'session_start' | 'session_end'
  smsBody: string
  payload?: Record<string, unknown>
}): Promise<{ sent: boolean; skipped: boolean }> {
  const { supabase, booking, eventType, smsBody, payload } = params

  if (!booking.customer_mobile) {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: eventType,
      status: 'skipped',
      payload: {
        reason: 'No customer mobile number on booking',
        ...(payload || {}),
      },
    }, supabase)
    return { sent: false, skipped: true }
  }

  const smsWithReply = ensureReplyInstruction(
    smsBody,
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  )

  const smsResult = await sendSMS(booking.customer_mobile, smsWithReply, {
    customerId: booking.customer_id ?? undefined,
    metadata: {
      parking_booking_id: booking.id,
      event_type: eventType,
      ...(payload || {}),
    },
    customerFallback: {
      email: booking.customer_email ?? undefined,
    },
  })

  await logParkingNotification({
    booking_id: booking.id,
    channel: 'sms',
    event_type: eventType,
    status: smsResult.success ? 'sent' : 'failed',
    sent_at: smsResult.success ? new Date().toISOString() : null,
    message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
    payload: { sms: smsWithReply, ...(payload || {}) },
  }, supabase)

  return {
    sent: smsResult.success,
    skipped: false,
  }
}

async function lookupPendingPaymentLink(supabase: ReturnType<typeof createAdminClient>, bookingId: string) {
  const { data, error } = await supabase
    .from('parking_booking_payments')
    .select('metadata')
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed to lookup parking payment metadata', bookingId, error)
    return null
  }

  const metadata = data?.metadata as { approve_url?: string } | null
  return metadata?.approve_url ?? null
}
