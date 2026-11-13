import { NextRequest, NextResponse } from 'next/server'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { buildDailyFunnelEmail, loadDailyFunnelSummary, summaryNeedsSending } from '@/lib/booking-funnel/daily-summary'
import {
  QUIET_FORM_CLAIM_TTL_HOURS,
  QUIET_FORM_WATCH,
  buildQuietFormEmail,
  loadQuietFormCounts,
  quietFormAlertKey,
} from '@/lib/booking-funnel/quiet-forms'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron/run-recorder'
import { getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { sendEmail } from '@/lib/email/emailService'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { MANAGER_ALERT_RECIPIENT } from '@/lib/money-alerts'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Daily: what the website turned away yesterday (BK-101, customer bookings review of 24 October
 * 2026). Owner decision D17: website refusals go to the manager inbox as one summary a day, not
 * one email each. Sent only when something was turned away or held up; one email per London day
 * however often this is called. Codes and counts only.
 *
 * The same run checks for a quiet form (growth review of 13 November 2026): a website form that
 * was started or submitted over the last seven days with nothing sent. That alert is a separate
 * email with its own once-a-day claim, checked first and on its own, so neither email can stop
 * the other.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'website-refusals-summary'
const CLAIM_TTL_HOURS = 36

function reportsUrl(): string | null {
  try {
    return `${getAppUrl()}/table-bookings/reports`
  } catch {
    return null
  }
}

type AdminClient = ReturnType<typeof createAdminClient>
type QuietFormOutcome = { form: string; alert: 'sent' | 'already_sent' | 'not_needed' | 'failed'; error?: string }

/**
 * At most one email per quiet form a day, and one per day of new signals (see quietFormAlertKey).
 * Never throws: a count that cannot be made or an email that does not send is reported in the
 * run's answer, which fails the run so it is seen, and the alert is still owed on the next run.
 */
async function alertQuietForms(supabase: AdminClient, yesterday: string): Promise<QuietFormOutcome[]> {
  const outcomes: QuietFormOutcome[] = []
  for (const form of QUIET_FORM_WATCH) {
    try {
      const counts = await loadQuietFormCounts(supabase, form, yesterday)
      const onceKey = quietFormAlertKey(counts)
      if (!onceKey) {
        outcomes.push({ form, alert: 'not_needed' })
        continue
      }

      const requestHash = computeIdempotencyRequestHash({ onceKey })
      const claim = await claimIdempotencyKey(supabase, onceKey, requestHash, QUIET_FORM_CLAIM_TTL_HOURS)
      if (claim.state !== 'claimed') {
        outcomes.push({ form, alert: 'already_sent' })
        continue
      }

      const email = buildQuietFormEmail(counts)
      const sent = await sendEmail({ to: MANAGER_ALERT_RECIPIENT, subject: email.subject, html: email.html, text: email.text })
      if (sent.success) {
        await persistIdempotencyResponse(supabase, onceKey, requestHash, { state: 'emailed' }, QUIET_FORM_CLAIM_TTL_HOURS)
        outcomes.push({ form, alert: 'sent' })
      } else {
        // Freed, so the next run tries again, today or tomorrow.
        await releaseIdempotencyClaim(supabase, onceKey, requestHash)
        outcomes.push({ form, alert: 'failed', error: `The alert email was not sent: ${sent.error ?? 'unknown'}` })
      }
    } catch (error) {
      logger.error('Quiet form check failed', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { form },
      })
      outcomes.push({ form, alert: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return outcomes
}

async function sendWebsiteRefusalsSummary(request: NextRequest): Promise<Response> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const yesterday = shiftIsoDate(getTodayIsoDate(), -1)
  if (!yesterday) {
    return NextResponse.json({ success: false, error: 'Could not work out yesterday' }, { status: 500 })
  }

  const supabase = createAdminClient()
  // First, and on its own: the summary below can end the run early or throw.
  const quietForms = await alertQuietForms(supabase, yesterday)
  const summaryResponse = await sendDailySummary(supabase, yesterday)

  const body = { ...((await summaryResponse.json()) as Record<string, unknown>), quietForms }
  const quietFailure = quietForms.find((outcome) => outcome.alert === 'failed')
  if (quietFailure && summaryResponse.status < 400) {
    // A failed run: the run recorder emails CRON_ALERT_EMAIL about it.
    return NextResponse.json(
      { ...body, success: false, error: `Quiet form check for ${quietFailure.form}: ${quietFailure.error ?? 'failed'}` },
      { status: 502 },
    )
  }
  return NextResponse.json(body, { status: summaryResponse.status })
}

async function sendDailySummary(supabase: AdminClient, yesterday: string): Promise<NextResponse> {
  const summary = await loadDailyFunnelSummary(supabase, yesterday)
  const counts = {
    refused: summary.refusedTotal,
    failed: summary.failedTotal,
    searches: summary.availability.searches,
    noTables: summary.availability.noTables,
    couldNotCheck: summary.availability.couldNotCheck,
  }

  if (!summaryNeedsSending(summary)) {
    return NextResponse.json({ success: true, date: yesterday, ...counts, emailed: false })
  }

  const onceKey = `${JOB_NAME}:${yesterday}`
  const requestHash = computeIdempotencyRequestHash({ onceKey })
  let claimed = false
  try {
    const claim = await claimIdempotencyKey(supabase, onceKey, requestHash, CLAIM_TTL_HOURS)
    if (claim.state !== 'claimed') {
      return NextResponse.json({ success: true, date: yesterday, ...counts, emailed: false, alert: 'already_sent' })
    }
    claimed = true
  } catch (claimError) {
    logger.error('Website refusals summary could not claim its day; sending it unclaimed', {
      error: claimError instanceof Error ? claimError : new Error(String(claimError)),
    })
  }

  const email = buildDailyFunnelEmail(summary, reportsUrl())
  const sent = await sendEmail({ to: MANAGER_ALERT_RECIPIENT, subject: email.subject, html: email.html, text: email.text })

  if (claimed) {
    try {
      if (sent.success) {
        await persistIdempotencyResponse(supabase, onceKey, requestHash, { state: 'emailed', ...counts }, CLAIM_TTL_HOURS)
      } else {
        await releaseIdempotencyClaim(supabase, onceKey, requestHash)
      }
    } catch (settleError) {
      logger.error('Website refusals summary could not settle its claim', {
        error: settleError instanceof Error ? settleError : new Error(String(settleError)),
      })
    }
  }

  if (!sent.success) {
    // A failed run: the run recorder emails CRON_ALERT_EMAIL about it.
    return NextResponse.json(
      { success: false, date: yesterday, ...counts, emailed: false, error: `The summary email was not sent: ${sent.error ?? 'unknown'}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true, date: yesterday, ...counts, emailed: true })
}

export const GET = withCronRun(JOB_NAME, sendWebsiteRefusalsSummary, { recording: 'every_run' })
