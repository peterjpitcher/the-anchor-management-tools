import { fromZonedTime } from 'date-fns-tz';

// ---------------------------------------------------------------------------
// The shift acceptance cutoff, in one place.
//
// Policy: a published shift must be accepted or rejected no less than two weeks
// before it starts. Past that point the cron auto-accepts it.
//
// The rule is 336 HOURS BEFORE THE LONDON SHIFT START INSTANT, not a calendar
// date subtraction. Those two differ by an hour across each British Summer Time
// transition, which is how the staff portal came to show a deadline the server
// did not honour. Anything that displays a deadline must derive it from
// acceptanceDeadlineInstant() rather than subtracting days from the shift date.
//
// This module is client-safe: no server-only imports, no React. It is the
// single source for the rota grid, the staff portal, the server actions and the
// acceptance cron.
// ---------------------------------------------------------------------------

const LONDON_TIMEZONE = 'Europe/London';

/** Two weeks, expressed in days for labels and copy. */
export const SHIFT_ACCEPTANCE_CUTOFF_DAYS = 14;

/** The same two weeks as a fixed 336-hour duration, for instant arithmetic. */
export const SHIFT_ACCEPTANCE_CUTOFF_MS = SHIFT_ACCEPTANCE_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

/** "HH:mm" or "HH:mm:ss" normalised to "HH:mm:ss" for zoned parsing. */
function normaliseTime(startTime: string): string {
  const parts = startTime.split(':');
  const hours = (parts[0] ?? '00').padStart(2, '0');
  const minutes = (parts[1] ?? '00').padStart(2, '0');
  const seconds = (parts[2] ?? '00').padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * The UTC instant at which a shift starts, reading the stored date and time as
 * London wall-clock values.
 *
 * @param shiftDate "yyyy-MM-dd"
 * @param startTime "HH:mm" or "HH:mm:ss"
 */
export function shiftStartInstant(shiftDate: string, startTime: string): Date {
  return fromZonedTime(`${shiftDate}T${normaliseTime(startTime)}`, LONDON_TIMEZONE);
}

/**
 * The last instant at which an employee can still accept or reject the shift:
 * exactly 336 hours before it starts.
 *
 * This is the ONLY place a deadline may be derived from. Format it for display
 * with the London-aware helpers in @/lib/dateUtils.
 */
export function acceptanceDeadlineInstant(shiftDate: string, startTime: string): Date {
  return new Date(shiftStartInstant(shiftDate, startTime).getTime() - SHIFT_ACCEPTANCE_CUTOFF_MS);
}

/**
 * True when the shift is inside the acceptance cutoff, meaning it starts in
 * 336 hours or less and the employee's decision window has closed.
 *
 * The boundary itself counts as inside, matching the auto-accept cron: a shift
 * exactly 336 hours away is auto-accepted, not still pending.
 */
export function isInsideAcceptanceCutoff(shiftDate: string, startTime: string, now: Date): boolean {
  return now.getTime() >= acceptanceDeadlineInstant(shiftDate, startTime).getTime();
}

// ---------------------------------------------------------------------------
// The late-publish grace window (decision D13).
//
// Publishing inside the cutoff is allowed but must never auto-accept on the
// employee's behalf: nobody can be treated as having accepted work they were
// never given a chance to turn down. A shift FIRST published to somebody at or
// after its acceptance deadline instead gets 48 hours from that publish in
// which they may still reject it.
//
// Two preconditions matter and were previously applied inconsistently across
// the server action, the staff portal and the acceptance cron:
//
//   1. The grace is earned only when the shift reached this employee at or
//      after the deadline. A shift published in good time never gets one.
//   2. The window is clamped to the shift start, because a decision taken after
//      the shift has begun is not a decision.
//
// `rota_published_shifts.first_published_at` is the marker. It is maintained by
// publish_rota_week: it carries forward while the shift keeps the same employee
// and resets to the publish time when the shift is published to somebody new,
// so it answers "when did this land on this person", which `published_at`
// cannot. There is deliberately no fallback to `published_at`: that column is
// overwritten on every republish of the week, so treating it as a first publish
// would hand out grace windows nobody earned.
// ---------------------------------------------------------------------------

/** Two days, expressed in hours for labels and copy. */
export const LATE_PUBLISH_GRACE_HOURS = 48;

/** The same two days as a fixed duration, for instant arithmetic. */
export const LATE_PUBLISH_GRACE_MS = LATE_PUBLISH_GRACE_HOURS * 60 * 60 * 1000;

/** The minimum a shift must carry for its grace window to be decided. */
export type LatePublishGraceInput = {
  shift_date: string;
  start_time: string;
  first_published_at: string | null | undefined;
};

/**
 * The instant a shift's late-publish grace window closes, or null when the
 * shift never earned one.
 *
 * Null means the normal two-week deadline stands. The boundary matches
 * isInsideAcceptanceCutoff: a shift first published exactly at the deadline is
 * already inside the cutoff, so it earns the window.
 */
export function latePublishGraceEnd(shift: LatePublishGraceInput): Date | null {
  if (!shift.first_published_at) return null;

  const firstPublishedAt = new Date(shift.first_published_at);
  if (Number.isNaN(firstPublishedAt.getTime())) return null;

  const deadline = acceptanceDeadlineInstant(shift.shift_date, shift.start_time);
  if (firstPublishedAt.getTime() < deadline.getTime()) return null;

  const graceEndMs = firstPublishedAt.getTime() + LATE_PUBLISH_GRACE_MS;
  const startMs = shiftStartInstant(shift.shift_date, shift.start_time).getTime();
  return new Date(Math.min(graceEndMs, startMs));
}

/**
 * True while a late-publish grace window is still open, meaning the employee
 * keeps the choice even though the shift is inside the cutoff.
 */
export function isInsideLatePublishGrace(shift: LatePublishGraceInput, now: Date): boolean {
  const graceEnd = latePublishGraceEnd(shift);
  return graceEnd !== null && now.getTime() < graceEnd.getTime();
}
