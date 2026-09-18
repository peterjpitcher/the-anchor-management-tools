// src/lib/cashing-up/trading-days.ts
//
// Which London dates the venue traded on, and so which dates expect a cash-up, from special
// hours over the published weekly hours. Moved out of the missing-cash-ups server action so the
// weekly insights report can use the same rules with its own client (spec 4.8 and 5.13).
//
// Everything here takes the client from the caller and never creates one.

import type { createAdminClient } from '@/lib/supabase/admin'
import type { TradingHours } from '@/lib/business-hours/open-now'
import { getBusinessHoursForDates } from '@/lib/business-hours/effective'
import { tradingDayInForce } from '@/lib/business-hours/trading-day'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { eachIsoDateInRange, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'

type Db = ReturnType<typeof createAdminClient>

interface SpecialRow {
  date: string
  opens: string | null
  closes: string | null
  is_closed: boolean | null
}

export interface TradingDay {
  date: string
  /** The venue was open, so a cash-up is expected. */
  open: boolean
  /** The special-hours row decided the day rather than the weekly hours. */
  special: boolean
  /** Special hours over the weekly row, field by field. Null when neither exists. */
  hours: TradingHours | null
}

/**
 * Whether the venue traded on each date.
 *
 * A special-hours row decides on its own: open unless it is marked closed. Otherwise the
 * weekly row in force decides, and a date no published version covers counts as closed, so
 * a gap in the hours never invents a missing cash-up. Throws when the hours cannot be read,
 * so a caller never mistakes an unreadable answer for "no special hours".
 */
export async function loadTradingDays(db: Db, dates: string[]): Promise<Map<string, TradingDay>> {
  const unique = [...new Set(dates)].sort()
  const result = new Map<string, TradingDay>()
  if (unique.length === 0) return result

  const [specialRows, weekly] = await Promise.all([
    fetchAllRows<SpecialRow>(
      (from, to) => db
        .from('special_hours')
        .select('date, opens, closes, is_closed')
        .gte('date', unique[0])
        .lte('date', unique[unique.length - 1])
        .order('date')
        .range(from, to),
      { label: 'special hours for trading days' },
    ),
    getBusinessHoursForDates(unique, db),
  ])

  const specials = new Map<string, SpecialRow>()
  for (const row of specialRows) specials.set(String(row.date).slice(0, 10), row)

  for (const date of unique) {
    const special = specials.get(date)
    const regular = weekly.get(date)
    result.set(date, {
      date,
      open: special ? special.is_closed !== true : !(regular?.is_closed ?? true),
      special: Boolean(special),
      hours: special || regular
        ? {
            opens: special?.opens ?? regular?.opens ?? null,
            closes: special?.closes ?? regular?.closes ?? null,
            is_closed: special?.is_closed ?? regular?.is_closed ?? false,
          }
        : null,
    })
  }
  return result
}

/**
 * True while yesterday's hours are still in force: from midnight until an after-midnight
 * close (1am on New Year's Eve) the till is still open, so yesterday is not yet missing.
 */
export function isYesterdayStillTrading(now: Date, yesterday: TradingDay | undefined): boolean {
  const yesterdayIso = shiftIsoDate(toLocalIsoDate(now), -1)
  if (!yesterday || yesterday.date !== yesterdayIso) return false
  return tradingDayInForce(now, { today: null, yesterday: yesterday.hours }).date === yesterdayIso
}

/** Trading dates, in order, with no cash-up entered and not skipped. */
export function missingCashupDates(
  dates: string[],
  tradingDays: Map<string, TradingDay>,
  enteredDates: Set<string>,
  skip: Set<string> = new Set(),
): string[] {
  return dates.filter((date) => !enteredDates.has(date) && !skip.has(date) && tradingDays.get(date)?.open === true)
}

export interface FindMissingCashupsOptions {
  siteId: string
  /** First London date checked. */
  from: string
  /** Last London date checked, normally yesterday. */
  to: string
  now: Date
}

/**
 * Trading dates for one site with no cash-up. Any live (not voided) session counts as a
 * cash-up, whatever its status, so a draft is opened rather than started again. Yesterday is
 * skipped while its hours are still in force.
 */
export async function findMissingCashupDates(db: Db, options: FindMissingCashupsOptions): Promise<string[]> {
  const dates = eachIsoDateInRange(options.from, options.to)
  if (dates.length === 0) return []

  const [sessions, tradingDays] = await Promise.all([
    fetchAllRows<{ id: string; session_date: string }>(
      (from, to) => db
        .from('cashup_sessions')
        .select('id, session_date')
        .eq('site_id', options.siteId)
        .is('voided_at', null)
        .gte('session_date', options.from)
        .lte('session_date', options.to)
        .order('id')
        .range(from, to),
      { label: 'cash-up sessions for missing dates' },
    ),
    loadTradingDays(db, dates),
  ])

  const entered = new Set(sessions.map((session) => String(session.session_date).slice(0, 10)))
  const yesterdayIso = shiftIsoDate(toLocalIsoDate(options.now), -1) as string
  const skip = new Set<string>()
  if (isYesterdayStillTrading(options.now, tradingDays.get(yesterdayIso))) skip.add(yesterdayIso)

  return missingCashupDates(dates, tradingDays, entered, skip)
}
