// src/lib/business-hours/kitchen-windows.ts
//
// The kitchen's real service windows for a day.
//
// `kitchen_opens` / `kitchen_closes` bound the day, so a day that serves lunch
// 12:00-15:00 and dinner 16:00-21:00 is stored as 12:00-21:00 with two entries
// in `schedule_config`. Reading only the bounds says the kitchen is open right
// through the afternoon closure, which is how `/business/hours` came to report
// `kitchenOpen: true` at half three while the booking engine refused a food
// booking at the same minute. The sittings are the truth; the bounds are a
// convenience for consumers that cannot express more than one window.
//
// Pure, so the API route and anything else that needs to answer "is the kitchen
// serving right now" share one definition instead of drifting.

import type { ScheduleConfigItem } from '@/types/business-hours'

export interface KitchenWindow {
  /** As stored, so callers can format or compare as they already do. */
  opens: string
  closes: string
}

export interface KitchenWindowSource {
  is_closed?: boolean | null
  is_kitchen_closed?: boolean | null
  kitchen_opens?: string | null
  kitchen_closes?: string | null
  schedule_config?: ScheduleConfigItem[] | null
}

/** The pub never serves past the small hours, so a later end is bad data, not a wrap. */
const LATEST_OVERNIGHT_END_MINUTES = 6 * 60

/** Accepts 'HH:MM' and 'HH:MM:SS' alike, because the two are mixed in storage. */
export function toMinutesOfDay(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value).trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Where a window ends, measured from the start of its own day.
 *
 * A service ending at or before 06:00 has run past midnight and is measured
 * into the next day. One that ends before it starts at any other hour is
 * malformed rather than overnight, and is rejected instead of being read as a
 * service lasting most of a day.
 */
function endMinutes(window: KitchenWindow): number | null {
  const opens = toMinutesOfDay(window.opens)
  const closes = toMinutesOfDay(window.closes)
  if (opens === null || closes === null) return null
  if (closes > opens) return closes
  if (closes <= LATEST_OVERNIGHT_END_MINUTES) return closes + 1440
  return null
}

function fromMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440
  const hours = Math.floor(wrapped / 60)
  const minutes = wrapped % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * A day's kitchen service windows, in order, with touching services merged.
 *
 * The stored `kitchen_opens`/`kitchen_closes` are a CEILING, not merely a
 * fallback: services narrow the kitchen, they never widen it. Two things force
 * that. A `regular` service gates drinks as well as food, so the database
 * deliberately lets it run past the kitchen close (see the exemption in
 * validate_schedule_config), and live special-hours rows already do. And the
 * booking engine bounds food by BOTH, looping kitchen_opens to kitchen_closes
 * and then filtering each candidate through the service windows. Reading the
 * services alone was therefore looser than the engine this exists to agree with,
 * and would have advertised food outside kitchen hours.
 *
 * Absent bounds mean no kitchen service, whatever services remain on the row.
 * That is the codebase's other deliberate "closed" signal: the route maps it to
 * `kitchen: null`, and rota and booking both already honour it.
 *
 * Falls back to the whole bounded span when a day lists no services at all,
 * which is still the normal case for Saturdays and most special-hours entries.
 */
export function resolveKitchenWindows(day: KitchenWindowSource | null | undefined): KitchenWindow[] {
  if (!day) return []
  if (day.is_closed === true || day.is_kitchen_closed === true) return []

  const boundsOpen = toMinutesOfDay(day.kitchen_opens)
  const boundsClose = day.kitchen_opens && day.kitchen_closes
    ? endMinutes({ opens: day.kitchen_opens, closes: day.kitchen_closes })
    : null
  if (boundsOpen === null || boundsClose === null) return []

  const sittings = (day.schedule_config ?? [])
    .map((entry) => ({ opens: entry?.starts_at ?? '', closes: entry?.ends_at ?? '' }))
    .filter((window) => toMinutesOfDay(window.opens) !== null && endMinutes(window) !== null)
    .sort((a, b) => (toMinutesOfDay(a.opens) ?? 0) - (toMinutesOfDay(b.opens) ?? 0))

  if (sittings.length === 0) {
    return [{ opens: day.kitchen_opens as string, closes: day.kitchen_closes as string }]
  }

  const merged: KitchenWindow[] = []
  for (const window of sittings) {
    const previous = merged[merged.length - 1]
    if (previous && (toMinutesOfDay(window.opens) ?? 0) <= (endMinutes(previous) ?? 0)) {
      if ((endMinutes(window) ?? 0) > (endMinutes(previous) ?? 0)) previous.closes = window.closes
      continue
    }
    merged.push({ ...window })
  }

  // Clip to the kitchen's own hours. A service lying entirely outside them is
  // dropped: it is gating drinks, not food. If that leaves nothing, the kitchen
  // serves nothing bookable that day, which is what the engine also concludes.
  return merged.flatMap((window) => {
    const start = Math.max(toMinutesOfDay(window.opens) as number, boundsOpen)
    const end = Math.min(endMinutes(window) as number, boundsClose)
    if (end <= start) return []
    const unchanged =
      start === (toMinutesOfDay(window.opens) as number) && end === (endMinutes(window) as number)
    return [unchanged ? window : { opens: fromMinutes(start), closes: fromMinutes(end) }]
  })
}

/** The window being served at `time`, or null when the kitchen is between services. */
export function kitchenWindowAt(
  windows: KitchenWindow[],
  time: string,
): KitchenWindow | null {
  const nowMinutes = toMinutesOfDay(time)
  if (nowMinutes === null) return null

  for (const window of windows) {
    const opens = toMinutesOfDay(window.opens)
    const closes = endMinutes(window)
    if (opens === null || closes === null) continue

    // A window measured past midnight is also serving in the small hours of the
    // day it ends, so both readings of "now" are checked.
    if (nowMinutes >= opens && nowMinutes < closes) return window
    if (closes > 1440 && nowMinutes + 1440 >= opens && nowMinutes + 1440 < closes) return window
  }

  return null
}

/** The next window that starts after `time` today, for an "opens at" message. */
export function nextKitchenWindowAfter(
  windows: KitchenWindow[],
  time: string,
): KitchenWindow | null {
  const nowMinutes = toMinutesOfDay(time)
  if (nowMinutes === null) return null

  return (
    windows.find((window) => {
      const opens = toMinutesOfDay(window.opens)
      return opens !== null && opens > nowMinutes
    }) ?? null
  )
}

/** "12:00:00 - 15:00:00, 16:00:00 - 21:00:00", for human-readable summaries. */
export function describeKitchenWindows(windows: KitchenWindow[]): string {
  return windows.map((window) => `${window.opens} - ${window.closes}`).join(', ')
}
