import { NextResponse } from 'next/server'
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'
import { jobQueue } from '@/lib/unified-job-queue'

// Vercel Cron: 0 * * * 1 (hourly on Mondays, UTC). Gates on 09:00 Europe/London so it fires
// once per Monday regardless of DST; the weekly idempotency key makes any double-fire or
// retry harmless. Builds one weekly_summary outbox row for the previous 7 locked business
// days and lets the outbox processor deliver it. No individual scores in the email (spec 7).
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
  if (nowLocal.getDay() !== 1 || nowLocal.getHours() !== 9) {
    return NextResponse.json({ skipped: true, reason: 'Not Monday 09:00 London' })
  }

  const settings = await getChecklistSettings()
  if (!settings.moduleEnabled) {
    return NextResponse.json({ skipped: true, reason: 'Module disabled' })
  }

  const db = createAdminClient()
  const today = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')
  const from = formatInTimeZone(new Date(nowUtc.getTime() - 7 * 24 * 3600 * 1000), TIMEZONE, 'yyyy-MM-dd')
  const isoWeek = formatInTimeZone(nowUtc, TIMEZONE, "RRRR-'W'II")

  // Locked instances over the previous week (locked = the business day has closed).
  const { data: instances } = await db
    .from('checklist_task_instances')
    .select('state, was_late, value_breach, value_recorded, value_unit, title_snapshot, business_date')
    .gte('business_date', from)
    .lt('business_date', today)
    .not('locked_at', 'is', null)

  const rows = instances ?? []
  const done = rows.filter((r) => r.state === 'done').length
  const missed = rows.filter((r) => r.state === 'missed').length
  const late = rows.filter((r) => r.state === 'done' && r.was_late).length
  const denom = done + missed
  const completionPct = denom > 0 ? Math.round((done / denom) * 100) : null
  const breaches = rows.filter((r) => r.value_breach)

  const { data: expectations } = await db
    .from('checklist_spot_check_expectations')
    .select('expected')
    .gte('business_date', from)
    .lt('business_date', today)
  const expected = (expectations ?? []).reduce((sum, e) => sum + (e.expected as number), 0)

  const { count: recorded } = await db
    .from('checklist_spot_checks')
    .select('id', { count: 'exact', head: true })
    .gte('business_date', from)
    .lt('business_date', today)
    .eq('state', 'recorded')

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
  await db.from('checklist_email_outbox').upsert(
    {
      email_type: 'weekly_summary',
      source_type: 'week',
      source_id: isoWeek,
      idempotency_key: `weekly_summary:${isoWeek}`,
      to_addresses: [to],
      subject: `The Anchor checklists, weekly summary (${isoWeek})`,
      body_html: bodyHtml,
      status: settings.emailsEnabled ? 'pending' : 'held',
      next_attempt_at: nowUtc.toISOString(),
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true },
  )

  if (settings.emailsEnabled) {
    await jobQueue.enqueue('checklist_email_outbox_process', {}, { unique: `checklist_outbox:weekly:${isoWeek}` })
  }

  return NextResponse.json({
    ok: true,
    isoWeek,
    completionPct,
    breaches: breaches.length,
    spotChecks: { recorded: recorded ?? 0, expected },
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  })
}
