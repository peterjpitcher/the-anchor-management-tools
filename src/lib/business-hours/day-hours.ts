// src/lib/business-hours/day-hours.ts
//
// The hours in force on each of a set of dates, special hours over the weekly row field by field,
// exactly as the booking functions read them (COALESCE of each column): the pub is shut when
// is_closed, and the kitchen when is_kitchen_closed or it has no hours. Three queries for weekly
// hours whatever the range, plus one for special hours.

import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessHoursForDates } from '@/lib/business-hours/effective'
import { eachIsoDateInRange } from '@/lib/dateUtils'

// `any` because the admin client and the test fakes share no exported type (as readiness.ts).
type Db = ReturnType<typeof createAdminClient> | any

export interface DayHours {
  date: string
  /** False when neither weekly nor special hours apply: hours unknown, never "closed". */
  known: boolean
  closed: boolean
  kitchenClosed: boolean
  opens: string | null
  closes: string | null
  kitchenOpens: string | null
  kitchenCloses: string | null
  /** Special hours set this date. */
  special: boolean
}

type HoursRow = {
  date?: string
  opens: string | null
  closes: string | null
  kitchen_opens: string | null
  kitchen_closes: string | null
  is_closed: boolean | null
  is_kitchen_closed: boolean | null
}

function clock(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 5) : null
}

/** Combine one date's weekly and special rows, field by field. Pure, for tests. */
export function combineDayHours(date: string, weekly: HoursRow | null, special: HoursRow | null): DayHours {
  if (!weekly && !special) {
    return { date, known: false, closed: false, kitchenClosed: false, opens: null, closes: null, kitchenOpens: null, kitchenCloses: null, special: false }
  }
  const opens = clock(special?.opens ?? weekly?.opens)
  const closes = clock(special?.closes ?? weekly?.closes)
  const kitchenOpens = clock(special?.kitchen_opens ?? weekly?.kitchen_opens)
  const kitchenCloses = clock(special?.kitchen_closes ?? weekly?.kitchen_closes)
  const closed = Boolean(special?.is_closed ?? weekly?.is_closed ?? false) || !opens || !closes
  const kitchenClosed = closed || Boolean(special?.is_kitchen_closed ?? weekly?.is_kitchen_closed ?? false) || !kitchenOpens || !kitchenCloses
  return { date, known: true, closed, kitchenClosed, opens, closes, kitchenOpens, kitchenCloses, special: Boolean(special) }
}

/** The hours for every date from start to end. Throws when either read fails. */
export async function loadDayHours(startIso: string, endIso: string, db: Db = createAdminClient()): Promise<Map<string, DayHours>> {
  const dates = eachIsoDateInRange(startIso, endIso)
  const hours = new Map<string, DayHours>()
  if (dates.length === 0) return hours

  const [weekly, specialResult] = await Promise.all([
    getBusinessHoursForDates(dates, db),
    db
      .from('special_hours')
      .select('date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed')
      .gte('date', startIso)
      .lte('date', endIso),
  ])
  if (specialResult.error) throw new Error(`Could not read special hours: ${specialResult.error.message}`)
  const specials = new Map<string, HoursRow>()
  for (const row of (specialResult.data ?? []) as Array<HoursRow & { date: string }>) specials.set(row.date, row)

  for (const date of dates) {
    hours.set(date, combineDayHours(date, (weekly.get(date) as HoursRow | undefined) ?? null, specials.get(date) ?? null))
  }
  return hours
}
