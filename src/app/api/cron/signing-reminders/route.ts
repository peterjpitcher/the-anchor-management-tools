import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron/run-recorder'
import { runSigningReminders } from '@/lib/signing/reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Finishing a signed document renders its signing record page, which starts a browser.
export const maxDuration = 300

const JOB_NAME = 'signing-reminders'

/**
 * Daily signing housekeeping: reminders at 3 and 7 days, expiry at 30 days with a note to the
 * sender, and a sweep that finishes any signed document whose finishing step did not complete.
 * Email only, through sendEmail, so every kill switch applies.
 *
 * Wrapped in withCronRun (staff training build, November 2026) so each run leaves a
 * `cron_job_runs` row and the daily scheduled jobs check notices a run that failed or stopped.
 * A run that throws answers 500, which withCronRun emails to CRON_ALERT_EMAIL (at most once an
 * hour), so the route no longer sends its own failure email as well. Items that failed answer
 * 207 and are counted; the runner still emails its own list of them.
 */
async function runSigningRemindersRoute(request: NextRequest): Promise<NextResponse> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const run = await runSigningReminders()
    return NextResponse.json({ success: run.errors.length === 0, ...run }, { status: run.errors.length === 0 ? 200 : 207 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Signing reminders failed' },
      { status: 500 }
    )
  }
}

export const GET = withCronRun(JOB_NAME, runSigningRemindersRoute, {
  recording: 'every_run',
  itemFailures: (body) => (Array.isArray(body.errors) ? body.errors.length : 0),
})
