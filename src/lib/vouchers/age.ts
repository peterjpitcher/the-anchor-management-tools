// Voucher age maths (spec 2.6, F39): completed London calendar days since issue,
// mutually exclusive buckets, and a humanised label for display.

import { toLocalIsoDate } from '@/lib/dateUtils'
import type { VoucherAgeBucket } from '@/types/vouchers'

const MS_PER_DAY = 86_400_000

function isoDateToUtcMs(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

// Completed London calendar days between the London date of isoTimestamp and
// the London date of now. Both instants are converted to London calendar dates
// first (via dateUtils), then differenced with pure UTC date arithmetic, so
// BST/GMT changes never produce off-by-one results.
export function completedLondonDaysSince(isoTimestamp: string, now: Date = new Date()): number {
  const startLondonDate = toLocalIsoDate(new Date(isoTimestamp))
  const endLondonDate = toLocalIsoDate(now)
  return Math.round((isoDateToUtcMs(endLondonDate) - isoDateToUtcMs(startLondonDate)) / MS_PER_DAY)
}

// Buckets are inclusive of their upper bound in completed days (F39):
// 0-30, 31-90, 91-180, 181+.
export function ageBucket(days: number): VoucherAgeBucket {
  if (days <= 30) return '0-30'
  if (days <= 90) return '31-90'
  if (days <= 180) return '91-180'
  return '181+'
}

// Humanised age for display: days below 14 days, weeks from 14 days, months
// from 61 days, simple rounding (weeks by 7, months by 30).
export function humaniseAge(days: number): string {
  if (days < 14) {
    const clamped = Math.max(0, days)
    return clamped === 1 ? '1 day' : `${clamped} days`
  }
  if (days < 61) {
    const weeks = Math.round(days / 7)
    return `${weeks} weeks`
  }
  const months = Math.round(days / 30)
  return `${months} months`
}
