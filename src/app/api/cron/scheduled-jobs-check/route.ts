import { NextRequest, NextResponse } from 'next/server'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron/run-recorder'
import { buildScheduledJobsCheckEmail, checkScheduledJobs } from '@/lib/cron/scheduled-jobs-check'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Daily: did the scheduled jobs run? (BK-116, customer bookings review of 24 October 2026.)
 *
 * Reads the last 24 hours of run records for the jobs in MONITORED_CRON_JOBS and the job queue,
 * and emails CRON_ALERT_EMAIL (owner decision D17) only when something needs a look: a job that
 * went quiet, failed, was cut off at its time limit, or reported items it could not handle, or
 * queued jobs that failed or are stuck. A quiet day sends nothing. One email per London day,
 * however many times the route is called.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'scheduled-jobs-check'
const CLAIM_TTL_HOURS = 36

async function handleScheduledJobsCheck(request: NextRequest): Promise<Response> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const report = await checkScheduledJobs(supabase, now)

  if (report.problemCount === 0) {
    return NextResponse.json({ success: true, problems: 0, emailed: false })
  }

  const alertEmail = process.env.CRON_ALERT_EMAIL
  if (!alertEmail) {
    // console.error, not logger.warn: warnings are silent in production and this is the one
    // place that would have told someone.
    console.error(`[${JOB_NAME}] CRON_ALERT_EMAIL is not set; ${report.problemCount} problem(s) were NOT emailed`)
    return NextResponse.json({ success: true, problems: report.problemCount, emailed: false, alert: 'not_configured' })
  }

  const onceKey = `${JOB_NAME}:${getTodayIsoDate()}`
  const requestHash = computeIdempotencyRequestHash({ onceKey })
  let claimed = false
  try {
    const claim = await claimIdempotencyKey(supabase, onceKey, requestHash, CLAIM_TTL_HOURS)
    if (claim.state !== 'claimed') {
      return NextResponse.json({ success: true, problems: report.problemCount, emailed: false, alert: 'already_sent_today' })
    }
    claimed = true
  } catch (claimError) {
    logger.error('Scheduled jobs check could not claim today\'s email; sending it unclaimed', {
      error: claimError instanceof Error ? claimError : new Error(String(claimError)),
    })
  }

  const email = buildScheduledJobsCheckEmail(report, process.env.NODE_ENV ?? 'unknown')
  const sent = await sendEmail({ to: alertEmail, subject: email.subject, html: email.html, text: email.text })

  if (claimed) {
    try {
      if (sent.success) {
        await persistIdempotencyResponse(supabase, onceKey, requestHash, { state: 'emailed', problems: report.problemCount }, CLAIM_TTL_HOURS)
      } else {
        await releaseIdempotencyClaim(supabase, onceKey, requestHash)
      }
    } catch (settleError) {
      logger.error('Scheduled jobs check could not settle today\'s email claim', {
        error: settleError instanceof Error ? settleError : new Error(String(settleError)),
      })
    }
  }

  if (!sent.success) {
    // A failed run, so the run recorder emails about it too, if email works at all.
    return NextResponse.json(
      { success: false, problems: report.problemCount, emailed: false, error: `The check email was not sent: ${sent.error ?? 'unknown'}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true, problems: report.problemCount, emailed: true })
}

export const GET = withCronRun(JOB_NAME, handleScheduledJobsCheck, { recording: 'every_run' })
