import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCalendarToken } from '@/lib/portal/calendar-token'
import {
  icsDate,
  icsTimestamp,
  addOneDay,
  escapeICS,
  foldLine,
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

  // DEFECT-004: destructure error so DB failures return 500 instead of silently returning empty ICS
  const { data: shifts, error: shiftsError } = await supabase
    .from('rota_published_shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('shift_date', from.toISOString().split('T')[0])
    .lte('shift_date', to.toISOString().split('T')[0])
    .neq('status', 'cancelled')
    .order('shift_date')
    .order('start_time')

  if (shiftsError) {
    return new Response('Error loading shifts', { status: 500 })
  }

  const dtstamp = icsTimestamp(new Date())

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Anchor Management//Staff Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(empName)} — Shifts`,
    'X-WR-TIMEZONE:Europe/London',
    'X-WR-CALDESC:Your published shifts at The Anchor',
    // DEFECT-001: refresh hints so calendar apps poll hourly instead of caching for days
    ...ICS_CALENDAR_REFRESH_LINES,
    // DEFECT-003: VTIMEZONE required by RFC 5545 §3.6.5 when TZID= is used
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
    if (shift.notes) descParts.push(`Notes: ${shift.notes as string}`)

    // DEFECT-002: LAST-MODIFIED lets clients detect changes; fall back to dtstamp if no published_at
    const lastModified = shift.published_at
      ? icsTimestamp(shift.published_at as string)
      : dtstamp

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:staff-shift-${shift.id as string}@anchor-management`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART;TZID=Europe/London:${dtStart}`)
    lines.push(`DTEND;TZID=Europe/London:${dtEnd}`)
    lines.push(`SUMMARY:${escapeICS(summary)}`)
    lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`)
    lines.push(`STATUS:${shift.status === 'sick' ? 'CANCELLED' : 'CONFIRMED'}`)
    lines.push(`LAST-MODIFIED:${lastModified}`)
    lines.push('SEQUENCE:0')
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  const ics = lines.map(foldLine).join('\r\n')

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${empName.replace(/\s+/g, '-')}-shifts.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
