/**
 * Generates an RFC 5545-compliant .ics calendar file for a private booking.
 * Pure function — no DB calls, no side effects.
 * Returns the file contents as a string — attach to email.
 */

const VENUE_LOCATION = 'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ';
const ORGANIZER = 'CN=The Anchor:mailto:events@the-anchor.pub';

/**
 * Format a Date as YYYYMMDDTHHMMSS (local, no Z — TZID is specified on the property line).
 */
function formatIcsDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}` +
    `T` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

/**
 * Format the current moment as YYYYMMDDTHHMMSSZ (UTC stamp for DTSTAMP).
 */
function formatIcsUtcNow(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}` +
    `${pad(now.getUTCMonth() + 1)}` +
    `${pad(now.getUTCDate())}` +
    `T` +
    `${pad(now.getUTCHours())}` +
    `${pad(now.getUTCMinutes())}` +
    `${pad(now.getUTCSeconds())}` +
    `Z`
  );
}

/**
 * Parse HH:MM:SS (or HH:MM) into { hours, minutes, seconds }.
 * Returns null if the input is falsy.
 */
function parseTime(time: string | null | undefined): { hours: number; minutes: number; seconds: number } | null {
  if (!time) return null;
  const parts = time.split(':');
  return {
    hours: parseInt(parts[0] ?? '0', 10),
    minutes: parseInt(parts[1] ?? '0', 10),
    seconds: parseInt(parts[2] ?? '0', 10),
  };
}

/**
 * Combine an ISO date string (YYYY-MM-DD) with a parsed time into a Date object
 * whose numeric fields represent Europe/London wall-clock time.
 * We construct this as a plain local Date that carries the intended hour/minute
 * values; the TZID=Europe/London property on the ICS line tells the calendar
 * client how to interpret the numbers.
 */
function buildLocalDate(isoDate: string, hours: number, minutes: number, seconds: number): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  // Use Date.UTC to avoid any host-timezone shifting on the date part,
  // then adjust only the time portion.  We deliberately want the values
  // as typed, not converted; the TZID in the ICS file handles DST for
  // the client.
  const d = new Date(0);
  d.setFullYear(year!, (month ?? 1) - 1, day ?? 1);
  d.setHours(hours, minutes, seconds, 0);
  return d;
}

/**
 * Escape special characters in ICS text values (RFC 5545 §3.3.11).
 */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function generateBookingCalendarInvite(booking: {
  id: string;
  event_date: string;           // YYYY-MM-DD
  start_time?: string | null;   // HH:MM:SS
  end_time?: string | null;     // HH:MM:SS
  end_time_next_day?: boolean | null;
  event_type?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_name?: string | null;
  guest_count?: number | null;
  venue_name?: string;
  venue_address?: string;
}): string {
  // --- DTSTART ---
  const startParsed = parseTime(booking.start_time);
  const startHours = startParsed?.hours ?? 12;
  const startMinutes = startParsed?.minutes ?? 0;
  const startSeconds = startParsed?.seconds ?? 0;
  const startDate = buildLocalDate(booking.event_date, startHours, startMinutes, startSeconds);

  // --- DTEND ---
  let endDate: Date;

  const endParsed = parseTime(booking.end_time);
  if (endParsed) {
    const endIsoDate =
      booking.end_time_next_day
        ? advanceDateByDays(booking.event_date, 1)
        : booking.event_date;
    endDate = buildLocalDate(endIsoDate, endParsed.hours, endParsed.minutes, endParsed.seconds);
  } else {
    // Default: start time + 3 hours
    endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);
  }

  // --- SUMMARY ---
  const eventLabel = booking.event_type || 'Private Booking';
  const summary = escapeIcsText(`Private Event at The Anchor — ${eventLabel}`);

  // --- LOCATION ---
  const location = escapeIcsText(booking.venue_address ?? VENUE_LOCATION);

  // --- DESCRIPTION ---
  const guestPart = booking.guest_count != null ? `${booking.guest_count} guests` : 'your guests';
  const formattedDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const description = escapeIcsText(
    `Your booking for ${guestPart} on ${formattedDate}.\n\nQuestions? Contact The Anchor at events@the-anchor.pub`
  );

  const uid = `booking-${booking.id}@the-anchor`;
  const dtstamp = formatIcsUtcNow();
  const dtstart = formatIcsDatetime(startDate);
  const dtend = formatIcsDatetime(endDate);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Anchor//Private Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=Europe/London:${dtstart}`,
    `DTEND;TZID=Europe/London:${dtend}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;${ORGANIZER}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Add `days` calendar days to an ISO date string (YYYY-MM-DD).
 * Uses date arithmetic without time-zone conversions.
 */
function advanceDateByDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(year!, (month ?? 1) - 1, (day ?? 1) + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
