import { NextRequest, NextResponse } from 'next/server'
import { reportCronFailure } from '@/lib/cron/alerting'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { runSigningReminders } from '@/lib/signing/reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Finishing a signed document renders its signing record page, which starts a browser.
export const maxDuration = 300

/**
 * Daily signing housekeeping: reminders at 3 and 7 days, expiry at 30 days with a note to the
 * sender, and a sweep that finishes any signed document whose finishing step did not complete.
 * Email only, through sendEmail, so every kill switch applies.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const run = await runSigningReminders()
    return NextResponse.json({ success: run.errors.length === 0, ...run }, { status: run.errors.length === 0 ? 200 : 207 })
  } catch (error) {
    try {
      await reportCronFailure('signing-reminders', error)
    } catch {
      // Nothing more to do: the response below carries the failure.
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Signing reminders failed' },
      { status: 500 }
    )
  }
}
