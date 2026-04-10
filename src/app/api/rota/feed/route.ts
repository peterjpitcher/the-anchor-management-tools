import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { NextRequest } from 'next/server';
import {
  foldLine,
  formatDeptLabel,
  buildVEvent,
  findMostRecentPublish,
  VTIMEZONE_EUROPE_LONDON,
  ICS_CALENDAR_REFRESH_LINES,
  type PublishedShiftWithEmployee,
} from '@/lib/ics/utils';
import { verifyRotaFeedToken } from '@/lib/portal/calendar-token';
import { PermissionService } from '@/services/permission';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token');
  const userId = req.nextUrl.searchParams.get('uid');

  if (!token || !userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Verify the per-user HMAC token
  if (!verifyRotaFeedToken(userId, token)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Verify the user still has rota:view permission
  const hasPermission = await PermissionService.checkUserPermission('rota', 'view', userId);
  if (!hasPermission) {
    return new Response('Forbidden', { status: 403 });
  }

  const supabase = createAdminClient();

  // Last 4 weeks to next 12 weeks (QA-015: use London timezone)
  const today = getTodayIsoDate();
  const todayDate = new Date(today + 'T12:00:00Z');
  const from = new Date(todayDate);
  from.setUTCDate(from.getUTCDate() - 28);
  const to = new Date(todayDate);
  to.setUTCDate(to.getUTCDate() + 84);
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];

  // ── QA-005: Lightweight ETag pre-check before full ICS generation ──
  const { data: meta } = await supabase
    .from('rota_published_shifts')
    .select('published_at')
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count } = await supabase
    .from('rota_published_shifts')
    .select('*', { count: 'exact', head: true })
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr);

  const metaEtag = `"meta-${createHash('sha256').update(`${meta?.published_at ?? 'none'}-${count ?? 0}`).digest('hex').substring(0, 32)}"`;

  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch === metaEtag) {
    return new Response(null, { status: 304, headers: { 'ETag': metaEtag } });
  }

  // ── Full query (QA-008: explicit column selection) ──
  const { data: shifts, error } = await supabase
    .from('rota_published_shifts')
    .select('id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name, published_at, employee:employees(first_name, last_name)')
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)
    .order('shift_date')
    .order('start_time');

  if (error) {
    return new Response('Error loading rota', { status: 500 });
  }

  const typedShifts = (shifts ?? []) as unknown as PublishedShiftWithEmployee[];

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Anchor Management//Rota Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Anchor Rota',
    'X-WR-TIMEZONE:Europe/London',
    'X-WR-CALDESC:Staff rota shifts',
    // Refresh hints for Apple Calendar and Outlook; Google Calendar ignores these
    ...ICS_CALENDAR_REFRESH_LINES,
    // VTIMEZONE required by RFC 5545 §3.6.5 when TZID= is used
    ...VTIMEZONE_EUROPE_LONDON,
  ];

  for (const shift of typedShifts) {
    const emp = shift.employee;
    const empName = shift.is_open_shift
      ? 'Open Shift'
      : emp
        ? [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown'
        : 'Unknown';

    const deptLabel = formatDeptLabel(shift.department);

    const summary = [
      empName,
      shift.name ? `— ${shift.name}` : null,
      deptLabel ? `(${deptLabel})` : null,
    ].filter(Boolean).join(' ');

    const descParts: string[] = [`Department: ${deptLabel || (shift.department ?? '')}`];
    if (shift.status === 'sick') descParts.push('Status: Sick');
    if (shift.status === 'cancelled') descParts.push('Status: Cancelled');
    if (shift.notes) descParts.push(`Notes: ${shift.notes}`);

    lines.push(...buildVEvent({ shift, uidPrefix: 'shift', summary, descriptionParts: descParts }));
  }

  lines.push('END:VCALENDAR');

  const ics = lines.map(foldLine).join('\r\n');

  // Last-Modified: most recent published_at across all returned shifts
  const mostRecentPublish = findMostRecentPublish(typedShifts);
  const lastModifiedHeader = mostRecentPublish
    ? mostRecentPublish.toUTCString()
    : new Date().toUTCString();

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="rota.ics"',
      'Cache-Control': 'max-age=300, stale-while-revalidate=600',
      'ETag': metaEtag,
      'Last-Modified': lastModifiedHeader,
    },
  });
}
