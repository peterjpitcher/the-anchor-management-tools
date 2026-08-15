// src/lib/business-hours/resolve.ts
//
// The TypeScript half of opening-hours resolution. Pure and dependency-free, so
// it can be unit tested and shared by every caller.
//
// There are two resolvers on purpose and they must agree:
//   * business_hours_for_date(date) in PostgreSQL, for point lookups inside the
//     booking functions.
//   * resolveForDates() here, for the pages that need a whole range at once.
//
// The range case is why this exists rather than calling the RPC per date. The
// missing-cashups action deliberately reduced up to 728 queries to three, and the
// rota planner covers similar spans. One RPC per day would undo that.
//
// The fixtures in __tests__/resolve.test.ts are shared with the SQL side so the
// two implementations cannot drift.

/** The minimum shape this needs. Matches BusinessHours in @/types/business-hours. */
export interface WeekdayRow {
  day_of_week: number
}

/** A published version and its seven weekday rows. */
export interface LoadedVersion<TRow extends WeekdayRow> {
  /** ISO date, the first day this version applies. */
  effectiveFrom: string
  rows: TRow[]
}

/**
 * The weekday number a 'YYYY-MM-DD' string falls on, 0 = Sunday to 6 = Saturday,
 * matching business_hours.day_of_week and PostgreSQL's EXTRACT(DOW).
 *
 * Deliberately not getIsoWeekday from dateUtils, which returns 1 = Monday to
 * 7 = Sunday. Using that here would shift every day and leave Sunday asking for
 * a day_of_week of 7, which no row has.
 *
 * Anchored at UTC midnight so the answer is the calendar date's weekday and does
 * not drift with the server's zone or with British Summer Time.
 */
export function weekdayOfIsoDate(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const ms = Date.parse(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms)
  // Reject dates that rolled, e.g. 2026-02-30 normalising to 2 March.
  if (d.toISOString().slice(0, 10) !== isoDate) return null
  return d.getUTCDay()
}

/**
 * Pick the version in force on a date: the latest whose effectiveFrom has
 * arrived. `versions` must contain published versions only, ordered ascending by
 * effectiveFrom. Returns null when the date predates every version.
 */
export function versionForDate<TRow extends WeekdayRow>(
  versions: LoadedVersion<TRow>[],
  isoDate: string,
): LoadedVersion<TRow> | null {
  let chosen: LoadedVersion<TRow> | null = null
  for (const version of versions) {
    if (version.effectiveFrom <= isoDate) chosen = version
    else break
  }
  return chosen
}

/**
 * Resolve many dates in one pass, without a query per date.
 *
 * A date with no applicable version, or whose version is missing that weekday, is
 * absent from the result rather than guessed at. Callers must treat a missing
 * entry as "hours unknown" and not as "closed": inventing a closure would silently
 * refuse bookings.
 */
export function resolveForDates<TRow extends WeekdayRow>(
  versions: LoadedVersion<TRow>[],
  isoDates: string[],
): Map<string, TRow> {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

  // One lookup table per version, built once rather than per date.
  const byVersion = new Map<string, Map<number, TRow>>()
  for (const version of sorted) {
    const dayMap = new Map<number, TRow>()
    for (const row of version.rows) dayMap.set(row.day_of_week, row)
    byVersion.set(version.effectiveFrom, dayMap)
  }

  const out = new Map<string, TRow>()
  for (const isoDate of isoDates) {
    const weekday = weekdayOfIsoDate(isoDate)
    if (weekday === null) continue
    const version = versionForDate(sorted, isoDate)
    if (!version) continue
    const row = byVersion.get(version.effectiveFrom)?.get(weekday)
    if (row) out.set(isoDate, row)
  }
  return out
}

/**
 * Which weekdays a version is missing. A published version must cover all seven,
 * and the publish RPC enforces that, but a range read should not assume it.
 */
export function missingWeekdays<TRow extends WeekdayRow>(version: LoadedVersion<TRow>): number[] {
  const present = new Set(version.rows.map(row => row.day_of_week))
  return [0, 1, 2, 3, 4, 5, 6].filter(day => !present.has(day))
}
