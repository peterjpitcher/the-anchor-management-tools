import { createHash, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest } from 'next/server';
import {
  icsDate,
  icsTimestamp,
  addOneDay,
  escapeICS,
  foldLine,
  deriveSequence,
  VTIMEZONE_EUROPE_LONDON,
  ICS_CALENDAR_REFRESH_LINES,
} from '@/lib/ics/utils';

export const dynamic = 'force-dynamic';

// Returns the expected feed token.
// Prefer ROTA_FEED_SECRET (dedicated secret, easier to rotate without affecting Supabase).
// Falls back to SHA-256(service role key) so existing calendar subscriptions continue to work
// until operators set ROTA_FEED_SECRET and re-subscribe.
function getFeedToken(): string {
  if (process.env.ROTA_FEED_SECRET) {
    return process.env.ROTA_FEED_SECRET;
  }
  return createHash('sha256')
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fallback-no-key')
    .digest('hex')
    .substring(0, 32);
}

/**
 * Timing-safe token comparison (fixes DEFECT-006).
 * Differing lengths return false immediately — no timing leak since
 * we are not revealing which byte position differs.
 */
function isValidToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || !isValidToken(token, getFeedToken())) {
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
    .order('shift_date')
    .order('start_time');

  if (error) {
    return new Response('Error loading rota', { status: 500 });
  }

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

  for (const shift of shifts ?? []) {
    const emp = shift.employee as { first_name: string | null; last_name: string | null } | null;
    const empName = shift.is_open_shift
      ? 'Open Shift'
      : emp
        ? [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown'
        : 'Unknown';

    const deptLabel = shift.department
      ? (shift.department as string).charAt(0).toUpperCase() + (shift.department as string).slice(1)
      : '';

    const summary = [
      empName,
      shift.name ? `— ${shift.name as string}` : null,
      deptLabel ? `(${deptLabel})` : null,
    ].filter(Boolean).join(' ');

    const endDate = shift.is_overnight
      ? addOneDay(shift.shift_date as string)
      : (shift.shift_date as string);
    const dtStart = icsDate(shift.shift_date as string, shift.start_time as string);
    const dtEnd = icsDate(endDate, shift.end_time as string);

    const descParts: string[] = [`Department: ${deptLabel || (shift.department as string)}`];
    if (shift.status === 'sick') descParts.push('Status: Sick');
    if (shift.status === 'cancelled') descParts.push('Status: Cancelled');
    if (shift.notes) descParts.push(`Notes: ${shift.notes as string}`);

    // DTSTAMP per RFC 5545 §3.8.7.2 = last time the event was modified in the calendar store.
    // Use published_at so it only changes when the shift is actually re-published.
    const isCancelled = shift.status === 'cancelled' || shift.status === 'sick';
    const eventDtstamp = shift.published_at
      ? icsTimestamp(shift.published_at as string)
      : icsTimestamp(new Date());
    // LAST-MODIFIED: same source as DTSTAMP for this feed
    const lastModified = eventDtstamp;
    const icsStatus = isCancelled ? 'CANCELLED' : 'CONFIRMED';

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:shift-${shift.id as string}@anchor-management`);
    lines.push(`DTSTAMP:${eventDtstamp}`);
    lines.push(`DTSTART;TZID=Europe/London:${dtStart}`);
    lines.push(`DTEND;TZID=Europe/London:${dtEnd}`);
    lines.push(`SUMMARY:${escapeICS(summary)}`);
    lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`);
    lines.push(`STATUS:${icsStatus}`);
    lines.push(`LAST-MODIFIED:${lastModified}`);
    lines.push(`SEQUENCE:${deriveSequence(shift.published_at as string | null, isCancelled)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const ics = lines.map(foldLine).join('\r\n');

  // ETag: SHA-256 of ICS body (truncated to 32 hex chars)
  const etag = `"${createHash('sha256').update(ics).digest('hex').substring(0, 32)}"`;

  // Last-Modified: most recent published_at across all returned shifts
  const mostRecentPublish = (shifts ?? [])
    .map(s => s.published_at ? new Date(s.published_at as string) : null)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const lastModifiedHeader = mostRecentPublish
    ? mostRecentPublish.toUTCString()
    : new Date().toUTCString();

  // Conditional GET support — lets Google issue 304 instead of re-downloading
  const ifNoneMatchHeader = req.headers.get('if-none-match');
  const ifModifiedSinceHeader = req.headers.get('if-modified-since');
  const notModified =
    (ifNoneMatchHeader !== null && ifNoneMatchHeader === etag) ||
    (ifModifiedSinceHeader !== null && mostRecentPublish !== null &&
      new Date(ifModifiedSinceHeader) >= mostRecentPublish);

  if (notModified) {
    return new Response(null, {
      status: 304,
      headers: { 'ETag': etag, 'Last-Modified': lastModifiedHeader },
    });
  }

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="rota.ics"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'ETag': etag,
      'Last-Modified': lastModifiedHeader,
    },
  });
}
