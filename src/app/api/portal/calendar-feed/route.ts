import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCalendarToken } from '@/lib/portal/calendar-token'

export const dynamic = 'force-dynamic'

function icsDate(dateStr: string, timeStr: string): string {
  const datePart = dateStr.replace(/-/g, '')
  const [h, m] = timeStr.split(':')
  return `${datePart}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`
}

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split('T')[0]
}

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
}

function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let offset = 0
  let first = true
  while (offset < bytes.length) {
    const limit = first ? 75 : 74
    parts.push(bytes.slice(offset, offset + limit).toString('utf8'))
    offset += limit
    first = false
  }
  return parts.join('\r\n ')
}

export async function GET(req: NextRequest) {
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

  const { data: shifts } = await supabase
    .from('rota_published_shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('shift_date', from.toISOString().split('T')[0])
    .lte('shift_date', to.toISOString().split('T')[0])
    .neq('status', 'cancelled')
    .order('shift_date')
    .order('start_time')

  const dtstamp = new Date().toISOString().replace(/[-:.]/g, '').substring(0, 15) + 'Z'

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Anchor Management//Staff Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(empName)} — Shifts`,
    'X-WR-TIMEZONE:Europe/London',
    'X-WR-CALDESC:Your published shifts at The Anchor',
  ]

  for (const shift of shifts ?? []) {
    const deptLabel = shift.department
      ? shift.department.charAt(0).toUpperCase() + shift.department.slice(1)
      : ''

    const summary = [
      'Shift at The Anchor',
      deptLabel ? `(${deptLabel})` : null,
      shift.name ? `— ${shift.name}` : null,
    ].filter(Boolean).join(' ')

    const endDate = shift.is_overnight ? addOneDay(shift.shift_date) : shift.shift_date
    const dtStart = icsDate(shift.shift_date, shift.start_time)
    const dtEnd = icsDate(endDate, shift.end_time)

    const descParts = [`Department: ${deptLabel || shift.department}`]
    if (shift.status === 'sick') descParts.push('Status: Sick')
    if (shift.notes) descParts.push(`Notes: ${shift.notes}`)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:staff-shift-${shift.id}@anchor-management`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART;TZID=Europe/London:${dtStart}`)
    lines.push(`DTEND;TZID=Europe/London:${dtEnd}`)
    lines.push(`SUMMARY:${escapeICS(summary)}`)
    lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`)
    lines.push(`STATUS:${shift.status === 'sick' ? 'CANCELLED' : 'CONFIRMED'}`)
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
