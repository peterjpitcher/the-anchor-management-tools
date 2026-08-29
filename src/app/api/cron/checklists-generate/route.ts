import { NextResponse } from 'next/server'
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { jobQueue } from '@/lib/unified-job-queue'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'

// Vercel Cron: 0 4,5 * * * (UTC). Re-gates on a 04:00-06:00 Europe/London window to absorb
// DST, then enqueues the day's checklist jobs into the existing every-minute job queue.
// All logic lives in the job handlers; this route only knocks on the door.
//
// Two firings, because the sweep has to land after the 05:00 London closing grace ends and a
// single UTC hour cannot do that all year. In BST they are 05:00 and 06:00 London, in GMT
// 04:00 and 05:00, so one of the pair is always at or after 05:00 local. The earlier one
// still generates the day on time; the later one catches last night's closing tasks the
// moment their grace expires instead of leaving them pending for another 23 hours.
// Both passes are safe to repeat: generation reconciles rather than appends, the sweep is
// state-guarded and idempotent, and the queue's unique key only blocks a job while it is
// still pending or processing.
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

  // Generate the upcoming London calendar day's instances before or at its
  // business-day boundary.
  //
  // This is deliberately the plain calendar date, NOT currentBusinessDate(). The
  // run happens at 04:00-05:00 London, before the boundary, so the current
  // business date is still yesterday. Using it here would regenerate the day that
  // is ending instead of preparing the one about to start.
  const businessDate = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')

  const db = createAdminClient()

  // The second firing of the day only exists to run the sweep after the 05:00 London closing
  // grace ends, so do not generate again on top of a run that already settled. Generation is
  // safe to repeat, but a needless second attempt row would become the one the staff screen
  // reads for its status, so a transient failure at 06:00 would blank a day that is already
  // correctly generated. A run that FAILED is deliberately not counted here, which turns the
  // second firing into a free retry.
  const { data: settledRuns } = await db
    .from('checklist_generation_runs')
    .select('id')
    .eq('business_date', businessDate)
    .in('status', ['complete', 'skipped_closed'])
    .limit(1)
  const alreadyGenerated = (settledRuns?.length ?? 0) > 0

  const generate = alreadyGenerated
    ? { jobId: null }
    : await jobQueue.enqueue(
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
    alreadyGenerated,
    enqueued: { generate: generate.jobId ?? null, sweep: sweep.jobId ?? null, outbox: outbox.jobId ?? null },
    seasonReminder,
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  })
}
