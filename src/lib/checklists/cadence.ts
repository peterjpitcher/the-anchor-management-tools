// src/lib/checklists/cadence.ts
// Pure recurrence/cadence functions for the checklists engine (spec §4).
// No I/O, no timezone side effects: all date-only maths runs on UTC-midnight instants so
// results are identical under any TZ (tests run under TZ=UTC per spec §4 "Timezone").
// everySlots operates on already-zoned Date instants and uses date-fns for the arithmetic.

import { addMinutes } from 'date-fns'
import type { CadenceTemplate, InstanceState } from './types'

// --- UTC-safe date-only helpers -------------------------------------------------------

const MS_PER_DAY = 86_400_000

/** Parse a 'YYYY-MM-DD' string into a UTC-midnight Date (no local-timezone drift). */
function toUtcDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Format a UTC-midnight Date back to 'YYYY-MM-DD'. */
function toIso(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Whole calendar days from a to b (b minus a). Exact for UTC-midnight dates. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY)
}

/** Add whole days to a UTC-midnight date. */
function addDaysIso(iso: string, days: number): string {
  return toIso(new Date(toUtcDate(iso).getTime() + days * MS_PER_DAY))
}

/** Non-negative modulo so the maths holds for dates before the anchor. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Monday-based start of the ISO week for a UTC-midnight date. */
function weekStart(date: Date): Date {
  const day = date.getUTCDay() // 0 = Sunday
  const sinceMonday = (day + 6) % 7
  return new Date(date.getTime() - sinceMonday * MS_PER_DAY)
}

/** Last day-of-month (1..31) for the month containing the given UTC date. */
function lastDayOfMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
}

/** Whole calendar months from anchor to date (date minus anchor). */
function monthsBetween(anchor: Date, date: Date): number {
  return (date.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + (date.getUTCMonth() - anchor.getUTCMonth())
}

// --- Seasons (spec §4 "Seasons wrap the year end") ------------------------------------

/**
 * True when `date` (YYYY-MM-DD) falls inside the season bounded by `start`/`end` (MM-DD).
 * A null season means always in season. The window wraps the year end when start > end.
 */
export function inSeason(date: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  const d = date.slice(5) // 'MM-DD'
  return start <= end
    ? d >= start && d <= end
    : d >= start || d <= end
}

// --- Calendar recurrence (spec §4 "Recurrence anchors") -------------------------------

/**
 * True when a calendar template's recurrence lands on `date` (YYYY-MM-DD).
 * Handles only the recurrence anchor; season and weekday-set membership are composed by
 * the caller (generation, §5.4). Floating templates are never due here.
 */
export function isCalendarDueOn(t: CadenceTemplate, date: string): boolean {
  if (t.scheduleKind !== 'calendar' || !t.freq) return false

  const target = toUtcDate(date)
  const interval = t.freqInterval > 0 ? t.freqInterval : 1

  switch (t.freq) {
    case 'daily': {
      const anchor = t.anchorDate ? toUtcDate(t.anchorDate) : target
      return mod(daysBetween(anchor, target), interval) === 0
    }

    case 'weekly': {
      const weekday = target.getUTCDay()
      if (!t.byWeekday || !t.byWeekday.includes(weekday)) return false
      if (!t.anchorDate) return true // interval multiplier is meaningless without an anchor
      const weeks = daysBetween(weekStart(toUtcDate(t.anchorDate)), weekStart(target)) / 7
      return mod(Math.round(weeks), interval) === 0
    }

    case 'monthly':
    case 'quarterly':
    case 'annual': {
      if (!t.anchorDate) return false
      const anchor = toUtcDate(t.anchorDate)
      const monthStep = t.freq === 'annual' ? 12 : t.freq === 'quarterly' ? 3 : 1
      const period = monthStep * interval
      if (mod(monthsBetween(anchor, target), period) !== 0) return false
      // Match the anchor day-of-month, clamped to shorter months (31 to 30 Apr, 29 to 28 Feb).
      const clampedDay = Math.min(anchor.getUTCDate(), lastDayOfMonth(target))
      return target.getUTCDate() === clampedDay
    }

    default:
      return false
  }
}

// --- 'every N hours from open' slots (spec §4 / decision 25) ---------------------------

/**
 * Expand a trading window into 'every N hours from open' slot instants.
 * `opensAt`/`closesAt` are already-zoned instants (spec §5.3). The first slot lands at
 * open + firstOffsetMinutes (default everyHours*60); subsequent slots step by everyHours
 * while strictly before close (a slot exactly at close is dropped, that is the closing
 * list's job). Slots earlier than `notBefore` are dropped.
 */
export function everySlots(
  opensAt: Date,
  closesAt: Date,
  everyHours: number,
  opts?: { firstOffsetMinutes?: number | null; notBefore?: Date | null },
): Date[] {
  if (everyHours <= 0) return []

  const stepMinutes = everyHours * 60
  const firstOffset = opts?.firstOffsetMinutes ?? stepMinutes

  const slots: Date[] = []
  let t = addMinutes(opensAt, firstOffset)
  while (t < closesAt) {
    slots.push(t)
    t = addMinutes(t, stepMinutes)
  }

  const notBefore = opts?.notBefore
  return notBefore ? slots.filter((s) => s >= notBefore) : slots
}

// --- Floating recurrence (spec §4 "floating") -----------------------------------------

/**
 * The prior instance considered by the floating recurrence: the most recent instance in a
 * terminal state, with the dates the formula needs (all 'YYYY-MM-DD' business dates).
 */
interface PriorFloatingInstance {
  dueDate: string
  state: InstanceState
  completedDate: string | null
  graceDate: string
}

/**
 * The next floating due date (YYYY-MM-DD) per spec §4's worked table.
 * - no prior instance:      firstDueOn
 * - done:                   max(dueDate, completedDate) + interval
 * - missed:                 graceDate (miss date) + interval
 * - skipped/not_applicable: dueDate + interval
 */
export function nextFloatingDue(
  prior: PriorFloatingInstance | null,
  interval: number,
  firstDueOn: string,
): string {
  if (!prior) return firstDueOn

  switch (prior.state) {
    case 'done': {
      const base = prior.completedDate && prior.completedDate > prior.dueDate
        ? prior.completedDate
        : prior.dueDate
      return addDaysIso(base, interval)
    }
    case 'missed':
      return addDaysIso(prior.graceDate, interval)
    default: // 'skipped' | 'not_applicable' (and defensively 'pending')
      return addDaysIso(prior.dueDate, interval)
  }
}
