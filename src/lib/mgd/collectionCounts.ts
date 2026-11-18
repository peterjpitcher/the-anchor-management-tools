/**
 * Counting MGD collections per return period in memory.
 *
 * Returns and collections have no foreign key: a collection belongs to every
 * return whose period contains its date, both ends inclusive (the same
 * `collection_date >= period_start AND collection_date <= period_end` the
 * per-period count queries used). `collection_date` is a Postgres `date`, so
 * PostgREST returns it as a plain `YYYY-MM-DD` string; those strings sort in
 * date order, so comparing them as strings involves no time zone at all.
 */

import { getCurrentMgdQuarter, type MgdQuarter } from '@/lib/mgd/quarterMapping'

export interface MgdPeriod {
  period_start: string
  period_end: string
}

/** Strips any time part so a timestamp-shaped value still compares by its date. */
function toDateKey(value: string): string {
  return value.slice(0, 10)
}

/**
 * Number of collection dates falling inside one period, both ends inclusive.
 */
export function countCollectionsInPeriod(
  collectionDates: readonly string[],
  period: MgdPeriod
): number {
  const start = toDateKey(period.period_start)
  const end = toDateKey(period.period_end)
  let count = 0
  for (const raw of collectionDates) {
    const date = toDateKey(raw)
    if (date >= start && date <= end) count++
  }
  return count
}

/**
 * Picks the return for the current MGD quarter (London date) from a list of
 * returns, matching on both period ends exactly as `getCurrentReturn()` does.
 */
export function findCurrentMgdReturn<T extends MgdPeriod>(
  returns: readonly T[],
  quarter: MgdQuarter = getCurrentMgdQuarter()
): T | null {
  return (
    returns.find(
      (r) => r.period_start === quarter.periodStart && r.period_end === quarter.periodEnd
    ) ?? null
  )
}
