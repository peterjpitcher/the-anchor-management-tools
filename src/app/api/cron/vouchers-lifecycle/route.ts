// Combined voucher lifecycle cron (spec 7.4, F20/F21).
// One vercel.json entry fires at 01,02,10,11 UTC so the two passes land at the
// right London wall-clock hour in both GMT and BST:
//   London 02:00 -> expiry pass (voucher_expire_due)
//   London 11:00 -> reminder pass (sendDueVoucherReminders)
// The other firings are UTC-offset artefacts and no-op with a logged skip.
// Each pass runs at most once per London date, claimed via cron_job_runs
// (job_name + run_key unique) with the shared recoverCronRunLock helper.

import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { persistCronRunResult, recoverCronRunLock } from '@/lib/cron-run-results'
import { reportCronFailure } from '@/lib/cron/alerting'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { sendDueVoucherReminders } from '@/lib/vouchers/reminders'

const JOB_NAME = 'vouchers-lifecycle'
const LONDON_TZ = 'Europe/London'
const STALE_RUN_WINDOW_MINUTES = 30
const EXPIRY_PASS_LONDON_HOUR = 2
const REMINDER_PASS_LONDON_HOUR = 11

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

function getLondonHour(now: Date): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(now)
  return Number.parseInt(formatted, 10)
}

async function runLifecycle(request: Request): Promise<NextResponse> {
  let runContext: { supabase: ReturnType<typeof createAdminClient>; runId: string } | null = null

  try {
    const authResult = authorizeCronRequest(request)
    if (!authResult.authorized) {
      logger.warn('Vouchers lifecycle cron rejected', {
        metadata: { reason: authResult.reason ?? 'unauthorized' }
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const londonToday = getTodayIsoDate()
    const londonHour = getLondonHour(now)
    const pass =
      londonHour === EXPIRY_PASS_LONDON_HOUR
        ? 'expiry'
        : londonHour === REMINDER_PASS_LONDON_HOUR
          ? 'reminders'
          : null

    if (!pass) {
      logger.info('Vouchers lifecycle: no pass scheduled for this London hour', {
        metadata: { londonHour, londonToday }
      })
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'off-hour firing',
        londonHour
      })
    }

    const supabase = createAdminClient()
    const runKey = `${pass}:${londonToday}`
    const lock = await recoverCronRunLock(supabase, {
      jobName: JOB_NAME,
      runKey,
      nowIso: now.toISOString(),
      context: JOB_NAME,
      isRunStale: (startedAt) => {
        const startedAtMs = Date.parse(startedAt || '')
        if (!Number.isFinite(startedAtMs)) {
          return true
        }
        return Date.now() - startedAtMs > STALE_RUN_WINDOW_MINUTES * 60 * 1000
      }
    })

    if (lock.result !== 'acquired' || !lock.runId) {
      logger.info('Vouchers lifecycle: pass already claimed for this London date', {
        metadata: { runKey, lockResult: lock.result }
      })
      return NextResponse.json({ success: true, skipped: true, pass, lockResult: lock.result })
    }

    runContext = { supabase, runId: lock.runId }

    if (pass === 'expiry') {
      const { data, error } = await supabase.rpc('voucher_expire_due', {
        p_london_today: londonToday
      })
      if (error) {
        throw new Error(`voucher_expire_due failed: ${error.message}`)
      }
      const payload = data as { success?: boolean; expired_count?: number; message?: string } | null
      if (!payload?.success) {
        throw new Error(payload?.message || 'voucher_expire_due returned failure')
      }
      const expiredCount = payload.expired_count ?? 0

      await persistCronRunResult(supabase, {
        runId: lock.runId,
        status: 'completed',
        context: JOB_NAME
      })
      logger.info('Vouchers lifecycle: expiry pass complete', {
        metadata: { runKey, expiredCount }
      })
      return NextResponse.json({ success: true, pass, expired: expiredCount })
    }

    const counters = await sendDueVoucherReminders({ londonToday })

    await persistCronRunResult(supabase, {
      runId: lock.runId,
      status: 'completed',
      context: JOB_NAME
    })
    logger.info('Vouchers lifecycle: reminder pass complete', {
      metadata: { runKey, ...counters }
    })
    return NextResponse.json({ success: true, pass, ...counters })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vouchers lifecycle cron failed'
    logger.error('Vouchers lifecycle cron failed', {
      error: error instanceof Error ? error : new Error(message)
    })

    if (runContext) {
      await persistCronRunResult(runContext.supabase, {
        runId: runContext.runId,
        status: 'failed',
        errorMessage: message,
        context: JOB_NAME
      })
    }

    await reportCronFailure(JOB_NAME, error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return runLifecycle(request)
}

export async function POST(request: Request) {
  return runLifecycle(request)
}
