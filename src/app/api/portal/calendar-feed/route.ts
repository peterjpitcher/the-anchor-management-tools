import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { verifyCalendarToken } from '@/lib/portal/calendar-token'
import {
  foldLine,
  escapeICS,
  formatDeptLabel,
  buildVEvent,
  findMostRecentPublish,
  VTIMEZONE_EUROPE_LONDON,
  ICS_CALENDAR_REFRESH_LINES,
  type PublishedShiftRow,
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

  // Last 4 weeks to next 12 weeks (QA-015: use London timezone)
  const today = getTodayIsoDate()
  const todayDate = new Date(today + 'T12:00:00Z')
  const from = new Date(todayDate)
  from.setUTCDate(from.getUTCDate() - 28)
  const to = new Date(todayDate)
  to.setUTCDate(to.getUTCDate() + 84)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = to.toISOString().split('T')[0]

  // ── QA-005: Lightweight ETag pre-check before full ICS generation ──
  const { data: meta } = await supabase
    .from('rota_published_shifts')
    .select('published_at')
    .eq('employee_id', employeeId)
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { count } = await supabase
    .from('rota_published_shifts')
    .select('*', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)

  const metaEtag = `"meta-${createHash('sha256').update(`${meta?.published_at ?? 'none'}-${count ?? 0}`).digest('hex').substring(0, 32)}"`

  const ifNoneMatch = req.headers.get('if-none-match')
  if (ifNoneMatch === metaEtag) {
    return new Response(null, { status: 304, headers: { 'ETag': metaEtag } })
  }

  // ── Full query (QA-008: explicit column selection) ──
  // Include cancelled shifts so Google Calendar receives explicit STATUS:CANCELLED VEVENTs
  // and removes them, rather than silently leaving stale events when UIDs disappear.
  const { data: shifts, error: shiftsError } = await supabase
    .from('rota_published_shifts')
    .select('id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name, published_at')
    .eq('employee_id', employeeId)
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)
    .order('shift_date')
    .order('start_time')

  if (shiftsError) {
    return new Response('Error loading shifts', { status: 500 })
  }

  const typedShifts = (shifts ?? []) as unknown as PublishedShiftRow[]

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

  for (const shift of typedShifts) {
    const deptLabel = formatDeptLabel(shift.department)

    const summary = [
      'Shift at The Anchor',
      deptLabel ? `(${deptLabel})` : null,
      shift.name ? `— ${shift.name}` : null,
    ].filter(Boolean).join(' ')

    const descParts: string[] = [`Department: ${deptLabel || (shift.department ?? '')}`]
    if (shift.status === 'sick') descParts.push('Status: Sick')
    if (shift.status === 'cancelled') descParts.push('Status: Cancelled')
    if (shift.notes) descParts.push(`Notes: ${shift.notes}`)

    lines.push(...buildVEvent({ shift, uidPrefix: 'staff-shift', summary, descriptionParts: descParts }))
  }

  lines.push('END:VCALENDAR')

  const ics = lines.map(foldLine).join('\r\n')

  // Last-Modified: most recent published_at across all returned shifts
  const mostRecentPublish = findMostRecentPublish(typedShifts)
  const lastModifiedHeader = mostRecentPublish
    ? mostRecentPublish.toUTCString()
    : new Date().toUTCString()

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${empName.replace(/\s+/g, '-')}-shifts.ics"`,
      'Cache-Control': 'max-age=300, stale-while-revalidate=600',
      'ETag': metaEtag,
      'Last-Modified': lastModifiedHeader,
    },
  })
}
