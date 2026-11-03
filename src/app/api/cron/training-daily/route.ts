import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron/run-recorder'
import { runTrainingDaily } from '@/lib/training/daily-job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Retrying a certificate pack renders it, which can start a browser from cold.
export const maxDuration = 300

const JOB_NAME = 'training-daily'

/**
 * The staff training daily job (build contract 5.6), scheduled in vercel.json at 09:00 UTC
 * (09:00 London in winter, 10:00 in summer). Vercel only: not in the GitHub cron workflows.
 * The work is in src/lib/training/daily-job.ts: the assignment sweep (new cycles only while
 * `training_auto_assign_enabled` is on), finishing confirmations, certificate retries, and, only
 * while `training_emails_enabled` is on, the staff reminders and the manager email. Every email
 * goes through sendEmail, so every kill switch applies.
 *
 * Answers 200 when everything went, 207 when some items failed (counted for the daily scheduled
 * jobs check), and 500 when a whole stage failed, which emails CRON_ALERT_EMAIL through
 * withCronRun. Ids and counts only in the answer.
 */
async function runTrainingDailyRoute(request: NextRequest): Promise<NextResponse> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const run = await runTrainingDaily()
  const status = run.failedStages.length > 0 ? 500 : run.errors.length > 0 ? 207 : 200
  return NextResponse.json(
    {
      success: status === 200,
      ...(run.failedStages.length > 0 ? { error: `Training daily stages failed: ${run.failedStages.join(', ')}` } : {}),
      today: run.today,
      emailsEnabled: run.emailsEnabled,
      autoAssignEnabled: run.autoAssignEnabled,
      suspended: run.suspended,
      created: run.sweep?.created ?? 0,
      cancelled: run.sweep?.cancelled ?? 0,
      updated: run.sweep?.updated ?? 0,
      finalised: run.finalised,
      certificatesPrepared: run.certificatesPrepared,
      certificatesFailed: run.certificatesFailed,
      staffEmailsSent: run.staffEmailsSent,
      staffEmailsUncertain: run.staffEmailsUncertain,
      staffEmailsSuspended: run.staffEmailsSuspended,
      staffEmailsRefused: run.staffEmailsRefused,
      staffEmailsProviderRefused: run.staffEmailsProviderRefused,
      staffEmailsAlreadyClaimed: run.staffEmailsAlreadyClaimed,
      managerEmailSent: run.managerEmailSent,
      managerItems: run.managerItems,
      managerOutcome: run.managerOutcome,
      failedStages: run.failedStages,
      failedItems: run.errors.length,
      errors: run.errors.slice(0, 20),
      deadline: run.deadline,
    },
    { status }
  )
}

// A run record per run and a failure email when the run fails (BK-116).
export const GET = withCronRun(JOB_NAME, runTrainingDailyRoute, {
  recording: 'every_run',
  itemFailures: (body) => Number(body.failedItems ?? 0),
})
