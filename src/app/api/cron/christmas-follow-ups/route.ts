import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron/run-recorder'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { runChristmasLeadFollowUps } from '@/lib/table-bookings/christmas-follow-ups'
import { describeDbError } from '@/lib/table-bookings/christmas-leads'

/**
 * Daily at 10:00 London: the one follow-up email to people who started a Christmas dinner booking
 * online and did not finish, and the 30-day clear-out of those leads (Christmas funnel spec, owner
 * decisions 5 and 8 of 10 November 2026). The rules are in src/lib/table-bookings/christmas-follow-ups.ts.
 *
 * vercel.json runs it at 09:00 and at 10:00 UTC. Only the run that falls at 10:00 London does
 * anything (09:00 UTC in summer time, 10:00 UTC in winter); the other answers not_due at once.
 * No email to the owner on success; a failed run alerts through withCronRun.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const JOB_NAME = 'christmas-follow-ups'

async function runChristmasFollowUps(request: NextRequest): Promise<Response> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runChristmasLeadFollowUps({ db: createAdminClient() })
    if (result.state === 'ran') {
      logger.info('Christmas follow-ups ran', { metadata: { ...result } })
    }
    return NextResponse.json({ success: true, result })
  } catch (error) {
    logger.error('Christmas follow-ups failed', {
      error: error instanceof Error ? error : new Error(describeDbError(error).message),
      metadata: describeDbError(error),
    })
    return NextResponse.json({ success: false, error: 'Christmas follow-ups failed' }, { status: 500 })
  }
}

// A run record per run and a failure email when the run fails (BK-116).
export const GET = withCronRun(JOB_NAME, runChristmasFollowUps, {
  recording: 'every_run',
  itemFailures: (body) => {
    const result = body.result as { errors?: number; refused?: number; uncertain?: number } | undefined
    return Number(result?.errors ?? 0) + Number(result?.refused ?? 0) + Number(result?.uncertain ?? 0)
  },
})
