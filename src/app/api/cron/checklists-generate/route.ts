import { NextResponse } from 'next/server'
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { jobQueue } from '@/lib/unified-job-queue'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'

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

  // Seasonal boundary reminder (spec 4 / decision 27): on the first day of the Autumn/Winter
  // window and the first day out of it, nudge the manager to check the seasonal tasks are in
  // the right active state. One outbox row per boundary date (idempotency key), module-gated.
  let seasonReminder: string | null = null
  const settings = await getChecklistSettings()
  if (settings.moduleEnabled) {
    const mmdd = businessDate.slice(5)
    if (mmdd === settings.autumnWinterStart || mmdd === settings.autumnWinterEnd) {
      const db = createAdminClient()
      const to = process.env.CHECKLIST_MANAGER_EMAIL || 'manager@the-anchor.pub'
      await db.from('checklist_email_outbox').upsert(
        {
          email_type: 'system_alert',
          source_type: 'season',
          source_id: businessDate,
          idempotency_key: `season_boundary:${businessDate}`,
          to_addresses: [to],
          subject: 'The Anchor checklists: season has changed, review seasonal tasks',
          status: settings.emailsEnabled ? 'pending' : 'held',
          next_attempt_at: nowUtc.toISOString(),
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      )
      seasonReminder = businessDate
    }
  }

  return NextResponse.json({
    ok: true,
    businessDate,
    enqueued: { generate: generate.jobId ?? null, sweep: sweep.jobId ?? null, outbox: outbox.jobId ?? null },
    seasonReminder,
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  })
}
