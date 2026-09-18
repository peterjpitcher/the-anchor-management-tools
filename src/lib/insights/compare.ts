import { NOTABLE_CHANGE, TREND_CHANGE } from './thresholds'
import { formatPercent } from './format'
import type { DateRange } from './types'

/**
 * Comparison rules shared by every section (spec 4.4). A change is only called out when
 * it is both proportionally and absolutely meaningful, so 1 to 2 is never "up 100%".
 */

export type ComparisonKind = 'up' | 'down' | 'steady' | 'new' | 'none' | 'no_history'

export interface Comparison {
  kind: ComparisonKind
  current: number
  /** Null when there is not enough history to compare. */
  baseline: number | null
  /** Proportional change; null when the baseline is null or zero. */
  change: number | null
  /** Absolute difference; null when the baseline is null. */
  diff: number | null
  notable: boolean
}

/** Total over a window expressed per week. */
export function weeklyAverage(total: number, range: DateRange): number {
  return total / (range.days / 7)
}

export function compare(current: number, baseline: number | null, floor: number, threshold = NOTABLE_CHANGE): Comparison {
  if (!Number.isFinite(current)) throw new Error('Comparison needs a finite current value')
  if (baseline === null || !Number.isFinite(baseline)) {
    return { kind: 'no_history', current, baseline: null, change: null, diff: null, notable: false }
  }
  const diff = current - baseline
  if (baseline === 0) {
    if (current === 0) return { kind: 'none', current, baseline, change: null, diff: 0, notable: false }
    return { kind: 'new', current, baseline, change: null, diff, notable: current >= floor }
  }
  const change = diff / baseline
  const notable = Math.abs(change) >= threshold && Math.abs(diff) >= floor
  return { kind: notable ? (diff > 0 ? 'up' : 'down') : 'steady', current, baseline, change, diff, notable }
}

export type TrendKind = 'growing' | 'declining' | 'steady' | 'no_history'

/** "Are we growing?": the 4-week weekly average against the 13-week weekly average. */
export function trend(fourWeekAverage: number | null, thirteenWeekAverage: number | null, floorPerWeek: number): TrendKind {
  if (fourWeekAverage === null || thirteenWeekAverage === null) return 'no_history'
  const result = compare(fourWeekAverage, thirteenWeekAverage, floorPerWeek, TREND_CHANGE)
  if (result.kind === 'up' || (result.kind === 'new' && result.notable)) return 'growing'
  if (result.kind === 'down') return 'declining'
  return 'steady'
}

/**
 * True when the source was collecting data on or before the window start. This proves
 * age, not completeness; sources with an expected count check completeness separately.
 */
export function hasMinimumHistory(collectionStart: string | null | undefined, windowStart: string): boolean {
  if (!collectionStart) return false
  return collectionStart.slice(0, 10) <= windowStart
}

/**
 * "up 24% on the 4-week average", "in line with last week", "not enough history yet".
 * `label` names the baseline: "last week", "the 4-week average", "the 13-week average".
 */
export function describeChange(comparison: Comparison, label: string): string {
  switch (comparison.kind) {
    case 'no_history': return `not enough history yet for ${label}`
    case 'none': return `no activity, as in ${label}`
    case 'new': return `new activity (none in ${label})`
    case 'steady': return `in line with ${label}`
    case 'up': return `up ${formatPercent(comparison.change ?? 0)} on ${label}`
    case 'down': return `down ${formatPercent(Math.abs(comparison.change ?? 0))} on ${label}`
  }
}

export function describeTrend(kind: TrendKind, subject: string): string {
  switch (kind) {
    case 'growing': return `${subject} are growing: the last 4 weeks are ahead of the 13-week average.`
    case 'declining': return `${subject} are declining: the last 4 weeks are behind the 13-week average.`
    case 'steady': return `${subject} are steady over 13 weeks.`
    case 'no_history': return `Not enough history yet to judge the trend in ${subject.toLowerCase()}.`
  }
}
