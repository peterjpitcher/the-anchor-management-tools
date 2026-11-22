import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron/run-recorder'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTableBookingWatch } from '@/lib/table-bookings/booking-watch'

/**
 * Hourly: have website table bookings stopped? (Owner decisions, 22 November 2026.)
 *
 * Emails the manager inbox, once per spell, when the website has made no table booking for three
 * days, when it has stopped asking this app for opening times and free tables for six hours, or
 * when the booking routes it calls keep answering with a server error. An hour with nothing wrong
 * sends nothing. The rules, and what they cannot see, are in src/lib/table-bookings/booking-watch.ts.
 *
 * A check that could not be made, or an alert that could not be sent, fails the run: withCronRun
 * records it and emails CRON_ALERT_EMAIL, and the alert is still owed on the next run.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'table-booking-watch'

async function watchTableBookings(request: NextRequest): Promise<Response> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const checks = await runTableBookingWatch(createAdminClient())
  const alertsSent = checks.filter((check) => check.alert === 'sent').length
  const failed = checks.filter((check) => check.alert === 'failed')

  if (failed.length > 0) {
    return NextResponse.json(
      {
        success: false,
        alertsSent,
        checksFailed: failed.length,
        checks,
        error: failed.map((check) => `${check.kind}: ${check.error ?? 'failed'}`).join('; '),
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true, alertsSent, checksFailed: 0, checks })
}

export const GET = withCronRun(JOB_NAME, watchTableBookings, { recording: 'every_run' })
