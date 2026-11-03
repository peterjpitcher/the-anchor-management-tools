import { addMonthsToIsoDate, getIsoWeekday, getTodayIsoDate, isValidIsoDate, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { TrainingError, type TrainingAssignmentReason } from './types'

/**
 * Training dates (build contract section 3, "Dates"). Every date here is a London calendar date
 * as `YYYY-MM-DD`; today comes from `getTodayIsoDate()` in src/lib/dateUtils.ts and month moves
 * use `addMonthsToIsoDate` (moved into dateUtils, month-end safe including 29 February). Never
 * `getDay`, `getHours`, `toISOString().slice` or `toLocale*` without a zone.
 *
 * Calendar dates are compared as strings (YYYY-MM-DD sorts in date order) and moved with the
 * UTC-anchored helpers in dateUtils, so nothing here depends on the host machine's zone.
 */

/** A person counts as a new starter when they started on or after today minus this many days. */
export const NEW_STARTER_WINDOW_DAYS = 14

/** Due date for a cycle released when its prerequisite completes (spec 4.1). */
export const PREREQUISITE_DUE_DAYS = 14

/** Due date for an "ask everyone to redo" cycle (spec 5.3). */
export const REDO_DUE_DAYS = 14

/** After a pause ends, the due date is at least this many days after the resume date (spec 4.4). */
export const RESUME_GRACE_DAYS = 14

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Throws a TrainingError 'invalid' unless `value` is a real YYYY-MM-DD date. */
function assertIsoDate(value: string, what: string): void {
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    throw new TrainingError('invalid', `${what} is not a real date: ${String(value)}`)
  }
}

/** Moves a date known to be real by whole days. */
function addDays(isoDate: string, days: number): string {
  const moved = shiftIsoDate(isoDate, days)
  if (moved === null) throw new TrainingError('invalid', `Cannot move ${isoDate} by ${days} days`)
  return moved
}

function laterOf(a: string, b: string): string {
  return a >= b ? a : b
}

/** The UTC midnight of a real YYYY-MM-DD date, for whole-day arithmetic. */
function utcMidnightMs(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** London today as YYYY-MM-DD. `now` is for tests; production leaves it out. */
export function trainingToday(now?: Date): string {
  return now ? toLocalIsoDate(now) : getTodayIsoDate()
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). Both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  assertIsoDate(from, 'The start date')
  assertIsoDate(to, 'The end date')
  return Math.round((utcMidnightMs(to) - utcMidnightMs(from)) / MS_PER_DAY)
}

/**
 * Age in whole years on `onDate`, or null when the date of birth is missing, not a real date,
 * or after `onDate` (unusable, so an age-restricted course is not assigned and the record is
 * flagged). Someone born on 29 February turns a year older on 1 March in a non-leap year, the
 * usual reading in England and Wales.
 */
export function ageOn(dateOfBirth: string | null, onDate: string): number | null {
  assertIsoDate(onDate, 'The date to work out an age on')
  if (!dateOfBirth || !isValidIsoDate(dateOfBirth) || dateOfBirth > onDate) return null
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number)
  const [year, month, day] = onDate.split('-').map(Number)
  const hadBirthdayThisYear = month > birthMonth || (month === birthMonth && day >= birthDay)
  return year - birthYear - (hadBirthdayThisYear ? 0 : 1)
}

/**
 * Whether a person counts as a new starter for a first cycle: their employment start date is on
 * or after `today - NEW_STARTER_WINDOW_DAYS`. A missing start date is not a new starter.
 */
export function isNewStarter(employmentStartDate: string | null, today: string): boolean {
  assertIsoDate(today, 'Today')
  if (!employmentStartDate || !isValidIsoDate(employmentStartDate)) return false
  return employmentStartDate >= addDays(today, -NEW_STARTER_WINDOW_DAYS)
}

/**
 * The due date of a first cycle (`computeInitialDueOn`, contract section 3):
 * - `new_starter`: `max(startDate + newStarterDays, today)`;
 * - any other reason: `today + existingStaffDays`;
 * - a null rule for the reason means no due date (null).
 * A person with no start date (an invited starter whose date is not set yet) gets no due date
 * until a manager sets one, whatever the reason (spec 4.3).
 */
export function computeInitialDueOn(input: {
  reason: TrainingAssignmentReason
  employmentStartDate: string | null
  today: string
  newStarterDays: number | null
  existingStaffDays: number | null
}): string | null {
  const { reason, employmentStartDate, today, newStarterDays, existingStaffDays } = input
  assertIsoDate(today, 'Today')
  if (!employmentStartDate || !isValidIsoDate(employmentStartDate)) return null
  if (reason === 'new_starter') {
    if (newStarterDays === null) return null
    return laterOf(addDays(employmentStartDate, newStarterDays), today)
  }
  if (existingStaffDays === null) return null
  return addDays(today, existingStaffDays)
}

/**
 * When a completion expires (spec 4.3). A completion on or before the previous expiry extends from
 * the previous expiry, so finishing early loses nothing; otherwise it counts from `completedOn`.
 * Null when the course never expires (`refresherMonths` null).
 */
export function computeExpiresOn(refresherMonths: number | null, completedOn: string, previousExpiresOn: string | null): string | null {
  assertIsoDate(completedOn, 'The completion date')
  if (refresherMonths === null) return null
  if (!Number.isInteger(refresherMonths) || refresherMonths < 1) {
    throw new TrainingError('invalid', `A refresher period must be a whole number of months, not ${refresherMonths}`)
  }
  if (previousExpiresOn !== null) assertIsoDate(previousExpiresOn, 'The previous expiry date')
  const from = previousExpiresOn !== null && completedOn <= previousExpiresOn ? previousExpiresOn : completedOn
  return addMonthsToIsoDate(from, refresherMonths)
}

/** `expiresOn - windowDays`, the day a refresher cycle opens; null when there is no expiry. */
export function computeWindowOpensOn(expiresOn: string | null, windowDays: number): string | null {
  if (expiresOn === null) return null
  assertIsoDate(expiresOn, 'The expiry date')
  if (!Number.isInteger(windowDays) || windowDays < 0) {
    throw new TrainingError('invalid', `A refresher window must be a whole number of days, not ${windowDays}`)
  }
  return addDays(expiresOn, -windowDays)
}

/** The due date of a refresher cycle: `max(expiresOn, today)`. */
export function refresherDueOn(expiresOn: string, today: string): string {
  assertIsoDate(expiresOn, 'The expiry date')
  assertIsoDate(today, 'Today')
  return laterOf(expiresOn, today)
}

/**
 * The due date after a pause ends: `max(currentDueOn, resumedOn + RESUME_GRACE_DAYS)`. An item
 * with no due date keeps none.
 */
export function resumeDueOn(currentDueOn: string | null, resumedOn: string): string | null {
  assertIsoDate(resumedOn, 'The resume date')
  if (currentDueOn === null) return null
  assertIsoDate(currentDueOn, 'The due date')
  return laterOf(currentDueOn, addDays(resumedOn, RESUME_GRACE_DAYS))
}

/**
 * The due date after a manager unlocks a section: moved on by the whole London days it was
 * locked (`lockedAt` is an instant; `unlockedOn` a London date). No due date stays none. Locked
 * and unlocked on the same London day moves nothing.
 */
export function unlockDueOn(currentDueOn: string | null, lockedAt: string, unlockedOn: string): string | null {
  assertIsoDate(unlockedOn, 'The unlock date')
  const lockedOn = londonDateOf(lockedAt)
  if (currentDueOn === null) return null
  assertIsoDate(currentDueOn, 'The due date')
  const daysLocked = Math.max(0, daysBetween(lockedOn, unlockedOn))
  return addDays(currentDueOn, daysLocked)
}

/**
 * Whether a manager may set `newDueOn` as an extension: only later than the current due date
 * (or any date when there is none), and never before today.
 */
export function isAllowedExtension(currentDueOn: string | null, newDueOn: string, today: string): boolean {
  assertIsoDate(today, 'Today')
  if (typeof newDueOn !== 'string' || !isValidIsoDate(newDueOn)) return false
  if (newDueOn < today) return false
  if (currentDueOn === null) return true
  assertIsoDate(currentDueOn, 'The due date')
  return newDueOn > currentDueOn
}

/** The London date (YYYY-MM-DD) of an instant, for completion dates and pay report days. */
export function londonDateOf(instant: string): string {
  const parsed = typeof instant === 'string' && instant.trim() ? new Date(instant) : null
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    throw new TrainingError('invalid', `Not a real time: ${String(instant)}`)
  }
  return toLocalIsoDate(parsed)
}

/** The Monday of the London week holding `isoDate` (YYYY-MM-DD), for the weekly reminder key. */
export function mondayOf(isoDate: string): string {
  assertIsoDate(isoDate, 'The date')
  const weekday = getIsoWeekday(isoDate) as number
  return addDays(isoDate, 1 - weekday)
}
