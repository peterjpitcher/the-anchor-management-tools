/**
 * Shared ICS (iCalendar) utility functions.
 * Used by /api/rota/feed and /api/portal/calendar-feed.
 * Fixes: DEFECT-005 (foldLine UTF-8 boundary), DEFECT-007 (deduplication).
 */

/**
 * Format a shift date + time string into an ICS local datetime string (no Z suffix).
 * Output: YYYYMMDDTHHMMSS
 */
export function icsDate(dateStr: string, timeStr: string): string {
  const datePart = dateStr.replace(/-/g, '');
  const [h, m] = timeStr.split(':');
  return `${datePart}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
}

/**
 * Format a Date object or ISO datetime string into an ICS UTC timestamp.
 * Output: YYYYMMDDTHHMMSSZ
 */
export function icsTimestamp(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toISOString().replace(/[-:.]/g, '').substring(0, 15) + 'Z';
}

/**
 * Add one calendar day to a YYYY-MM-DD date string.
 * Used for overnight shifts where the end date is the following day.
 */
export function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

/**
 * Escape special ICS characters in a string value.
 * Per RFC 5545 §3.3.11: backslash, semicolon, comma, and newlines must be escaped.
 */
export function escapeICS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Fold a single ICS content line to conform to RFC 5545 §3.1 line-length limits.
 * Max 75 octets for the first line, 74 octets for continuation lines (1 octet is the space).
 *
 * Fixes DEFECT-005: the previous Buffer.slice approach cut at byte offsets, which
 * could split multi-byte UTF-8 characters (e.g. em-dash = 3 bytes, accented chars = 2 bytes).
 * This implementation iterates character-by-character, tracking byte counts correctly.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();

  // Fast path: check total byte length first
  let totalBytes = 0;
  for (const char of line) {
    totalBytes += encoder.encode(char).length;
  }
  if (totalBytes <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let isFirst = true;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = isFirst ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = char;
      currentBytes = charBytes;
      isFirst = false;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current) parts.push(current);

  return parts.join('\r\n ');
}

/**
 * VTIMEZONE block for Europe/London (GMT/BST).
 * Required by RFC 5545 §3.6.5 when TZID=Europe/London is used in DTSTART/DTEND.
 * Fixes DEFECT-003.
 */
export const VTIMEZONE_EUROPE_LONDON: string[] = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'BEGIN:STANDARD',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'TZNAME:GMT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'TZNAME:BST',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/**
 * Derive a monotonically-increasing SEQUENCE number from a shift's published_at timestamp.
 * RFC 5545 §3.8.7.4: SEQUENCE must increment when event details change.
 * Since rota_published_shifts is a snapshot table, published_at updates on each re-publish,
 * giving us a valid increasing SEQUENCE without a dedicated DB column.
 * Epoch: 2025-01-01T00:00:00Z = 1735689600000 ms.
 * For cancelled events, add 1 to ensure SEQUENCE is strictly greater than the last CONFIRMED value.
 */
export function deriveSequence(publishedAt: string | null, isCancelled = false): number {
  const EPOCH_MS = 1735689600000; // 2025-01-01T00:00:00Z
  if (!publishedAt) return isCancelled ? 1 : 0;
  const ms = new Date(publishedAt).getTime() - EPOCH_MS;
  const seq = Math.max(0, Math.floor(ms / 1000));
  return isCancelled ? seq + 1 : seq;
}

/**
 * Standard calendar refresh hint properties.
 * Apple Calendar and Outlook honour these (PT1H = refresh hourly).
 * NOTE: Google Calendar ignores REFRESH-INTERVAL and X-PUBLISHED-TTL entirely —
 * it polls ICS subscriptions on its own 12–24 hour schedule regardless.
 * These properties are kept for Apple/Outlook compatibility.
 */
export const ICS_CALENDAR_REFRESH_LINES: string[] = [
  'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  'X-PUBLISHED-TTL:PT1H',
];
