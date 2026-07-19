import { NextResponse } from 'next/server'
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { jobQueue } from '@/lib/unified-job-queue'

// Vercel Cron: 0 4 * * * (UTC). Re-gates on a 04:00-06:00 Europe/London window to absorb
// DST, then enqueues the day's checklist jobs into the existing every-minute job queue.
// All logic lives in the job handlers; this route only knocks on the door.
const TIMEZONE = 'Europe/London'

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowUtc = new Date()
  const nowLocal = toZonedTime(nowUtc, TIMEZONE)
  const localHour = nowLocal.getHours()
  if (localHour < 4 || localHour > 6) {
    return NextResponse.json({
      skipped: true,
      reason: `Local hour ${localHour} is outside the 04:00-06:00 window`,
      localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
    })
  }

  // The upcoming business day is today's London calendar date (business day D runs
  // D 06:00 -> D+1 06:00; at 04:00-05:00 we are just before D 06:00).
  const businessDate = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')

  const generate = await jobQueue.enqueue(
    'checklist_generate_day',
    { businessDate },
    { unique: `checklist_generate:${businessDate}` },
  )
  const sweep = await jobQueue.enqueue(
    'checklist_sweep',
    {},
    { unique: `checklist_sweep:${businessDate}` },
  )
  const outbox = await jobQueue.enqueue(
    'checklist_email_outbox_process',
    {},
    { unique: `checklist_outbox:${businessDate}` },
  )

  return NextResponse.json({
    ok: true,
    businessDate,
    enqueued: { generate: generate.jobId ?? null, sweep: sweep.jobId ?? null, outbox: outbox.jobId ?? null },
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  })
}
