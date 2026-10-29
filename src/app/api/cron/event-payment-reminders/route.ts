import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { settleWrite } from '@/lib/supabase/settle-write'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { createEventPaymentToken, sendEventPaymentRetrySms } from '@/lib/events/event-payments'
import { sendEventPaymentLinkEmail } from '@/lib/email/event-ticket-emails'
import { withCronRun } from '@/lib/cron/run-recorder'
import { sendEventMessageEmailFirst } from '@/lib/events/event-guest-notify'
import { resolveReminderStage, textWouldArriveTooLate } from '@/lib/events/payment-reminder-timing'

// Up to 200 bookings, each an email or a text; the 15-second project default is too tight (BK-212).
export const maxDuration = 300

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

async function sendEventPaymentReminders(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const twelveHoursIso = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  const result = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  }

  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id, customer_id, hold_expires_at, source')
    .eq('status', 'pending_payment')
    // BK-032: never a walk-in. They are standing at the bar, where staff take the money (D12).
    .in('source', ['admin', 'sms_reply'])
    .not('hold_expires_at', 'is', null)
    .gt('hold_expires_at', nowIso)
    .lte('hold_expires_at', twelveHoursIso)
    .order('hold_expires_at', { ascending: true })
    .limit(200)

  if (error) {
    logger.error('Failed to load pending event payment reminders', {
      error: new Error(error.message),
    })
    return NextResponse.json({ error: 'Failed to load pending reminders' }, { status: 500 })
  }

  for (const row of rows || []) {
    result.checked++
    const stage = resolveReminderStage(row.hold_expires_at as string | null)
    if (!stage) {
      result.skipped++
      continue
    }

    // One claim per booking and stage, made before anything is sent, so two overlapping runs
    // cannot both remind the guest. The reminder goes by email first and a text only when no
    // email goes (BK-167, owner decision D14); the row's channel is the lead channel.
    const { data: reminderRow, error: claimError } = await (supabase.from('event_payment_reminders') as any)
      .insert({
        event_booking_id: row.id,
        stage,
        channel: 'email',
        sent_at: new Date().toISOString(),
        metadata: {
          claimed: true,
          source: row.source || null,
        },
      })
      .select('id')
      .maybeSingle()

    if (claimError) {
      if (isUniqueViolation(claimError)) {
        result.skipped++
        continue
      }
      result.failed++
      logger.error('Failed to claim event payment reminder', {
        error: new Error(claimError.message || 'Unknown reminder claim error'),
        metadata: {
          bookingId: row.id,
          stage,
        },
      })
      continue
    }

    const reminderId: string | null = reminderRow?.id || null
    const holdExpiresAt = row.hold_expires_at as string
    let emailMessageId: string | null = null
    let emailError: string | null = null
    let textSkippedReason: string | null = null

    try {
      const outcome = await sendEventMessageEmailFirst({
        templateKey: 'event_payment_reminder',
        bookingId: row.id,
        customerId: (row.customer_id as string | null) ?? null,
        email: async () => {
          const paymentToken = await createEventPaymentToken(supabase, {
            customerId: row.customer_id as string,
            bookingId: row.id,
            holdExpiresAt,
            appBaseUrl: getAppUrl(),
          })
          const emailResult = await sendEventPaymentLinkEmail(supabase, {
            bookingId: row.id,
            paymentLink: paymentToken.url,
            holdExpiresAt,
            reminder: true,
          })
          emailMessageId = emailResult.messageId || null
          emailError = emailResult.error || null
          return emailResult
        },
        text: async () => {
          // BK-213: never a payment link that quiet hours would hold until the seats are gone.
          if (textWouldArriveTooLate(holdExpiresAt)) {
            textSkippedReason = 'quiet_hours_until_hold_end'
            return null
          }
          return sendEventPaymentRetrySms(supabase, { bookingId: row.id, appBaseUrl: getAppUrl() })
        },
      })

      if (reminderId) {
        await settleWrite(
          (supabase.from('event_payment_reminders') as any)
            .update({
              message_id: emailMessageId,
              metadata: {
                claimed: true,
                source: row.source || null,
                sent_channel: outcome.channel,
                outcome: outcome.status,
                email_sent: outcome.emailed,
                email_error: emailError,
                sms_sent: outcome.texted,
                sms_code: outcome.smsMeta?.code ?? null,
                sms_log_failure: outcome.smsMeta?.logFailure ?? false,
                text_skipped_reason: textSkippedReason,
              },
            })
            .eq('id', reminderId),
          { table: 'event_payment_reminders', what: 'Recording the payment reminder result', ids: { reminderId, bookingId: row.id } }
        )
      }

      if (outcome.status === 'sent') {
        result.sent++
      } else if (outcome.status === 'failed') {
        result.failed++
      } else {
        result.skipped++
      }
    } catch (err) {
      result.failed++
      logger.error('Failed to send event payment reminder', {
        error: err instanceof Error ? err : new Error(String(err)),
        metadata: {
          bookingId: row.id,
          stage,
        },
      })
    }
  }

  return NextResponse.json(result)
}

// A run record per run, a failure email when the run fails, and the reminders it could not send
// counted on the record for the daily check (BK-116).
export const GET = withCronRun('event-payment-reminders', sendEventPaymentReminders, {
  recording: 'every_run',
  itemFailures: (body) => Number(body.failed ?? 0),
})
