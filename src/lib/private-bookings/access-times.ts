/**
 * Setup and clear-down access times for a private booking.
 *
 * Owner rule, 2026-08-31: access is one hour before the start and one hour
 * after the end, unless the booking states otherwise. The contract used to
 * assert only the generic rule in its terms and never printed a time, so a
 * booking with a bespoke three-hour setup was contradicted by its own contract.
 *
 * This module resolves what the booking actually entitles the host to, and says
 * whether that came from the booking or from the default, so the contract can
 * word the two cases differently.
 *
 * The arithmetic is plain clock arithmetic on a local time-of-day, which is why
 * it lives here as a pure function rather than going near Date. Adding an hour
 * to 23:30 must land on 00:30 the following day, not on an instant, and must
 * not be affected by a clock change: a booking that runs until 23:00 on the
 * morning the clocks go forward still clears down at midnight by the clock on
 * the wall. Compare the elapsed-hours trap in the business-date resolver.
 */

/** Minutes past midnight, or null when the time is missing or unparseable. */
function toMinutes(time: string | null | undefined): number | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Shift a time of day by a signed number of minutes, reporting how many days
 * the result moved. `dayOffset` is -1 when it falls back past midnight and +1
 * when it runs past it.
 */
function shift(minutes: number, delta: number): { time: string; dayOffset: number } {
  const total = minutes + delta
  const dayOffset = Math.floor(total / (24 * 60))
  const withinDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  return { time: toHHMM(withinDay), dayOffset }
}

export interface AccessWindow {
  /** 24-hour "HH:MM", or null when it cannot be derived (no start/end recorded). */
  time: string | null
  /** True when this came from the one-hour default rather than the booking. */
  isDefault: boolean
  /** Days from the event date: -1 the evening before, +1 after midnight. */
  dayOffset: number
}

export interface BookingAccessInput {
  start_time?: string | null
  end_time?: string | null
  setup_time?: string | null
  cleardown_time?: string | null
  end_time_next_day?: boolean | null
}

export interface AccessTimes {
  setup: AccessWindow
  cleardown: AccessWindow
}

const ONE_HOUR = 60

export function resolveAccessTimes(booking: BookingAccessInput): AccessTimes {
  const start = toMinutes(booking.start_time)
  const end = toMinutes(booking.end_time)

  // Setup: stated time wins; otherwise one hour before the start.
  const statedSetup = toMinutes(booking.setup_time)
  const setup: AccessWindow =
    statedSetup !== null
      ? { time: toHHMM(statedSetup), isDefault: false, dayOffset: 0 }
      : start !== null
        ? { ...shift(start, -ONE_HOUR), isDefault: true }
        : { time: null, isDefault: true, dayOffset: 0 }

  // Clear-down: stated time wins; otherwise one hour after the end. An end time
  // already flagged as next-day starts a day ahead before the hour is added.
  const statedCleardown = toMinutes(booking.cleardown_time)
  const endBaseOffset = booking.end_time_next_day ? 1 : 0
  const cleardown: AccessWindow =
    statedCleardown !== null
      ? { time: toHHMM(statedCleardown), isDefault: false, dayOffset: endBaseOffset }
      : end !== null
        ? (() => {
            const shifted = shift(end, ONE_HOUR)
            return {
              time: shifted.time,
              isDefault: true,
              dayOffset: shifted.dayOffset + endBaseOffset,
            }
          })()
        : { time: null, isDefault: true, dayOffset: 0 }

  return { setup, cleardown }
}
