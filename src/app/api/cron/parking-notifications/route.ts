import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email/emailService'
import { ensureReplyInstruction } from '@/lib/sms/support'
import {
  buildPaymentReminderSms,
  buildPaymentReminderManagerEmail,
  buildSessionEndSms,
  buildSessionManagerEmail,
  buildSessionStartSms,
} from '@/lib/parking/notifications'
import { logParkingNotification } from '@/lib/parking/repository'
import { recordOutboundSmsMessage } from '@/lib/sms/logging'
import type { ParkingBooking } from '@/types/parking'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { startOfDay, endOfDay } from 'date-fns'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const LONDON_TZ = 'Europe/London'

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const supabase = await createAdminClient()
    const now = new Date()

    const [paymentReminders, startNotifications, endNotifications] = await Promise.all([
      processPaymentReminders(supabase, now),
      processStartNotifications(supabase, now),
      processEndNotifications(supabase, now)
    ])

    return NextResponse.json({
      success: true,
      paymentReminders,
      startNotifications,
      endNotifications
    })
  } catch (error) {
    console.error('Parking notifications cron failed:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}

async function processPaymentReminders(supabase: ReturnType<typeof createAdminClient>, now: Date) {
  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'pending_payment')
    .eq('payment_status', 'pending')
    .eq('payment_overdue_notified', false)
    .lte('payment_due_at', now.toISOString())

  if (error) {
    console.error('Failed to fetch overdue parking bookings', error)
    return { sent: 0, errors: 1 }
  }

  if (!bookings || bookings.length === 0) {
    return { sent: 0, errors: 0 }
  }

  let sent = 0
  let errors = 0

  for (const booking of bookings as ParkingBooking[]) {
    const paymentLink = await lookupPendingPaymentLink(supabase, booking.id)
    const smsBody = buildPaymentReminderSms(booking, paymentLink || undefined)

    const smsWithReply = ensureReplyInstruction(
      smsBody,
      process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    )

    const smsResult = await sendSMS(booking.customer_mobile, smsWithReply)

    let messageId: string | null = null
    let customerIdForLog = booking.customer_id

    if (!customerIdForLog && booking.customer_mobile) {
      const ensured = await ensureCustomerForPhone(supabase, booking.customer_mobile, {
        email: (booking as any)?.customer_email ?? null
      })
      customerIdForLog = ensured.customerId ?? undefined
    }

    if (smsResult.success && smsResult.sid && customerIdForLog) {
      messageId = await recordOutboundSmsMessage({
        supabase,
        customerId: customerIdForLog,
        to: booking.customer_mobile,
        body: smsWithReply,
        sid: smsResult.sid,
        fromNumber: smsResult.fromNumber ?? undefined,
        metadata: {
          parking_booking_id: booking.id,
          event_type: 'payment_overdue'
        },
        twilioStatus: smsResult.status ?? 'queued'
      })
      if (!messageId) {
        console.warn('Parking payment reminder SMS failed to record', {
          bookingId: booking.id
        })
      }
    }

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_overdue',
      status: smsResult.success ? 'sent' : 'failed',
      sent_at: smsResult.success ? new Date().toISOString() : null,
      message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
      payload: { sms: smsWithReply, message_id: messageId }
    }, supabase)

    if (!smsResult.success) {
      errors += 1
      continue
    }

    sent += 1

    const managerEmail = buildPaymentReminderManagerEmail(booking, paymentLink || undefined)
    const emailResult = await sendEmail({
      to: managerEmail.to,
      subject: managerEmail.subject,
      html: managerEmail.html
    })

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'email',
      event_type: 'payment_overdue',
      status: emailResult.success ? 'sent' : 'failed',
      sent_at: emailResult.success ? new Date().toISOString() : null,
      payload: { subject: managerEmail.subject }
    }, supabase)

    const { error: updateError } = await supabase
      .from('parking_bookings')
      .update({ payment_overdue_notified: true })
      .eq('id', booking.id)

    if (updateError) {
      console.error('Failed to mark parking booking as notified', booking.id, updateError)
    }
  }

  return { sent, errors }
}

async function processStartNotifications(supabase: ReturnType<typeof createAdminClient>, now: Date) {
  const window = buildLondonWindow(now)

  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .eq('payment_status', 'paid')
    .eq('start_notification_sent', false)
    .gte('start_at', window.startIso)
    .lte('start_at', window.endIso)

  if (error) {
    console.error('Failed to fetch start notifications', error)
    return { sent: 0, errors: 1 }
  }

  if (!bookings || bookings.length === 0) {
    return { sent: 0, errors: 0 }
  }

  let sent = 0
  let errors = 0

  for (const booking of bookings as ParkingBooking[]) {
    const smsBody = ensureReplyInstruction(
      buildSessionStartSms(booking),
      process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    )

    const smsResult = await sendSMS(booking.customer_mobile, smsBody)

    let messageId: string | null = null
    let customerIdForLog = booking.customer_id

    if (!customerIdForLog && booking.customer_mobile) {
      const ensured = await ensureCustomerForPhone(supabase, booking.customer_mobile, {
        email: (booking as any)?.customer_email ?? null
      })
      customerIdForLog = ensured.customerId ?? undefined
    }

    if (smsResult.success && smsResult.sid && customerIdForLog) {
      messageId = await recordOutboundSmsMessage({
        supabase,
        customerId: customerIdForLog,
        to: booking.customer_mobile,
        body: smsBody,
        sid: smsResult.sid,
        fromNumber: smsResult.fromNumber ?? undefined,
        metadata: {
          parking_booking_id: booking.id,
          event_type: 'session_start'
        },
        twilioStatus: smsResult.status ?? 'queued'
      })
      if (!messageId) {
        console.warn('Parking start notification SMS failed to record', {
          bookingId: booking.id
        })
      }
    }

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'session_start',
      status: smsResult.success ? 'sent' : 'failed',
      sent_at: smsResult.success ? new Date().toISOString() : null,
      message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
      payload: { sms: smsBody, message_id: messageId }
    }, supabase)

    const managerEmail = buildSessionManagerEmail(booking, 'start')
    const emailResult = await sendEmail({ to: managerEmail.to, subject: managerEmail.subject, html: managerEmail.html })
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'email',
      event_type: 'session_start',
      status: emailResult.success ? 'sent' : 'failed',
      sent_at: emailResult.success ? new Date().toISOString() : null,
      payload: { subject: managerEmail.subject }
    }, supabase)

    if (smsResult.success) {
      sent += 1
      const { error: updateError } = await supabase
        .from('parking_bookings')
        .update({ start_notification_sent: true })
        .eq('id', booking.id)

      if (updateError) {
        console.error('Failed to mark start notification sent', booking.id, updateError)
      }
    } else {
      errors += 1
    }
  }

  return { sent, errors }
}

async function processEndNotifications(supabase: ReturnType<typeof createAdminClient>, now: Date) {
  const window = buildLondonWindow(now)

  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .eq('payment_status', 'paid')
    .eq('end_notification_sent', false)
    .gte('end_at', window.startIso)
    .lte('end_at', window.endIso)

  if (error) {
    console.error('Failed to fetch end notifications', error)
    return { sent: 0, errors: 1 }
  }

  if (!bookings || bookings.length === 0) {
    return { sent: 0, errors: 0 }
  }

  let sent = 0
  let errors = 0

  for (const booking of bookings as ParkingBooking[]) {
    const smsBody = ensureReplyInstruction(
      buildSessionEndSms(booking),
      process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    )

    const smsResult = await sendSMS(booking.customer_mobile, smsBody)

    let messageId: string | null = null
    let customerIdForLog = booking.customer_id

    if (!customerIdForLog && booking.customer_mobile) {
      const ensured = await ensureCustomerForPhone(supabase, booking.customer_mobile, {
        email: (booking as any)?.customer_email ?? null
      })
      customerIdForLog = ensured.customerId ?? undefined
    }

    if (smsResult.success && smsResult.sid && customerIdForLog) {
      messageId = await recordOutboundSmsMessage({
        supabase,
        customerId: customerIdForLog,
        to: booking.customer_mobile,
        body: smsBody,
        sid: smsResult.sid,
        fromNumber: smsResult.fromNumber ?? undefined,
        metadata: {
          parking_booking_id: booking.id,
          event_type: 'session_end'
        },
        twilioStatus: smsResult.status ?? 'queued'
      })
      if (!messageId) {
        console.warn('Parking end notification SMS failed to record', {
          bookingId: booking.id
        })
      }
    }

    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'session_end',
      status: smsResult.success ? 'sent' : 'failed',
      sent_at: smsResult.success ? new Date().toISOString() : null,
      message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
      payload: { sms: smsBody, message_id: messageId }
    }, supabase)

    const managerEmail = buildSessionManagerEmail(booking, 'end')
    const emailResult = await sendEmail({ to: managerEmail.to, subject: managerEmail.subject, html: managerEmail.html })
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'email',
      event_type: 'session_end',
      status: emailResult.success ? 'sent' : 'failed',
      sent_at: emailResult.success ? new Date().toISOString() : null,
      payload: { subject: managerEmail.subject }
    }, supabase)

    if (smsResult.success) {
      sent += 1
      const { error: updateError } = await supabase
        .from('parking_bookings')
        .update({ end_notification_sent: true })
        .eq('id', booking.id)

      if (updateError) {
        console.error('Failed to mark end notification sent', booking.id, updateError)
      }
    } else {
      errors += 1
    }
  }

  return { sent, errors }
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

function buildLondonWindow(now: Date) {
  const londonNow = toZonedTime(now, LONDON_TZ)
  const startLondon = startOfDay(londonNow)
  const endLondon = endOfDay(londonNow)

  const startUtc = fromZonedTime(startLondon, LONDON_TZ)
  const endUtc = fromZonedTime(endLondon, LONDON_TZ)

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString()
  }
}
