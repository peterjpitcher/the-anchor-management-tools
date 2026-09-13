// src/lib/business-hours/open-now.ts
//
// "Is the pub open right now?", answered from the London trading day in force rather
// than from today's row alone.
//
// A close after midnight is stored as a close earlier than the opening time: New Year's
// Eve is 12:00 to 01:00, and the 01:00 is 1am on 1 January. The booking functions, rota
// and checklists already read it that way. Reading today's row alone gets two things
// wrong:
//   * From midnight until that close, the PREVIOUS day's hours are the ones in force. At
//     00:30 on 1 January the party is still running on 31 December's hours, although
//     1 January itself is a closed day.
//   * Today's own row only opens at its opening time. Wrapping it round midnight said the
//     pub was open at 00:30 on 31 December, when 30 December had shut at 22:00.
//
// Times are London wall-clock times, turned into real instants with
// whenLondonClockReaches, so the two clock-change nights close at the right moment and
// count the minutes that actually pass.
//
// Pure: the caller loads the rows and passes them in.

import { shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import type { KitchenWindow } from '@/lib/business-hours/kitchen-windows'

/** The fields this needs from a special_hours or business_hours row. */
export interface TradingHours {
  opens: string | null
  closes: string | null
  is_closed?: boolean | null
}

/** One London date's opening, as real instants. */
export interface TradingWindow {
  /** The London date whose hours these are. */
  date: string
  opensAt: Date
  closesAt: Date
}

/** Seconds since midnight, for telling which of two clock times is later. Null when unreadable. */
function secondsOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  return (Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3] ?? '0')
}

/**
 * The window from `opens` to `closes` on a London date, or null when there is none.
 *
 * A close at or before the opening time falls on the next calendar day, so 12:00 to 01:00
 * closes at 1am the following morning and 12:00 to 00:00 at midnight.
 */
export function tradingWindowFor(
  date: string,
  hours: TradingHours | null | undefined,
): TradingWindow | null {
  if (!hours || hours.is_closed === true || !hours.opens || !hours.closes) return null

  const opens = secondsOfDay(hours.opens)
  const closes = secondsOfDay(hours.closes)
  const nextDay = shiftIsoDate(date, 1)
  if (opens === null || closes === null || nextDay === null) return null

  const opensAt = whenLondonClockReaches(date, hours.opens)
  const closesAt = whenLondonClockReaches(closes <= opens ? nextDay : date, hours.closes)
  if (!opensAt || !closesAt || closesAt <= opensAt) return null

  return { date, opensAt, closesAt }
}

export interface OpenNow<T extends TradingHours> {
  /** Whether the venue is open at this instant. */
  isOpen: boolean
  /** The London date whose hours are in force: yesterday's until its after-midnight close, else today's. */
  tradingDate: string
  /** That date's hours, exactly as passed in. */
  hours: T | null | undefined
  /** That date's window: the one open now, or today's when the venue is shut. Null on a closed day. */
  window: TradingWindow | null
}

/**
 * Which London day's hours are in force at `now`, and whether the venue is open.
 *
 * `today` and `yesterday` are the hours for those London dates: the special hours row
 * when the date has one, otherwise that date's regular row from the version in force on
 * it. On every day that closes before midnight this gives the same answer as reading
 * today's row alone.
 */
export function resolveOpenNow<T extends TradingHours>(
  now: Date,
  rows: { today: T | null | undefined; yesterday: T | null | undefined },
): OpenNow<T> {
  const todayDate = toLocalIsoDate(now)
  const yesterdayDate = shiftIsoDate(todayDate, -1) as string

  const lateNight = tradingWindowFor(yesterdayDate, rows.yesterday)
  if (lateNight && now >= lateNight.opensAt && now < lateNight.closesAt) {
    return { isOpen: true, tradingDate: yesterdayDate, hours: rows.yesterday, window: lateNight }
  }

  const window = tradingWindowFor(todayDate, rows.today)
  const isOpen = window !== null && now >= window.opensAt && now < window.closesAt
  return { isOpen, tradingDate: todayDate, hours: rows.today, window }
}

/**
 * The kitchen service being served at `now` on the trading date, with the instant it
 * ends, or null between services. `windows` are that date's, from resolveKitchenWindows.
 */
export function kitchenServiceAt(
  windows: KitchenWindow[],
  tradingDate: string,
  now: Date,
): { window: KitchenWindow; closesAt: Date } | null {
  for (const window of windows) {
    const span = tradingWindowFor(tradingDate, window)
    if (span && now >= span.opensAt && now < span.closesAt) return { window, closesAt: span.closesAt }
  }
  return null
}

const MS_PER_MINUTE = 60 * 1000

/**
 * "2 hours 30 minutes" from one instant to a later one.
 *
 * Measured between real instants rather than two clock times, so a close after midnight
 * counts forward to the next day instead of going negative, and the clock-change nights
 * count the minutes that actually pass. Seconds are dropped from both ends first, which
 * keeps the wording on every ordinary day exactly as it was.
 */
export function calculateTimeUntil(from: Date, to: Date): string {
  const diffMinutes = Math.floor(to.getTime() / MS_PER_MINUTE) - Math.floor(from.getTime() / MS_PER_MINUTE)

  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60

  if (hours > 0 && minutes > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`
  } else {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`
  }
}
