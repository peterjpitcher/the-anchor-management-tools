/**
 * When an event happens, written the way a guest reads it.
 *
 * Every guest message about an event needs the same three answers: the instant it starts, the
 * London date, and the London clock time. Three places worked them out separately and two of
 * them were wrong in British Summer Time, because `new Date('2026-09-16T19:00:00')` is read as
 * UTC on the production server, so a 7pm event was announced as 8pm. The event's own
 * `start_datetime` is already an instant; a date plus a wall-clock time has to go through
 * `whenLondonClockReaches`, which is the only thing that gets the two clock-change nights right.
 *
 * Formatting is built from `Intl` parts rather than a locale pattern so the house date shape,
 * "Wednesday 16 September 2026", is identical in both test zones and never gains a comma.
 */
import { formatTimeInLondon, whenLondonClockReaches } from '@/lib/dateUtils'

const LONDON_TIMEZONE = 'Europe/London'

/** The three columns every event row carries for "when": an instant, or a London date and time. */
export type EventWhenSource = {
  start_datetime?: string | null
  date?: string | null
  time?: string | null
}

function isUsableDate(value: Date | null): value is Date {
  return value !== null && Number.isFinite(value.getTime())
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const parsed = new Date(iso)
  return isUsableDate(parsed) ? parsed : null
}

/**
 * The instant an event starts, as an ISO string.
 *
 * `start_datetime` is a timestamptz and already correct. The `date` + `time` fallback is a London
 * wall time, so it is resolved with `whenLondonClockReaches` rather than parsed directly.
 */
export function resolveEventStartIso(event: EventWhenSource | null | undefined): string | null {
  if (!event) return null

  const stored = toDate(event.start_datetime)
  if (stored) return stored.toISOString()

  if (!event.date) return null
  const wallTime = (event.time || '00:00').slice(0, 8)
  const resolved = whenLondonClockReaches(event.date, wallTime)
  return resolved ? resolved.toISOString() : null
}

/** The same answer as a Date, for callers that need to compare or store an instant. */
export function resolveEventStartDate(event: EventWhenSource | null | undefined): Date | null {
  const iso = resolveEventStartIso(event)
  return iso ? new Date(iso) : null
}

/** "Wednesday 16 September 2026", in London, with no comma. */
export function formatEventDateLondon(iso: string | null | undefined): string | null {
  const date = toDate(iso)
  if (!date) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date)
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
  const day = value('day')
  const month = value('month')
  const weekday = value('weekday')
  const year = value('year')
  if (!day || !month || !weekday || !year) return null
  return `${weekday} ${day} ${month} ${year}`
}

/** "Wednesday 16 September", for a subject line, where the year is noise. */
export function formatEventDateShortLondon(iso: string | null | undefined): string | null {
  const full = formatEventDateLondon(iso)
  if (!full) return null
  return full.split(' ').slice(0, 3).join(' ')
}

/** "7pm" or "6:30pm", from a London wall time written as HH:MM. */
export function formatWallClockTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(trimmed)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return minutes === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(minutes).padStart(2, '0')}${suffix}`
}

/** "7pm": the London clock time of an instant. */
export function formatEventTimeLondon(iso: string | null | undefined): string | null {
  const date = toDate(iso)
  if (!date) return null
  return formatWallClockTime(formatTimeInLondon(date))
}

/**
 * "Wednesday 16 September 2026 at 7pm", the one shape every guest email uses for an event.
 * Falls back to the date alone when there is no usable time, and to null when there is no date.
 */
export function formatEventWhenLondon(iso: string | null | undefined): string | null {
  const dateText = formatEventDateLondon(iso)
  if (!dateText) return null
  const timeText = formatEventTimeLondon(iso)
  return timeText ? `${dateText} at ${timeText}` : dateText
}

/**
 * "Wed 23 Sep at 7pm", for a text message, where every character is paid for and a second
 * segment costs twice as much. Emails use the long form above.
 */
export function formatEventWhenCompactLondon(iso: string | null | undefined): string | null {
  const longDate = formatEventDateLondon(iso)
  if (!longDate) return null
  // Abbreviated from the long names rather than asked for as "short", because en-GB gives
  // September as "Sept" and the exact abbreviation moves between ICU versions.
  const [weekday, day, month] = longDate.split(' ')
  const timeText = formatEventTimeLondon(iso)
  const dateText = `${weekday.slice(0, 3)} ${day} ${month.slice(0, 3)}`
  return timeText ? `${dateText} at ${timeText}` : dateText
}

/**
 * "Arrive from 6:30pm for a 7pm start.", the wording approved in SSOT section 16.
 *
 * "Doors" is banned wording: the pub is open long before an event starts, and "doors 6:30pm"
 * tells a guest it is shut until then. Returns null when the event carries no arrival time, so
 * a caller never invents one.
 */
export function buildEventArrivalLine(input: {
  doorsTime?: string | null
  startIso?: string | null
}): string | null {
  const arrival = formatWallClockTime(input.doorsTime)
  if (!arrival) return null
  const start = formatEventTimeLondon(input.startIso)
  if (!start) return `Arrive from ${arrival}.`
  return `Arrive from ${arrival} for ${indefiniteArticle(start)} ${start} start.`
}

/** "an 8pm start", "an 11pm start", "a 7pm start": eight and eleven are the two spoken vowels. */
function indefiniteArticle(timeText: string): string {
  const leadingHour = Number(/^\d+/.exec(timeText)?.[0] ?? '0')
  return leadingHour === 8 || leadingHour === 11 ? 'an' : 'a'
}
