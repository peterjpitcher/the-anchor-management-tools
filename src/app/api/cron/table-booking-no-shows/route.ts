import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron/run-recorder'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { runNoShowSweep, type NoShowSweepResult } from '@/lib/table-bookings/no-show-sweep'
import { runNoShowFollowUps, type NoShowFollowUpRunResult } from '@/lib/table-bookings/no-show-follow-up'

/**
 * Hourly: table booking no-shows (owner decisions of 22 November 2026).
 *
 *  1. The end-of-day sweep: every table booking for a trading day that has ended, still confirmed
 *     with no outcome, is marked a no-show (src/lib/table-bookings/no-show-sweep.ts). Hourly, so a
 *     day is swept within the hour after it ends, including a night that ran past midnight.
 *  2. The morning-after email, on the run that falls at 10:00 London only
 *     (src/lib/table-bookings/no-show-follow-up.ts). Every other run answers not_due for it.
 *
 * The sweep runs first, so the 10:00 run emails for last night's automatic no-shows too. One half
 * failing does not stop the other. No email to the owner on success; a failed run, or a booking
 * that could not be handled, alerts through withCronRun.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const JOB_NAME = 'table-booking-no-shows'

function asError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String((error as { message?: unknown } | null)?.message ?? error))
}

async function runTableBookingNoShows(request: NextRequest): Promise<Response> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  let failed = 0

  let sweep: NoShowSweepResult | null = null
  try {
    sweep = await runNoShowSweep({ db })
    if (sweep.state === 'held') {
      logger.error('End-of-day no-show sweep held: the opening hours could not be read', { metadata: { ...sweep } })
    } else if (sweep.marked > 0 || sweep.errors > 0) {
      logger.info('End-of-day no-show sweep ran', { metadata: { ...sweep } })
    }
  } catch (error) {
    failed += 1
    logger.error('End-of-day no-show sweep failed', { error: asError(error) })
  }

  let followUps: NoShowFollowUpRunResult | null = null
  try {
    followUps = await runNoShowFollowUps({ db })
    if (followUps.state === 'ran') {
      logger.info('No-show follow-up emails ran', { metadata: { ...followUps } })
    }
  } catch (error) {
    failed += 1
    logger.error('No-show follow-up emails failed', { error: asError(error) })
  }

  const itemFailures =
    (sweep?.state === 'ran' ? sweep.errors : 0) +
    (followUps?.state === 'ran' ? followUps.errors + followUps.refused + followUps.uncertain : 0)

  if (failed > 0) {
    return NextResponse.json(
      { success: false, error: 'Table booking no-shows job failed', sweep, followUps, itemFailures },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true, sweep, followUps, itemFailures })
}

// One run record an hour, a record for each run that failed or left something undone, and a
// failure email (BK-116).
export const GET = withCronRun(JOB_NAME, runTableBookingNoShows, {
  recording: 'hourly',
  itemFailures: (body) => Number(body.itemFailures ?? 0),
})
