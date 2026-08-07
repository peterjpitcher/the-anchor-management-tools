/**
 * Rate resolution for OJ Projects.
 *
 * Rates were resolved with `Number(snapshot || setting || 75)`. Zero is falsy,
 * so a client deliberately configured at a zero rate, or an entry snapshotted
 * at zero, silently fell through to the hardcoded default and was billed at
 * GBP 75 an hour. Zero is a real rate and must survive.
 */

export const DEFAULT_HOURLY_RATE_EX_VAT = 75
export const DEFAULT_MILEAGE_RATE = 0.55
export const DEFAULT_VAT_RATE = 20

/**
 * Returns the first candidate that is an actual number, so a configured zero
 * wins over the fallback behind it. Numeric strings are accepted because
 * Postgres numerics can arrive either way. Falls back to 0 when nothing is
 * usable, which is safer than inventing a charge.
 */
export function resolveRate(...candidates: Array<number | string | null | undefined>): number {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue
    const value = typeof candidate === 'number' ? candidate : Number(candidate)
    if (Number.isFinite(value)) return value
  }
  return 0
}
