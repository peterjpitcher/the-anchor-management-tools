import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { isValidIsoDate, shiftIsoDate } from '@/lib/dateUtils'

/**
 * Turning the HH:mm times a manager types for a timeclock session into instants.
 *
 * Shared by the session actions and the manager screen's premium window, so both read the
 * clock-change nights the same way. Nothing here reads the host's own zone: building
 * `new Date('2026-10-24T20:00:00')` first, as the actions used to, parses in the host zone and
 * gave different answers on the UTC server and on a London machine for the missing hour.
 */

const LONDON_TIMEZONE = 'Europe/London'
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/
const ONE_HOUR_MS = 60 * 60 * 1000

/**
 * The instant a London wall-clock time names on a London calendar date, or null when either is
 * not real.
 *
 * On the two clock-change nights a time between 01:00 and 01:59 is read as the later of the
 * two moments it could mean:
 *  - On the last Sunday in March that hour does not exist (the clocks jump from 01:00 GMT to
 *    02:00 BST), so 01:30 is read as if the clocks had not gone forward yet: 01:30 GMT, which
 *    the clock shows as 02:30 BST. date-fns-tz on its own reads it an hour early, as 00:30 GMT.
 *  - On the last Sunday in October that hour happens twice, and 01:30 is the second one, in
 *    GMT. That is also how date-fns-tz, and so the rest of the app, reads it.
 * For a clock-out, the only time a pub shift realistically has in that hour, the later reading
 * is the one that does not cut the shift short.
 */
export function londonWallClockToInstant(isoDate: string, hhmm: string): Date | null {
  if (!isValidIsoDate(isoDate) || !HH_MM.test(hhmm)) return null

  const instant = fromZonedTime(`${isoDate}T${hhmm}:00`, LONDON_TIMEZONE)
  if (Number.isNaN(instant.getTime())) return null

  // Only a time inside the missing hour fails to read back as itself, and it has landed an
  // hour early, so move it on by the hour the clocks skipped.
  if (formatInTimeZone(instant, LONDON_TIMEZONE, 'HH:mm') !== hhmm) {
    return new Date(instant.getTime() + ONE_HOUR_MS)
  }
  return instant
}

/**
 * `hhmm` on the London calendar date after `isoDate`, where an overnight clock-out or premium
 * boundary lands.
 *
 * Found on the calendar, never by adding 24 hours to the same time on `isoDate`, which is an
 * hour out across a clock change: a 20:00 to 02:00 session on Saturday 24 October 2026 was
 * stored with its clock-out at 01:00 GMT (an hour short), and one on Saturday 27 March 2027 at
 * 03:00 BST (an hour long).
 */
export function londonWallClockOnNextDate(isoDate: string, hhmm: string): Date | null {
  const nextDate = shiftIsoDate(isoDate, 1)
  return nextDate ? londonWallClockToInstant(nextDate, hhmm) : null
}

/**
 * A clock-out typed for a session worked on `workDate`: that time on the work date, or on the
 * next London calendar date when it would not be after the clock-in, which is an overnight
 * shift. Null when the date or time is not real.
 */
export function resolveClockOutInstant(workDate: string, clockOutTime: string, clockIn: Date): Date | null {
  const sameDay = londonWallClockToInstant(workDate, clockOutTime)
  if (!sameDay) return null
  if (sameDay.getTime() > clockIn.getTime()) return sameDay
  return londonWallClockOnNextDate(workDate, clockOutTime)
}

/**
 * A premium window boundary typed as HH:mm on the manager screen, as an ISO instant: that time
 * on the work date, or on the next London calendar date when it falls before the clock-in (the
 * part of an overnight shift after midnight). Null when blank or not real. The server clamps
 * the window to the worked interval afterwards, but that cannot move a boundary that is already
 * inside it, so the boundary itself has to land on the right hour.
 */
export function resolvePremiumBoundaryIso(workDate: string, clockInTime: string, hhmm: string): string | null {
  if (!hhmm) return null
  const sameDay = londonWallClockToInstant(workDate, hhmm)
  if (!sameDay) return null

  const clockIn = londonWallClockToInstant(workDate, clockInTime)
  if (clockIn && sameDay.getTime() < clockIn.getTime()) {
    return londonWallClockOnNextDate(workDate, hhmm)?.toISOString() ?? null
  }
  return sameDay.toISOString()
}

/**
 * The stored instant when `resolved` shows the same London date and time to the minute,
 * otherwise `resolved`.
 *
 * The edit forms send both times back as HH:mm on every save, even when only the notes or the
 * premium changed. HH:mm cannot tell the two 01:30s apart on the night the clocks go back, so
 * reading it back would move a kiosk clock-out made at the second 01:30 onto the first, or the
 * other way round, and it drops a kiosk time's seconds. A time the manager left alone keeps
 * exactly what was stored.
 */
export function keepStoredTimeWhenUnchanged(resolved: Date, storedIso: string | null | undefined): Date {
  if (!storedIso) return resolved
  const stored = new Date(storedIso)
  if (Number.isNaN(stored.getTime())) return resolved

  const shownAs = (instant: Date) => formatInTimeZone(instant, LONDON_TIMEZONE, 'yyyy-MM-dd HH:mm')
  return shownAs(stored) === shownAs(resolved) ? stored : resolved
}
