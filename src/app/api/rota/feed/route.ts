import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function getFeedToken(): string {
  return createHash('sha256')
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fallback-no-key')
    .digest('hex')
    .substring(0, 32);
}

function icsDate(dateStr: string, timeStr: string): string {
  // Returns YYYYMMDDTHHMMSS for use with TZID=Europe/London
  const datePart = dateStr.replace(/-/g, '');
  const [h, m] = timeStr.split(':');
  return `${datePart}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
}

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// Fold long ICS lines at 75 octets per RFC 5545
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const limit = first ? 75 : 74;
    parts.push(bytes.slice(offset, offset + limit).toString('utf8'));
    offset += limit;
    first = false;
  }
  return parts.join('\r\n ');
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || token !== getFeedToken()) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createAdminClient();

  // Last 4 weeks to next 12 weeks
  const from = new Date();
  from.setDate(from.getDate() - 28);
  const to = new Date();
  to.setDate(to.getDate() + 84);

  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];

  const { data: shifts, error } = await supabase
    .from('rota_published_shifts')
    .select('*, employee:employees(first_name, last_name)')
    .gte('shift_date', fromStr)
    .lte('shift_date', toStr)
    .neq('status', 'cancelled')
    .order('shift_date')
    .order('start_time');

  if (error) {
    return new Response('Error loading rota', { status: 500 });
  }

  const dtstamp = new Date().toISOString().replace(/[-:.]/g, '').substring(0, 15) + 'Z';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Anchor Management//Rota Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Anchor Rota',
    'X-WR-TIMEZONE:Europe/London',
    'X-WR-CALDESC:Staff rota shifts',
  ];

  for (const shift of shifts ?? []) {
    const emp = shift.employee as { first_name: string | null; last_name: string | null } | null;
    const empName = shift.is_open_shift
      ? 'Open Shift'
      : emp
        ? [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown'
        : 'Unknown';

    const deptLabel = shift.department
      ? shift.department.charAt(0).toUpperCase() + shift.department.slice(1)
      : '';

    const summary = [
      empName,
      shift.name ? `— ${shift.name}` : null,
      deptLabel ? `(${deptLabel})` : null,
    ].filter(Boolean).join(' ');

    const endDate = shift.is_overnight ? addOneDay(shift.shift_date) : shift.shift_date;
    const dtStart = icsDate(shift.shift_date, shift.start_time);
    const dtEnd = icsDate(endDate, shift.end_time);

    const descParts: string[] = [`Department: ${deptLabel || shift.department}`];
    if (shift.status === 'sick') descParts.push('Status: Sick');
    if (shift.notes) descParts.push(`Notes: ${shift.notes}`);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:shift-${shift.id}@anchor-management`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=Europe/London:${dtStart}`);
    lines.push(`DTEND;TZID=Europe/London:${dtEnd}`);
    lines.push(`SUMMARY:${escapeICS(summary)}`);
    lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`);
    lines.push(`STATUS:${shift.status === 'sick' ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const ics = lines.map(foldLine).join('\r\n');

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="rota.ics"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
