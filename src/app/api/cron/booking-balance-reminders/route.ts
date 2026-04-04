import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { getSmartFirstName } from '@/lib/sms/bulk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Cron: booking-balance-reminders
 * Runs daily at 10:00 (London time via Vercel schedule).
 *
 * Finds confirmed private bookings where the balance_due_date is exactly
 * 7 days or 1 day from today, the balance has not been paid, and sends an
 * SMS reminder via the existing SmsQueueService (which handles opt-in
 * checks, quiet-hours guards, and deduplication).
 */
async function handler(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.warn('[Cron] Starting booking-balance-reminders')

    const supabase = createAdminClient()

    // Compute today's ISO date in London time
    const nowLondon = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    // Build T+7 and T+1 target dates
    const today = new Date(`${nowLondon}T00:00:00.000Z`)
    const sevenDaysFromNow = new Date(today)
    sevenDaysFromNow.setUTCDate(today.getUTCDate() + 7)
    const oneDayFromNow = new Date(today)
    oneDayFromNow.setUTCDate(today.getUTCDate() + 1)

    const sevenDaysIso = sevenDaysFromNow.toISOString().slice(0, 10)
    const oneDayIso = oneDayFromNow.toISOString().slice(0, 10)

    // Fetch confirmed bookings whose balance_due_date falls on one of these dates
    // and where the final balance has not yet been paid.
    const { data: bookings, error: fetchError } = await supabase
      .from('private_bookings')
      .select(
        'id, customer_first_name, customer_name, contact_phone, customer_id, event_date, total_amount, calculated_total, deposit_amount, balance_due_date, final_payment_date'
      )
      .eq('status', 'confirmed')
      .in('balance_due_date', [sevenDaysIso, oneDayIso])
      .is('final_payment_date', null)
      .is('deleted_at', null)

    if (fetchError) {
      console.error('[Cron] Error fetching bookings for balance reminders:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch bookings', details: fetchError },
        { status: 500 }
      )
    }

    console.warn(`[Cron] Found ${bookings?.length ?? 0} bookings requiring a balance reminder`)

    const results = {
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: 0,
    }

    for (const booking of bookings ?? []) {
      results.processed++

      const totalAmount = Number(booking.calculated_total ?? booking.total_amount ?? 0)
      const depositAmount = Number(booking.deposit_amount ?? 0)
      const balanceDue = Math.max(totalAmount - depositAmount, 0)

      if (!Number.isFinite(balanceDue) || balanceDue <= 0) {
        results.skipped++
        continue
      }

      const isSevenDay = booking.balance_due_date === sevenDaysIso
      const triggerType = isSevenDay ? 'balance_reminder_7day' : 'balance_reminder_1day'
      const templateKey = `private_booking_${triggerType}`

      const eventDateReadable = booking.event_date
        ? new Date(booking.event_date).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : 'your event'

      const smartName = getSmartFirstName(booking.customer_first_name)

      const messageBody = isSevenDay
        ? `The Anchor: Hi ${smartName}, your balance of £${balanceDue.toFixed(2)} for your event on ${eventDateReadable} at The Anchor is due in 7 days. Please call us to arrange payment.`
        : `The Anchor: Hi ${smartName}, a reminder that your balance of £${balanceDue.toFixed(2)} for your event on ${eventDateReadable} is due today. Please call us.`

      try {
        const result = await SmsQueueService.queueAndSend({
          booking_id: booking.id,
          trigger_type: triggerType,
          template_key: templateKey,
          message_body: messageBody,
          customer_phone: booking.contact_phone ?? undefined,
          customer_name: booking.customer_name ?? '',
          customer_id: booking.customer_id ?? undefined,
          priority: 1,
          metadata: {
            balance_due: balanceDue,
            balance_due_date: booking.balance_due_date,
            event_date: booking.event_date,
          },
        })

        if (result.error) {
          console.error(`[Cron] Failed to send balance reminder for booking ${booking.id}:`, result.error)
          results.errors++
        } else if (result.sent) {
          results.sent++
        } else {
          // requiresApproval or deduped
          results.skipped++
        }
      } catch (smsError) {
        console.error(`[Cron] Unexpected error sending balance reminder for booking ${booking.id}:`, smsError)
        results.errors++
      }
    }

    console.warn('[Cron] booking-balance-reminders completed:', results)

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('[Cron] Fatal error in booking-balance-reminders:', error)
    return NextResponse.json(
      { error: 'Failed to process booking balance reminders', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Vercel cron invokes GET; keep POST for backward compatibility
export const GET = handler
export const POST = handler
