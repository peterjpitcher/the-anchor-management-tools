/**
 * Run keys for crons that claim a time bucket so a retried or overlapping call does nothing.
 *
 * Built from UTC, never London wall time. On the night the clocks go back, 01:00 to 01:59 London
 * time happens twice; a key built from the London clock repeats for that hour, so the second set of
 * runs found the first set's completed rows and skipped (BK-208, 25 October 2026). UTC never
 * repeats an hour.
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 'utc:YYYY-MM-DDTHH:mm' for the UTC bucket `now` falls in.
 *
 * The 'utc:' prefix keeps a new key from ever matching an old London-clock key. On the day this
 * shipped in summer time, a UTC bucket would otherwise have the same text as the London bucket an
 * hour earlier and that run would have been skipped.
 */
export function utcBucketRunKey(now: Date, intervalMinutes: number): string {
  const bucketMinute = Math.floor(now.getUTCMinutes() / intervalMinutes) * intervalMinutes
  return `utc:${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}T${pad2(
    now.getUTCHours()
  )}:${pad2(bucketMinute)}`
}
