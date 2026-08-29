// src/lib/checklists/business-day.ts
// The single source of truth for "which checklist business day is it?".
//
// The London business day runs from `startHour` to the same wall-clock hour the
// next morning, so anything before `startHour` still belongs to the previous
// calendar date. That is what keeps a late close on the night it belongs to.
//
// Deliberately pure and dependency-free so the staff screen can import it. The
// settings-reading wrapper lives in ./settings.ts, which is server-only.

const TZ = 'Europe/London'

/** London wall-clock date, hour and minute for an instant. */
function londonParts(instant: Date): { iso: string; hour: number; minute: number } {
  // hourCycle 'h23' rather than hour12: en-GB with hour12 renders noon as "0pm"
  // on this Node version, which silently corrupts the hour.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? ''

  return {
    iso: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

/** Shift a 'YYYY-MM-DD' string back one calendar day. */
function previousIsoDate(iso: string): string {
  const utc = new Date(`${iso}T00:00:00Z`)
  utc.setUTCDate(utc.getUTCDate() - 1)
  return utc.toISOString().slice(0, 10)
}

/**
 * The checklist business date for an instant.
 *
 * Reads the London wall clock and shifts the calendar date back one day when the
 * local time is before the boundary.
 *
 * Never subtract `startHour` elapsed hours from the instant instead. That crosses
 * the DST discontinuity and is wrong on both clock-change mornings: on 2026-03-29
 * it returns the previous date at 05:01 London, and on 2026-10-25 it rolls a day
 * early at 04:59. The wall clock has no such discontinuity.
 */
export function businessDateOf(instant: Date, startHour: number): string {
  const { iso, hour } = londonParts(instant)
  return hour >= startHour ? iso : previousIsoDate(iso)
}

/**
 * Milliseconds from `instant` until the next business-day boundary. Used by the
 * staff screen to roll itself over instead of stranding an iPad on yesterday.
 */
export function msUntilNextBoundary(instant: Date, startHour: number): number {
  const { iso, hour } = londonParts(instant)
  const boundaryDate = hour >= startHour ? nextIsoDate(iso) : iso
  const boundary = londonWallClockToUtc(boundaryDate, startHour)
  return Math.max(0, boundary.getTime() - instant.getTime())
}

/** Shift a 'YYYY-MM-DD' string forward one calendar day. */
function nextIsoDate(iso: string): string {
  const utc = new Date(`${iso}T00:00:00Z`)
  utc.setUTCDate(utc.getUTCDate() + 1)
  return utc.toISOString().slice(0, 10)
}

/**
 * The instant at which `hour` o'clock London occurs on `iso`. Probes both
 * plausible UTC offsets and keeps the one that renders back to the wanted hour,
 * so it stays correct either side of a clock change without a date library.
 */
function londonWallClockToUtc(iso: string, hour: number): Date {
  for (const offset of [0, -1, 1]) {
    const candidate = new Date(
      `${iso}T${String(hour).padStart(2, '0')}:00:00Z`,
    )
    candidate.setUTCHours(candidate.getUTCHours() - offset)
    const rendered = londonParts(candidate)
    if (rendered.iso === iso && rendered.hour === hour) return candidate
  }
  // Spring-forward gap: the wanted hour does not exist on this date. Fall back to
  // the first instant after it, which is the boundary in practice.
  return new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00Z`)
}

/** Why the staff screen is going to refetch. */
export type RefreshReason = 'boundary' | 'window'

/**
 * When the staff screen should next refetch, and why.
 *
 * The screen renders a snapshot: the server filters out tasks whose window has not
 * opened yet, so the list is only correct for the instant it was built. Two things
 * make it stale: the next task window opening, and the business day rolling over.
 * Whichever comes first is the deadline.
 *
 * `nextWindowStart` is the earliest not-yet-open window the server withheld, or null
 * when there is nothing further to come today. An unparseable or already-past value is
 * ignored rather than trusted, so a bad payload can never park the screen on a deadline
 * in the past and refresh in a loop.
 */
export function msUntilNextRefresh(
  instant: Date,
  nextWindowStart: string | null,
  startHour: number,
): { ms: number; reason: RefreshReason } {
  const toBoundary = msUntilNextBoundary(instant, startHour)

  if (nextWindowStart) {
    const at = Date.parse(nextWindowStart)
    if (Number.isFinite(at)) {
      const toWindow = Math.max(0, at - instant.getTime())
      if (toWindow < toBoundary) return { ms: toWindow, reason: 'window' }
    }
  }

  return { ms: toBoundary, reason: 'boundary' }
}

/** A 24-hour clock hour as staff would say it: 0 -> '12am', 12 -> '12pm', 21 -> '9pm'. */
export function hourLabel(hour24: number): string {
  const suffix = hour24 < 12 ? 'am' : 'pm'
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${h}${suffix}`
}

/**
 * An instant as a short London wall-clock label: '9pm', '9:30pm', '5am'.
 *
 * Built from the same h23 Intl call as the rest of this module rather than from
 * `hour12`, which renders noon as '0pm' on this Node version.
 */
export function londonClockLabel(instant: Date): string {
  const { hour, minute } = londonParts(instant)
  const suffix = hour < 12 ? 'am' : 'pm'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return minute === 0 ? `${h}${suffix}` : `${h}:${String(minute).padStart(2, '0')}${suffix}`
}
