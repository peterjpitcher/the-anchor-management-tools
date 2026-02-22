import { fromZonedTime, toZonedTime } from 'date-fns-tz'

export const SHORT_LINK_INSIGHTS_TIMEZONE = 'Europe/London' as const

export type ShortLinkInsightsGranularity = 'hour' | 'day' | 'week' | 'month'

export interface ShortLinkInsightsPreset {
  value: string
  label: string
  amount: number
}

export interface ShortLinkInsightsRange {
  startAt: Date
  endAt: Date
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

const PRESETS_BY_GRANULARITY: Record<ShortLinkInsightsGranularity, ShortLinkInsightsPreset[]> = {
  hour: [
    { value: '24h', label: 'Last 24 hours', amount: 24 },
    { value: '48h', label: 'Last 48 hours', amount: 48 },
    { value: '72h', label: 'Last 72 hours', amount: 72 },
    { value: '168h', label: 'Last 7 days', amount: 168 },
  ],
  day: [
    { value: '7d', label: 'Last 7 days', amount: 7 },
    { value: '14d', label: 'Last 14 days', amount: 14 },
    { value: '30d', label: 'Last 30 days', amount: 30 },
    { value: '90d', label: 'Last 90 days', amount: 90 },
  ],
  week: [
    { value: '8w', label: 'Last 8 weeks', amount: 8 },
    { value: '12w', label: 'Last 12 weeks', amount: 12 },
    { value: '26w', label: 'Last 26 weeks', amount: 26 },
    { value: '52w', label: 'Last 52 weeks', amount: 52 },
  ],
  month: [
    { value: '3m', label: 'Last 3 months', amount: 3 },
    { value: '6m', label: 'Last 6 months', amount: 6 },
    { value: '12m', label: 'Last 12 months', amount: 12 },
    { value: '24m', label: 'Last 24 months', amount: 24 },
  ],
}

const MAX_BUCKETS_BY_GRANULARITY: Record<ShortLinkInsightsGranularity, number> = {
  hour: 24 * 31,
  day: 366,
  week: 260,
  month: 120,
}

function startOfLondonHour(value: Date): Date {
  const londonDate = toZonedTime(value, SHORT_LINK_INSIGHTS_TIMEZONE)
  londonDate.setMinutes(0, 0, 0)
  return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
}

function startOfLondonDay(value: Date): Date {
  const londonDate = toZonedTime(value, SHORT_LINK_INSIGHTS_TIMEZONE)
  londonDate.setHours(0, 0, 0, 0)
  return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
}

function startOfLondonWeek(value: Date): Date {
  const londonDate = toZonedTime(value, SHORT_LINK_INSIGHTS_TIMEZONE)
  londonDate.setHours(0, 0, 0, 0)
  const day = londonDate.getDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  londonDate.setDate(londonDate.getDate() - daysSinceMonday)
  return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
}

function startOfLondonMonth(value: Date): Date {
  const londonDate = toZonedTime(value, SHORT_LINK_INSIGHTS_TIMEZONE)
  londonDate.setHours(0, 0, 0, 0)
  londonDate.setDate(1)
  return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
}

function alignRangeEnd(value: Date, granularity: ShortLinkInsightsGranularity): Date {
  if (granularity === 'hour') return startOfLondonHour(value)
  if (granularity === 'day') return startOfLondonDay(value)
  if (granularity === 'week') return startOfLondonWeek(value)
  return startOfLondonMonth(value)
}

function subtractRange(value: Date, granularity: ShortLinkInsightsGranularity, amount: number): Date {
  const londonDate = toZonedTime(value, SHORT_LINK_INSIGHTS_TIMEZONE)

  if (granularity === 'hour') {
    londonDate.setHours(londonDate.getHours() - amount)
    return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
  }

  if (granularity === 'day') {
    londonDate.setDate(londonDate.getDate() - amount)
    return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
  }

  if (granularity === 'week') {
    londonDate.setDate(londonDate.getDate() - amount * 7)
    return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
  }

  londonDate.setMonth(londonDate.getMonth() - amount)
  return fromZonedTime(londonDate, SHORT_LINK_INSIGHTS_TIMEZONE)
}

function monthBucketEstimate(startAt: Date, endAt: Date): number {
  const startMonth = startOfLondonMonth(startAt)
  const endMonth = startOfLondonMonth(endAt)

  let monthDiff =
    (endMonth.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
    (endMonth.getUTCMonth() - startMonth.getUTCMonth())

  if (endAt.getTime() > endMonth.getTime()) {
    monthDiff += 1
  }

  return Math.max(monthDiff, 1)
}

export function getTimeframePresets(granularity: ShortLinkInsightsGranularity): ShortLinkInsightsPreset[] {
  return PRESETS_BY_GRANULARITY[granularity]
}

export function buildRangeFromPreset(
  granularity: ShortLinkInsightsGranularity,
  presetValue: string,
  now: Date = new Date()
): ShortLinkInsightsRange {
  const presets = getTimeframePresets(granularity)
  const selectedPreset = presets.find((preset) => preset.value === presetValue) ?? presets[0]
  const endAt = alignRangeEnd(now, granularity)
  const startAt = subtractRange(endAt, granularity, selectedPreset.amount)

  return { startAt, endAt }
}

export function getDefaultInsightsTimeframe(now: Date = new Date()) {
  const defaultGranularity: ShortLinkInsightsGranularity = 'hour'
  const defaultPreset = getTimeframePresets(defaultGranularity)[0]
  const range = buildRangeFromPreset(defaultGranularity, defaultPreset.value, now)

  return {
    granularity: defaultGranularity,
    preset: defaultPreset.value,
    includeBots: false,
    ...range,
  }
}

export function estimateBucketCount(
  startAt: Date,
  endAt: Date,
  granularity: ShortLinkInsightsGranularity
): number {
  const diffMs = endAt.getTime() - startAt.getTime()
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0

  if (granularity === 'hour') return Math.ceil(diffMs / HOUR_MS)
  if (granularity === 'day') return Math.ceil(diffMs / DAY_MS)
  if (granularity === 'week') return Math.ceil(diffMs / WEEK_MS)
  return monthBucketEstimate(startAt, endAt)
}

export function getMaxBucketCount(granularity: ShortLinkInsightsGranularity): number {
  return MAX_BUCKETS_BY_GRANULARITY[granularity]
}

export function validateInsightsRange(
  startAt: Date,
  endAt: Date,
  granularity: ShortLinkInsightsGranularity
): { valid: true; bucketCount: number } | { valid: false; error: string } {
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
    return { valid: false, error: 'Invalid date range' }
  }

  if (endAt.getTime() <= startAt.getTime()) {
    return { valid: false, error: 'Start time must be before end time' }
  }

  const bucketCount = estimateBucketCount(startAt, endAt, granularity)
  const maxBuckets = getMaxBucketCount(granularity)

  if (bucketCount > maxBuckets) {
    return {
      valid: false,
      error: `Selected range is too large for ${granularity} view (max ${maxBuckets} buckets).`,
    }
  }

  return { valid: true, bucketCount }
}

export function formatBucketLabel(
  bucketIso: string,
  granularity: ShortLinkInsightsGranularity,
  timezone: string = SHORT_LINK_INSIGHTS_TIMEZONE
): string {
  const date = new Date(bucketIso)
  if (!Number.isFinite(date.getTime())) return bucketIso

  if (granularity === 'hour') {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  }

  if (granularity === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      month: 'short',
      year: '2-digit',
    }).format(date)
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDateTimeLocalValue(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('-') + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function parseDateTimeLocalValue(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed
}
