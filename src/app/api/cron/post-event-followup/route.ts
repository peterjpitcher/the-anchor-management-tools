import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { getSmartFirstName } from '@/lib/sms/bulk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Cron: post-event-followup
 * Runs daily at 11:00 UTC (noon / 12:00 UK BST, 11:00 UK GMT depending on DST).
 *
 * Finds private bookings where event_date was exactly 2 days ago and status
 * is 'completed', then sends a thank-you follow-up SMS to each customer.
 * Uses the SmsQueueService (which enforces opt-in checks, quiet-hours guards,
 * and deduplication) so no customer receives the same message twice even on
 * cron re-runs.
 */
async function handler(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.warn('[Cron] Starting post-event-followup')

    const supabase = createAdminClient()

    // Compute today's date in London time then derive T-2 target date
    const nowLondon = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    const today = new Date(`${nowLondon}T00:00:00.000Z`)
    const twoDaysAgo = new Date(today)
    twoDaysAgo.setUTCDate(today.getUTCDate() - 2)
    const twoDaysAgoIso = twoDaysAgo.toISOString().slice(0, 10)

    // Fetch completed bookings whose event_date was 2 days ago
    const { data: bookings, error: fetchError } = await supabase
      .from('private_bookings')
      .select(
        'id, customer_first_name, customer_name, contact_phone, customer_id, event_type'
      )
      .eq('event_date', twoDaysAgoIso)
      .eq('status', 'completed')
      .is('deleted_at', null)

    if (fetchError) {
      console.error('[Cron] Error fetching bookings for post-event follow-up:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch bookings', details: fetchError },
        { status: 500 }
      )
    }

    console.warn(
      `[Cron] Found ${bookings?.length ?? 0} completed bookings from ${twoDaysAgoIso} requiring a follow-up`
    )

    const results = {
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: 0,
    }

    for (const booking of bookings ?? []) {
      results.processed++

      const smartName = getSmartFirstName(booking.customer_first_name)
      // Use the event_type if available for a personalised message (e.g. "birthday party")
      const eventLabel = booking.event_type?.trim() ? booking.event_type.trim() : 'event'

      const messageBody =
        `The Anchor: Hi ${smartName}, thank you for celebrating your ${eventLabel} with us! ` +
        `We hope you had a wonderful time. We'd love to welcome you back — ` +
        `call us on 01753 682707 or visit the-anchor.pub to book your next visit.`

      try {
        const result = await SmsQueueService.queueAndSend({
          booking_id: booking.id,
          trigger_type: 'post_event_followup',
          template_key: 'private_booking_post_event_followup',
          message_body: messageBody,
          customer_phone: booking.contact_phone ?? undefined,
          customer_name: booking.customer_name ?? '',
          customer_id: booking.customer_id ?? undefined,
          priority: 2,
          metadata: {
            event_date: twoDaysAgoIso,
            event_type: booking.event_type,
          },
        })

        if (result.error) {
          console.error(
            `[Cron] Failed to send post-event follow-up for booking ${booking.id}:`,
            result.error
          )
          results.errors++
        } else if (result.sent) {
          results.sent++
        } else {
          // requiresApproval, suppressed by deduplication, etc.
          results.skipped++
        }
      } catch (smsError) {
        console.error(
          `[Cron] Unexpected error sending post-event follow-up for booking ${booking.id}:`,
          smsError
        )
        results.errors++
      }
    }

    console.warn('[Cron] post-event-followup completed:', results)

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('[Cron] Fatal error in post-event-followup:', error)
    return NextResponse.json(
      {
        error: 'Failed to process post-event follow-ups',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// Vercel cron invokes GET; keep POST for backward compatibility
export const GET = handler
export const POST = handler
