import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCalendarToken } from '@/lib/portal/calendar-token'
import {
  icsDate,
  icsTimestamp,
  addOneDay,
  escapeICS,
  foldLine,
  deriveSequence,
  VTIMEZONE_EUROPE_LONDON,
  ICS_CALENDAR_REFRESH_LINES,
} from '@/lib/ics/utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const employeeId = req.nextUrl.searchParams.get('employee_id')
  const token = req.nextUrl.searchParams.get('token')

  if (!employeeId || !token || !verifyCalendarToken(employeeId, token)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()

  // Verify employee exists
  const { data: employee } = await supabase
    .from('employees')
    .select('first_name, last_name')
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (!employee) {
    return new Response('Not found', { status: 404 })
  }

  const empName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Staff'

  // Last 4 weeks to next 12 weeks
  const from = new Date()
  from.setDate(from.getDate() - 28)
  const to = new Date()
  to.setDate(to.getDate() + 84)

  // Include cancelled shifts so Google Calendar receives explicit STATUS:CANCELLED VEVENTs
  // and removes them, rather than silently leaving stale events when UIDs disappear.
  const { data: shifts, error: shiftsError } = await supabase
    .from('rota_published_shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('shift_date', from.toISOString().split('T')[0])
    .lte('shift_date', to.toISOString().split('T')[0])
    .order('shift_date')
    .order('start_time')

  if (shiftsError) {
    return new Response('Error loading shifts', { status: 500 })
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Anchor Management//Staff Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(empName)} — Shifts`,
    'X-WR-TIMEZONE:Europe/London',
    'X-WR-CALDESC:Your published shifts at The Anchor',
    // Refresh hints for Apple Calendar and Outlook; Google Calendar ignores these
    ...ICS_CALENDAR_REFRESH_LINES,
    // VTIMEZONE required by RFC 5545 §3.6.5 when TZID= is used
    ...VTIMEZONE_EUROPE_LONDON,
  ]

  for (const shift of shifts ?? []) {
    const deptLabel = shift.department
      ? (shift.department as string).charAt(0).toUpperCase() + (shift.department as string).slice(1)
      : ''

    const summary = [
      'Shift at The Anchor',
      deptLabel ? `(${deptLabel})` : null,
      shift.name ? `— ${shift.name as string}` : null,
    ].filter(Boolean).join(' ')

    const endDate = shift.is_overnight
      ? addOneDay(shift.shift_date as string)
      : (shift.shift_date as string)
    const dtStart = icsDate(shift.shift_date as string, shift.start_time as string)
    const dtEnd = icsDate(endDate, shift.end_time as string)

    const descParts: string[] = [`Department: ${deptLabel || (shift.department as string)}`]
    if (shift.status === 'sick') descParts.push('Status: Sick')
    if (shift.status === 'cancelled') descParts.push('Status: Cancelled')
    if (shift.notes) descParts.push(`Notes: ${shift.notes as string}`)

    // DTSTAMP per RFC 5545 §3.8.7.2 = last time the event was modified in the calendar store.
    // Use published_at so it only changes when the shift is actually re-published.
    const isCancelled = shift.status === 'cancelled' || shift.status === 'sick'
    const eventDtstamp = shift.published_at
      ? icsTimestamp(shift.published_at as string)
      : icsTimestamp(new Date())
    const lastModified = eventDtstamp
    const icsStatus = isCancelled ? 'CANCELLED' : 'CONFIRMED'

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:staff-shift-${shift.id as string}@anchor-management`)
    lines.push(`DTSTAMP:${eventDtstamp}`)
    lines.push(`DTSTART;TZID=Europe/London:${dtStart}`)
    lines.push(`DTEND;TZID=Europe/London:${dtEnd}`)
    lines.push(`SUMMARY:${escapeICS(summary)}`)
    lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`)
    lines.push(`STATUS:${icsStatus}`)
    lines.push(`LAST-MODIFIED:${lastModified}`)
    lines.push(`SEQUENCE:${deriveSequence(shift.published_at as string | null, isCancelled)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  const ics = lines.map(foldLine).join('\r\n')

  // ETag: SHA-256 of ICS body (truncated to 32 hex chars)
  const etag = `"${createHash('sha256').update(ics).digest('hex').substring(0, 32)}"`

  // Last-Modified: most recent published_at across all returned shifts
  const mostRecentPublish = (shifts ?? [])
    .map(s => s.published_at ? new Date(s.published_at as string) : null)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const lastModifiedHeader = mostRecentPublish
    ? mostRecentPublish.toUTCString()
    : new Date().toUTCString()

  // Conditional GET support
  const ifNoneMatchHeader = req.headers.get('if-none-match')
  const ifModifiedSinceHeader = req.headers.get('if-modified-since')
  const notModified =
    (ifNoneMatchHeader !== null && ifNoneMatchHeader === etag) ||
    (ifModifiedSinceHeader !== null && mostRecentPublish !== null &&
      new Date(ifModifiedSinceHeader) >= mostRecentPublish)

  if (notModified) {
    return new Response(null, {
      status: 304,
      headers: { 'ETag': etag, 'Last-Modified': lastModifiedHeader },
    })
  }

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${empName.replace(/\s+/g, '-')}-shifts.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'ETag': etag,
      'Last-Modified': lastModifiedHeader,
    },
  })
}
