import { getTodayIsoDate, isValidIsoDate } from '@/lib/dateUtils'

/** The longest range one report or CSV covers, so one request cannot read every year at once. */
export const ONLINE_INCOME_MAX_DAYS = 400

export type OnlineIncomeRange = { from: string; to: string }

/**
 * The London date range of the online income report: the dates asked for when both are real dates
 * in order and no more than ONLINE_INCOME_MAX_DAYS apart, otherwise this month so far.
 */
export function resolveOnlineIncomeRange(
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
  today: string = getTodayIsoDate()
): OnlineIncomeRange & { adjusted: boolean } {
  const fallback = { from: `${today.slice(0, 8)}01`, to: today }
  if (!rawFrom && !rawTo) return { ...fallback, adjusted: false }
  if (!rawFrom || !rawTo || !isValidIsoDate(rawFrom) || !isValidIsoDate(rawTo) || rawFrom > rawTo) {
    return { ...fallback, adjusted: true }
  }
  const days = (Date.parse(`${rawTo}T00:00:00Z`) - Date.parse(`${rawFrom}T00:00:00Z`)) / 86_400_000
  if (days > ONLINE_INCOME_MAX_DAYS) return { ...fallback, adjusted: true }
  return { from: rawFrom, to: rawTo, adjusted: false }
}
