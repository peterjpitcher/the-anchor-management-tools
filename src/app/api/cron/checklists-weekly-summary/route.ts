import { NextResponse } from 'next/server'
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'
import { queueManagerReportEmail } from '@/lib/manager-report/queue'

// Prepare the checklist snapshot at 08:00 London on Friday for the combined 09:00 report.
const TIMEZONE = 'Europe/London'

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowUtc = new Date()
  const nowLocal = toZonedTime(nowUtc, TIMEZONE)
  if (nowLocal.getDay() !== 5 || nowLocal.getHours() !== 8) {
    return NextResponse.json({ skipped: true, reason: 'Not Friday 08:00 London' })
  }

  const settings = await getChecklistSettings()
  if (!settings.moduleEnabled || !settings.emailsEnabled) {
    return NextResponse.json({ skipped: true, reason: 'Checklist module or emails disabled' })
  }

  const db = createAdminClient()
  const today = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')
  const from = formatInTimeZone(new Date(nowUtc.getTime() - 7 * 24 * 3600 * 1000), TIMEZONE, 'yyyy-MM-dd')
  const isoWeek = formatInTimeZone(nowUtc, TIMEZONE, "RRRR-'W'II")

  // Locked instances over the previous week (locked = the business day has closed).
  const { data: instances, error: instancesError } = await db
    .from('checklist_task_instances')
    .select('state, was_late, value_breach, value_recorded, value_unit, title_snapshot, business_date')
    .gte('business_date', from)
    .lt('business_date', today)
    .not('locked_at', 'is', null)

  if (instancesError) return NextResponse.json({ error: 'Could not read checklist completion' }, { status: 500 })
  const rows = instances ?? []
  const done = rows.filter((r) => r.state === 'done').length
  const missed = rows.filter((r) => r.state === 'missed').length
  const late = rows.filter((r) => r.state === 'done' && r.was_late).length
  const denom = done + missed
  const completionPct = denom > 0 ? Math.round((done / denom) * 100) : null
  const breaches = rows.filter((r) => r.value_breach)

  const { data: expectations, error: expectationsError } = await db
    .from('checklist_spot_check_expectations')
    .select('expected')
    .gte('business_date', from)
    .lt('business_date', today)
  if (expectationsError) return NextResponse.json({ error: 'Could not read checklist expectations' }, { status: 500 })
  const expected = (expectations ?? []).reduce((sum, e) => sum + (e.expected as number), 0)

  const { count: recorded, error: recordedError } = await db
    .from('checklist_spot_checks')
    .select('id', { count: 'exact', head: true })
    .gte('business_date', from)
    .lt('business_date', today)
    .eq('state', 'recorded')

  if (recordedError) return NextResponse.json({ error: 'Could not read spot checks' }, { status: 500 })

  const breachRows = breaches
    .map(
      (b) =>
        `<li>${esc(b.title_snapshot as string)}: ${b.value_recorded ?? '?'}${esc((b.value_unit as string | null) ?? '')} on ${esc(b.business_date as string)}</li>`,
    )
    .join('')

  const bodyHtml = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <h2>The Anchor checklists, week to ${esc(today)}</h2>
    <p>Completion: ${completionPct == null ? 'no data' : completionPct + '%'} (${done} done, ${missed} missed, ${late} late).</p>
    <p>Spot checks recorded: ${recorded ?? 0} of ${expected} expected.</p>
    <h3>Readings out of range (${breaches.length})</h3>
    <ul>${breachRows || '<li>None</li>'}</ul>
  </div>`

  const to = process.env.CHECKLIST_MANAGER_EMAIL || 'manager@the-anchor.pub'
  const queued = await queueManagerReportEmail({
    section: 'checklist_summary',
    key: today,
    to,
    subject: `The Anchor checklists, week to ${today}`,
    html: bodyHtml,
    metadata: { snapshot_date: today, completion_percent: completionPct, done, missed, late,
      breaches: breaches.length, spot_checks_recorded: recorded ?? 0, spot_checks_expected: expected },
  })
  if (!queued.success) {
    return NextResponse.json({ error: queued.error || 'Could not queue checklist summary' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    queued: true,
    isoWeek,
    completionPct,
    breaches: breaches.length,
    spotChecks: { recorded: recorded ?? 0, expected },
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  })
}
