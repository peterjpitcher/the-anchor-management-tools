// src/lib/business-hours/trading-day.ts
//
// Which trading day a moment or a clock time belongs to, when the hours run past midnight.
//
// A close after midnight is stored as a close earlier than the opening time: New Year's Eve
// is 12:00 to 01:00, and the 01:00 is 1am on 1 January. The booking functions already read
// a booking time on such a day the same way: 00:15 on 31 December is a quarter past
// midnight at the end of 31 December's hours, not the early morning of 31 December. Two
// things follow, and both are here:
//   * From midnight until that close, the trading day in force is still yesterday, so the
//     floor screen, walk-ins and "is the day finished" checks must follow it rather than
//     the calendar date.
//   * A clock time on a service date can fall on the next calendar day, so a booking's real
//     start has to be worked out from the date's hours, never by gluing the date to the time.
//
// On every day that closes before midnight both answers are exactly what the calendar date
// gives, so ordinary days are unchanged.

import type { createAdminClient } from '@/lib/supabase/admin'
import { shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { resolveOpenNow, tradingWindowFor, type TradingHours } from '@/lib/business-hours/open-now'
import { logger } from '@/lib/logger'

type Db = ReturnType<typeof createAdminClient>

export interface TradingDayInForce {
  /** The London date whose hours are in force: yesterday's until its after-midnight close, else today. */
  date: string
  /** When that stops being true: yesterday's late close, or for today midnight or its own later close. */
  until: Date
}

/**
 * The trading day in force at `now`, and the instant it stops being the one in force.
 *
 * `today` and `yesterday` are the hours for those London dates (see loadTradingHours).
 */
export function tradingDayInForce(
  now: Date,
  rows: { today: TradingHours | null | undefined; yesterday: TradingHours | null | undefined },
): TradingDayInForce {
  const today = toLocalIsoDate(now)
  const { tradingDate, window } = resolveOpenNow(now, rows)
  if (tradingDate !== today && window) return { date: tradingDate, until: window.closesAt }

  const midnight = whenLondonClockReaches(shiftIsoDate(today, 1) as string, '00:00') as Date
  return { date: today, until: window && window.closesAt > midnight ? window.closesAt : midnight }
}

/**
 * The instant a clock time ('HH:MM' or 'HH:MM:SS') on a service date refers to, or null when
 * either is not valid.
 *
 * On a day whose hours run past midnight, a time before the opening time is on the next
 * calendar day when it falls before the close (00:15 on New Year's Eve is 00:15 on 1 January).
 * A time outside the hours altogether goes to whichever end of the day it sits nearer, so a
 * booking dragged to just after the close stays at the end of the night. Any other day, or no
 * readable hours, keeps the time on the service date itself.
 */
export function serviceInstantFor(
  serviceDate: string,
  time: string,
  hours: TradingHours | null | undefined,
): Date | null {
  const onServiceDate = whenLondonClockReaches(serviceDate, time)
  if (!onServiceDate) return null

  const window = tradingWindowFor(serviceDate, hours)
  const nextDay = shiftIsoDate(serviceDate, 1)
  if (!window || !nextDay || toLocalIsoDate(window.closesAt) === serviceDate) return onServiceDate
  if (onServiceDate >= window.opensAt) return onServiceDate

  const onNextDay = whenLondonClockReaches(nextDay, time)
  if (!onNextDay) return onServiceDate
  if (onNextDay < window.closesAt) return onNextDay

  const beforeOpening = window.opensAt.getTime() - onServiceDate.getTime()
  const afterClosing = onNextDay.getTime() - window.closesAt.getTime()
  return afterClosing < beforeOpening ? onNextDay : onServiceDate
}

type SpecialRow = TradingHours & { date: string }

/**
 * The hours for each date, special hours over the weekly row in force on it, field by field
 * as the booking functions read them (COALESCE of each column). A date with neither is null.
 * Throws when either read fails, so each caller decides what an unreadable answer means.
 */
export async function loadTradingHours(db: Db, dates: string[]): Promise<Map<string, TradingHours | null>> {
  const unique = [...new Set(dates)]
  const [specialResult, ...regularResults] = await Promise.all([
    db.from('special_hours').select('date, opens, closes, is_closed').in('date', unique),
    ...unique.map((date) => db.rpc('business_hours_for_date', { p_date: date })),
  ])
  if (specialResult.error) throw specialResult.error

  const specials = new Map<string, SpecialRow>()
  for (const row of (specialResult.data ?? []) as SpecialRow[]) specials.set(row.date, row)

  const hours = new Map<string, TradingHours | null>()
  unique.forEach((date, index) => {
    const result = regularResults[index]
    if (result.error) throw result.error
    const regular = (((result.data ?? []) as TradingHours[])[0] ?? null)
    const special = specials.get(date) ?? null
    hours.set(
      date,
      special || regular
        ? {
            opens: special?.opens ?? regular?.opens ?? null,
            closes: special?.closes ?? regular?.closes ?? null,
            is_closed: special?.is_closed ?? regular?.is_closed ?? false,
          }
        : null,
    )
  })
  return hours
}

const RETRY_WHEN_UNREADABLE_MS = 5 * 60 * 1000

/**
 * The trading day in force now, read from the database.
 *
 * When the hours cannot be read this logs it and falls back to the calendar date, which is
 * right on every ordinary day, and says to ask again in five minutes rather than at midnight.
 */
export async function resolveTradingDayNow(db: Db, now: Date = new Date()): Promise<TradingDayInForce & { unreadable?: true }> {
  const today = toLocalIsoDate(now)
  const yesterday = shiftIsoDate(today, -1) as string
  try {
    const hours = await loadTradingHours(db, [yesterday, today])
    return tradingDayInForce(now, { today: hours.get(today), yesterday: hours.get(yesterday) })
  } catch (error) {
    logger.error('Opening hours unreadable, so the trading day fell back to the calendar date', {
      error: error instanceof Error ? error : new Error(String((error as { message?: unknown })?.message ?? error)),
      metadata: { today },
    })
    return { date: today, until: new Date(now.getTime() + RETRY_WHEN_UNREADABLE_MS), unreadable: true }
  }
}
