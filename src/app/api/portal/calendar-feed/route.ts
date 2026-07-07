import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { verifyCalendarToken } from '@/lib/portal/calendar-token'
import { premiumLabel, hasPremium } from '@/lib/rota/pay-calculator'
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

/** "HH:mm:ss" → "HH:mm"; leaves other input untouched. */
function shortTime(time: string | null): string | null {
  if (!time) return null
  return time.length >= 5 ? time.slice(0, 5) : time
}

/**
 * A short, non-numeric premium note for a shift's ICS description, e.g.
 * "Premium rate: Double time after 00:00". Returns null when no premium is set.
 */
function buildPremiumNote(row: Record<string, unknown>): string | null {
  // PostgREST serialises numeric columns as strings ("2.00"), so coerce before use
  // (a bare typeof-number check would discard every real value).
  const toNum = (v: unknown): number | null => {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }
  const rateMultiplier = toNum(row.rate_multiplier)
  const rateOverride = toNum(row.rate_override)
  if (!hasPremium({ rateMultiplier, rateOverride })) return null

  const premiumReason = typeof row.premium_reason === 'string' ? row.premium_reason : null
  const label = premiumLabel(rateMultiplier, rateOverride, premiumReason, rateOverride ?? 0, 0) || 'Premium'

  const start = shortTime(typeof row.premium_start_time === 'string' ? row.premium_start_time : null)
  const end = shortTime(typeof row.premium_end_time === 'string' ? row.premium_end_time : null)

  let window = ''
  if (start && end) window = ` ${start}-${end}`
  else if (start) window = ` after ${start}`
  else if (end) window = ` until ${end}`

  return `Premium rate: ${label}${window}`
}

export async function GET(req: NextRequest): Promise<Response> {
  const employeeId = req.nextUrl.searchParams.get('employee_id')
  const token = req.nextUrl.searchParams.get('token')

  if (!employeeId || !token || !verifyCalendarToken(employeeId, token)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()

  // Verify employee exists and still has staff portal access.
  const { data: employee } = await supabase
    .from('employees')
    .select('first_name, last_name, status')
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (!employee) {
    return new Response('Not found', { status: 404 })
  }
  if (!['Active', 'Started Separation'].includes(employee.status)) {
    return new Response('Forbidden', { status: 403 })
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

  // ── Full query (QA-008: explicit column selection) ──
  // Include cancelled shifts so Google Calendar receives explicit STATUS:CANCELLED VEVENTs
  // and removes them, rather than silently leaving stale events when UIDs disappear.
  const { data: shifts, error: shiftsError } = await supabase
    .from('rota_published_shifts')
    .select('id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name, published_at, acceptance_status, rate_multiplier, rate_override, premium_reason, premium_start_time, premium_end_time')
    .eq('employee_id', employeeId)
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)
    .or('acceptance_status.is.null,acceptance_status.in.(pending,accepted,auto_accepted)')
    .order('shift_date')
    .order('start_time')

  if (shiftsError) {
    return new Response('Error loading shifts', { status: 500 })
  }

  // Non-numeric premium note per shift (id → label), e.g. "Premium rate: Double time".
  // No pay figures in the calendar — just a heads-up that the shift is at premium.
  const premiumNoteById = new Map<string, string>()
  for (const row of (shifts ?? []) as Array<Record<string, unknown>>) {
    const note = buildPremiumNote(row)
    if (note) premiumNoteById.set(String(row.id), note)
  }

  const typedShifts = (shifts ?? []) as unknown as PublishedShiftRow[]
  const activeShiftIds = new Set(typedShifts.map(shift => shift.id))

  const { data: cancellationRows, error: cancellationsError } = await supabase
    .from('rota_shift_calendar_cancellations')
    .select('shift_id, shift_date, start_time, end_time, unpaid_break_minutes, department, notes, is_overnight, name, cancelled_at, reason')
    .eq('employee_id', employeeId)
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)
    .order('shift_date')
    .order('start_time')

  if (cancellationsError) {
    return new Response('Error loading shift cancellations', { status: 500 })
  }

  const cancelledShifts = ((cancellationRows ?? []) as Array<{
    shift_id: string
    shift_date: string
    start_time: string
    end_time: string
    department: string | null
    notes: string | null
    is_overnight: boolean
    name: string | null
    cancelled_at: string
    reason: string
  }>)
    .filter(row => !activeShiftIds.has(row.shift_id))
    .map((row): PublishedShiftRow => ({
      id: row.shift_id,
      shift_date: row.shift_date,
      start_time: row.start_time,
      end_time: row.end_time,
      department: row.department,
      status: 'cancelled',
      notes: row.reason || row.notes,
      is_overnight: row.is_overnight,
      is_open_shift: false,
      name: row.name,
      published_at: row.cancelled_at,
    }))

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
    if (shift.status === 'cancelled') descParts.push('Status: Cancelled')
    const premiumNote = premiumNoteById.get(shift.id)
    if (premiumNote) descParts.push(premiumNote)
    if (shift.notes) descParts.push(`Notes: ${shift.notes}`)

    lines.push(...buildVEvent({ shift, uidPrefix: 'staff-shift', summary, descriptionParts: descParts }))
  }

  for (const shift of cancelledShifts) {
    const deptLabel = formatDeptLabel(shift.department)
    const summary = [
      'Shift at The Anchor',
      deptLabel ? `(${deptLabel})` : null,
      shift.name ? `— ${shift.name}` : null,
    ].filter(Boolean).join(' ')
    const descParts = [
      'Status: Cancelled',
      `Reason: ${shift.notes ?? 'Shift removed from your rota'}`,
      `Department: ${deptLabel || (shift.department ?? '')}`,
    ]

    lines.push(...buildVEvent({ shift, uidPrefix: 'staff-shift', summary, descriptionParts: descParts }))
  }

  lines.push('END:VCALENDAR')

  const ics = lines.map(foldLine).join('\r\n')
  const etag = `"${createHash('sha256').update(ics).digest('hex').substring(0, 32)}"`

  // Last-Modified: most recent published_at across all returned shifts
  const mostRecentPublish = findMostRecentPublish([...typedShifts, ...cancelledShifts])
  const lastModifiedHeader = mostRecentPublish
    ? mostRecentPublish.toUTCString()
    : new Date().toUTCString()
  const ifNoneMatch = req.headers.get('if-none-match')
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Last-Modified': lastModifiedHeader } })
  }

  const ifModifiedSince = req.headers.get('if-modified-since')
  if (mostRecentPublish && ifModifiedSince) {
    const since = new Date(ifModifiedSince)
    if (!Number.isNaN(since.getTime()) && mostRecentPublish.getTime() <= since.getTime()) {
      return new Response(null, { status: 304, headers: { ETag: etag, 'Last-Modified': lastModifiedHeader } })
    }
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
