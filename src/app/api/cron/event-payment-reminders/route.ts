import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { createEventPaymentToken, sendEventPaymentRetrySms } from '@/lib/events/event-payments'
import { sendEventPaymentLinkEmail } from '@/lib/email/event-ticket-emails'

type ReminderStage = 'payment_due_12h' | 'payment_due_2h'

function resolveStage(holdExpiresAt: string | null): ReminderStage | null {
  if (!holdExpiresAt) return null
  const expiresMs = Date.parse(holdExpiresAt)
  if (!Number.isFinite(expiresMs)) return null

  const remainingMs = expiresMs - Date.now()
  if (remainingMs <= 0) return null
  if (remainingMs <= 2 * 60 * 60 * 1000) return 'payment_due_2h'
  if (remainingMs <= 12 * 60 * 60 * 1000) return 'payment_due_12h'
  return null
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

export async function GET(request: NextRequest) {
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
    .in('source', ['admin', 'walk-in', 'sms_reply'])
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
    const stage = resolveStage(row.hold_expires_at as string | null)
    if (!stage) {
      result.skipped++
      continue
    }

    let reminderId: string | null = null
    const { data: reminderRow, error: claimError } = await (supabase.from('event_payment_reminders') as any)
      .insert({
        event_booking_id: row.id,
        stage,
        channel: 'sms',
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

    reminderId = reminderRow?.id || null

    try {
      const smsResult = await sendEventPaymentRetrySms(supabase, {
        bookingId: row.id,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      })

      if (reminderId) {
        await (supabase.from('event_payment_reminders') as any)
          .update({
            metadata: {
              claimed: true,
              source: row.source || null,
              sms_success: smsResult.success,
              sms_code: smsResult.code,
              sms_log_failure: smsResult.logFailure,
            },
          })
          .eq('id', reminderId)
      }

      if (smsResult.success || smsResult.logFailure) {
        result.sent++
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

    const { data: emailReminderRow, error: emailClaimError } = await (supabase.from('event_payment_reminders') as any)
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

    if (emailClaimError) {
      if (!isUniqueViolation(emailClaimError)) {
        logger.error('Failed to claim event payment email reminder', {
          error: new Error(emailClaimError.message || 'Unknown reminder email claim error'),
          metadata: {
            bookingId: row.id,
            stage,
          },
        })
      }
      continue
    }

    try {
      const paymentToken = await createEventPaymentToken(supabase, {
        customerId: row.customer_id as string,
        bookingId: row.id,
        holdExpiresAt: row.hold_expires_at as string,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      })
      const emailResult = await sendEventPaymentLinkEmail(supabase, {
        bookingId: row.id,
        paymentLink: paymentToken.url,
        holdExpiresAt: row.hold_expires_at as string,
        reminder: true,
      })
      await (supabase.from('event_payment_reminders') as any)
        .update({
          message_id: emailResult.messageId || null,
          metadata: {
            claimed: true,
            source: row.source || null,
            email_success: emailResult.success,
            email_error: emailResult.error || null,
            email_skipped: emailResult.skipped === true,
          },
        })
        .eq('id', emailReminderRow?.id)
    } catch (err) {
      logger.error('Failed to send event payment email reminder', {
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
