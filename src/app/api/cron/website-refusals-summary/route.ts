import { NextRequest, NextResponse } from 'next/server'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { buildDailyFunnelEmail, loadDailyFunnelSummary, summaryNeedsSending } from '@/lib/booking-funnel/daily-summary'
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
 * one email each. Sent only when something was turned away; one email per London day however
 * often this is called. Codes and counts only.
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
