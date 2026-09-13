/**
 * Generates an RFC 5545 .ics calendar file for a private booking.
 * Pure function: no DB calls, no side effects. Returns the file contents, or null when there is
 * nothing honest to put in it.
 */

import { formatDateInLondon, isValidIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection';

const VENUE_LOCATION = 'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ';

/**
 * manager@the-anchor.pub is the only correct address (website SSOT §2). This used to name
 * events@the-anchor.pub, which also decided where a reply to the invite went (review PB-10).
 */
const ORGANIZER_EMAIL = 'manager@the-anchor.pub';
const ORGANIZER = `CN=The Anchor:mailto:${ORGANIZER_EMAIL}`;

/** Hours added to a start time when the booking has no end time. */
const DEFAULT_DURATION_HOURS = 3;

/**
 * The Europe/London rules, so a client that does not already know the zone still puts the event
 * at the right hour. `TZID=Europe/London` with no VTIMEZONE (RFC 5545 §3.2.19) left that to the
 * client's own database (review PB-12).
 */
const LONDON_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:BST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYYMMDD from a calendar date, with no time-zone conversion on the way through. */
function icsDate(isoDate: string): string {
  return isoDate.slice(0, 10).replace(/-/g, '');
}

/**
 * YYYYMMDDTHHMMSS for a London wall-clock time.
 *
 * The numbers are the times as booked; `TZID=Europe/London` on the property line tells the client
 * how to read them. Nothing here goes through a Date, so the host zone cannot shift it.
 */
function icsDateTime(isoDate: string, hours: number, minutes: number, seconds: number): string {
  return `${icsDate(isoDate)}T${pad(hours)}${pad(minutes)}${pad(seconds)}`;
}

/** The current moment as YYYYMMDDTHHMMSSZ, for DTSTAMP. */
function formatIcsUtcNow(): string {
  const now = new Date();
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/** Parse HH:MM or HH:MM:SS. Null when the input is missing or not a time. */
function parseTime(time: string | null | undefined): { hours: number; minutes: number; seconds: number } | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

/**
 * The default end: the start time plus three hours on the London clock, rolling into the next day
 * when it passes midnight.
 *
 * Adding three hours of elapsed milliseconds to a host-local Date gave a different wall clock in
 * London and in UTC across the October change: a 00:30 start on 25 October ended at 02:30 under
 * one zone and 03:30 under the other (review PB-12).
 */
function defaultEnd(isoDate: string, start: { hours: number; minutes: number; seconds: number }): {
  isoDate: string;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const hours = start.hours + DEFAULT_DURATION_HOURS;
  if (hours < 24) return { isoDate, hours, minutes: start.minutes, seconds: start.seconds };
  return {
    isoDate: shiftIsoDate(isoDate, 1) ?? isoDate,
    hours: hours - 24,
    minutes: start.minutes,
    seconds: start.seconds,
  };
}

/** Escape special characters in ICS text values (RFC 5545 §3.3.11). */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets (RFC 5545 §3.1), continuing with a single space.
 *
 * Counted in octets, not characters, and never split inside a multi-byte character, so an accent
 * in a customer's event type cannot corrupt the file.
 */
function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off a byte at a time until the slice ends on a whole character.
    while (end > start && end < bytes.length && (bytes[end] as number) >= 0x80 && (bytes[end] as number) < 0xc0) {
      end -= 1;
    }
    parts.push(bytes.subarray(start, end).toString('utf-8'));
    start = end;
    // Continuation lines carry a leading space, which counts towards the 75.
    limit = 74;
  }
  return parts.join('\r\n ');
}

export type BookingCalendarInviteMethod = 'PUBLISH' | 'CANCEL';

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
  status?: string | null;
  date_tbd?: boolean | null;
  internal_notes?: string | null;
  updated_at?: string | null;
  venue_name?: string;
  venue_address?: string;
}, options?: {
  method?: BookingCalendarInviteMethod;
  /** Raised on every re-send so a client replaces the event rather than keeping both. */
  sequence?: number;
}): string | null {
  // A booking with no date holds the placeholder date it was created with (today, at 12:00), so
  // there is no event to put in anyone's calendar yet (review PB-1).
  if (isBookingDateTbd(booking)) return null;
  const eventDate = (booking.event_date ?? '').slice(0, 10);
  if (!isValidIsoDate(eventDate)) return null;

  const method: BookingCalendarInviteMethod = options?.method ?? 'PUBLISH';
  const sequence = Math.max(0, Math.floor(options?.sequence ?? 0));

  // --- DTSTART and DTEND ---
  // No start time is not noon. The booking form allows a date without a time, and an invented
  // 12:00 to 15:00 put a three-hour lunch in the guest's diary (review PB-21). An all-day entry
  // says what is actually known.
  const start = parseTime(booking.start_time);
  const timeLines: string[] = [];
  if (!start) {
    timeLines.push(`DTSTART;VALUE=DATE:${icsDate(eventDate)}`);
    timeLines.push(`DTEND;VALUE=DATE:${icsDate(shiftIsoDate(eventDate, 1) ?? eventDate)}`);
  } else {
    const parsedEnd = parseTime(booking.end_time);
    const end = parsedEnd
      ? {
          isoDate: booking.end_time_next_day ? (shiftIsoDate(eventDate, 1) ?? eventDate) : eventDate,
          ...parsedEnd,
        }
      : defaultEnd(eventDate, start);
    timeLines.push(`DTSTART;TZID=Europe/London:${icsDateTime(eventDate, start.hours, start.minutes, start.seconds)}`);
    timeLines.push(`DTEND;TZID=Europe/London:${icsDateTime(end.isoDate, end.hours, end.minutes, end.seconds)}`);
  }

  const eventLabel = booking.event_type || 'Private Booking';
  const summary = escapeIcsText(`Private event at The Anchor: ${eventLabel}`);
  const location = escapeIcsText(booking.venue_address ?? VENUE_LOCATION);

  const guestPart =
    booking.guest_count != null
      ? `${booking.guest_count} ${booking.guest_count === 1 ? 'guest' : 'guests'}`
      : 'your guests';
  const formattedDate = formatDateInLondon(eventDate, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const description = escapeIcsText(
    `Your booking for ${guestPart} on ${formattedDate}.\n\nQuestions? Contact The Anchor at ${ORGANIZER_EMAIL}`
  );

  // Tentative while the booking is a draft: a provisional hold is not a confirmed event.
  const status =
    method === 'CANCEL' ? 'CANCELLED' : booking.status === 'draft' ? 'TENTATIVE' : 'CONFIRMED';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Anchor//Private Bookings//EN',
    'CALSCALE:GREGORIAN',
    // PUBLISH, not REQUEST: there is no ATTENDEE, so this is a calendar entry to add, not a
    // meeting request to answer (RFC 5546; review PB-12).
    `METHOD:${method}`,
    ...(start ? LONDON_VTIMEZONE : []),
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@the-anchor`,
    `DTSTAMP:${formatIcsUtcNow()}`,
    ...timeLines,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;${ORGANIZER}`,
    `STATUS:${status}`,
    `SEQUENCE:${sequence}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldIcsLine).join('\r\n');
}

/**
 * A SEQUENCE that rises every time the booking is saved, so a re-sent invite replaces the one the
 * guest already has instead of sitting beside it. Whole minutes since 2020, which stays inside a
 * 32-bit integer until the 2100s.
 */
export function bookingCalendarInviteSequence(updatedAt: string | null | undefined): number {
  const ms = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(ms)) return 0;
  const minutes = Math.floor((ms - Date.UTC(2020, 0, 1)) / 60000);
  return minutes > 0 ? minutes : 0;
}
