import { NextResponse } from 'next/server'
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'
import { getPublishedShiftsForDate } from '@/lib/checklists/rota'
import { resolveCloser } from '@/lib/checklists/accountability'
import { displayName } from '@/lib/employees/display-name'
import { jobQueue } from '@/lib/unified-job-queue'

// Vercel Cron: 0 8,9 * * * (UTC). Gates on 09:00 Europe/London so exactly one of the two
// firings does the work whatever the season: in BST 08:00 UTC is 09:00 London and 09:00 UTC
// is 10:00; in GMT it is the other way round. Same pattern as the weekly summary.
//
// Reports the night that has just finished: if its closing checklist had tasks and not one
// of them was ticked, the manager hears about it that morning. Five nights lost their entire
// closing list between July and August 2026 and nothing raised a word, because the only
// signal was a venue-wide weekly percentage that rounded a total failure into 88%.
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
  if (nowLocal.getHours() !== 9) {
    return NextResponse.json({ skipped: true, reason: 'Not 09:00 London' })
  }

  const settings = await getChecklistSettings()
  if (!settings.moduleEnabled) {
    return NextResponse.json({ skipped: true, reason: 'Module disabled' })
  }

  // The night that has just ended. At 09:00 the current business date is today, so the
  // closedown being reported on is yesterday's. Stepping back a whole day before formatting
  // in London keeps this right across both clock changes: 24 hours before 09:00 is 08:00 or
  // 10:00 London, and both still land on the previous calendar date.
  const businessDate = formatInTimeZone(
    new Date(nowUtc.getTime() - 24 * 3600 * 1000),
    TIMEZONE,
    'yyyy-MM-dd',
  )

  const db = createAdminClient()
  const { data: closeRows, error } = await db
    .from('checklist_task_instances')
    .select('state')
    .eq('business_date', businessDate)
    .eq('slot', 'close')
  if (error) throw error

  const total = closeRows?.length ?? 0
  const done = (closeRows ?? []).filter((r) => r.state === 'done').length

  // Nothing to say when the venue was shut (no closing tasks exist) or someone ticked
  // something. This alert is only for a closedown that left no trace at all.
  if (total === 0 || done > 0) {
    return NextResponse.json({
      ok: true,
      businessDate,
      alerted: false,
      closing: { total, done },
      localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
    })
  }

  // Who was rostered to close, so the manager knows who to ask rather than having to work
  // it out. Best effort: a missing rota must not stop the alert going out.
  let closerName: string | null = null
  try {
    const shifts = await getPublishedShiftsForDate(businessDate)
    const closerId = resolveCloser(shifts)
    if (closerId) {
      const { data: employee } = await db
        .from('employees')
        .select('first_name, last_name, preferred_name')
        .eq('employee_id', closerId)
        .maybeSingle()
      if (employee) closerName = displayName(employee, '') || null
    }
  } catch {
    /* rota unavailable: send the alert without a name rather than not at all */
  }

  const prettyDate = formatInTimeZone(
    new Date(`${businessDate}T12:00:00Z`),
    TIMEZONE,
    'EEEE d MMMM',
  )
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const link = appUrl ? `${appUrl}/checklists/${businessDate}` : `/checklists/${businessDate}`

  const bodyHtml = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <h2>No closing checks were ticked off on ${esc(prettyDate)}</h2>
    <p>All ${total} closing tasks for ${esc(businessDate)} went unticked overnight.</p>
    ${closerName ? `<p>Rostered to close: ${esc(closerName)}.</p>` : ''}
    <p>Worth a word to find out whether the jobs were done and not logged, or missed.</p>
    <p><a href="${esc(link)}">See the night's checklist</a></p>
  </div>`

  const to = process.env.CHECKLIST_MANAGER_EMAIL || 'manager@the-anchor.pub'
  const { error: outboxError } = await db.from('checklist_email_outbox').upsert(
    {
      email_type: 'system_alert',
      source_type: 'closing_night',
      source_id: businessDate,
      // One alert per night, whichever firing gets there first and however often it retries.
      idempotency_key: `closing_none:${businessDate}`,
      to_addresses: [to],
      subject: `The Anchor checklists: no closing checks on ${prettyDate}`,
      body_html: bodyHtml,
      status: settings.emailsEnabled ? 'pending' : 'held',
      next_attempt_at: nowUtc.toISOString(),
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true },
  )
  if (outboxError) throw outboxError

  if (settings.emailsEnabled) {
    await jobQueue.enqueue(
      'checklist_email_outbox_process',
      {},
      { unique: `checklist_outbox:closing:${businessDate}` },
    )
  }

  return NextResponse.json({
    ok: true,
    businessDate,
    alerted: true,
    closing: { total, done },
    closerName,
    localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
  })
}
