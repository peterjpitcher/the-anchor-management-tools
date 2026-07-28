/**
 * "New product" badge window for menu dishes.
 *
 * Lives here rather than in the route file because Next.js route modules may
 * only export route handlers and a fixed set of config values, which would
 * otherwise leave this logic untestable.
 */

/** How long a dish stays badged as new by default: 8 weeks. */
export const DEFAULT_NEW_WINDOW_DAYS = 56;

/**
 * Normalises a DATE column value (or a timestamp string) to YYYY-MM-DD.
 * Returns null when the value is absent or unparseable, meaning "no bound".
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * True when `today` falls inside the dish's badge window.
 *
 * Both bounds are whole-day inclusive, matching the DATE columns behind them
 * and the availability window on menu assignments. An absent `newFrom` means
 * the dish was never flagged; an absent `newUntil` means the badge never
 * expires on its own.
 *
 * `today` is expected as YYYY-MM-DD in Europe/London, from getTodayIsoDate().
 */
export function isNewToday(newFrom: unknown, newUntil: unknown, today: string): boolean {
  const from = toIsoDate(newFrom);
  if (!from || from > today) return false;

  const until = toIsoDate(newUntil);
  return !until || until >= today;
}
