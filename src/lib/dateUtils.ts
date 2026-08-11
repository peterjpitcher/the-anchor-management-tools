import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const LONDON_TIMEZONE = 'Europe/London'

function toDate(value: string | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value)
}

const ISO_TIMEZONE_SUFFIX = /(?:z|[+-]\d{2}:?\d{2})$/i

export function parseLondonDateTimeLocal(value: string | null | undefined): Date | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const parsed = ISO_TIMEZONE_SUFFIX.test(trimmed)
    ? new Date(trimmed)
    : fromZonedTime(trimmed, LONDON_TIMEZONE)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseLondonDateTimeLocalToIso(value: string | null | undefined): string | null {
  return parseLondonDateTimeLocal(value)?.toISOString() ?? null
}

export function toLondonDateTimeLocalValue(value: string | Date | null | undefined): string {
  if (!value) return ''
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatInTimeZone(date, LONDON_TIMEZONE, "yyyy-MM-dd'T'HH:mm")
}

// UTC ISO instant → value for an <input type="datetime-local"> (London wall time, no seconds).
export function utcIsoToLondonLocalInput(iso: string): string {
  return formatInTimeZone(new Date(iso), LONDON_TIMEZONE, "yyyy-MM-dd'T'HH:mm")
}

// datetime-local value (London wall time) → UTC ISO instant, or null when blank.
export function londonLocalInputToUtcIso(local: string): string | null {
  return local ? fromZonedTime(local, LONDON_TIMEZONE).toISOString() : null
}

export function formatDateInLondon(
  date: string | Date,
  options?: Intl.DateTimeFormatOptions,
  locale: string = 'en-GB'
): string {
  const d = toDate(date)
  return d.toLocaleDateString(locale, { ...options, timeZone: LONDON_TIMEZONE })
}

export function formatDate(date: string | Date): string {
  const d = toDate(date)
  // Format as "January 15, 2024" (US format for legacy UI sections)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: LONDON_TIMEZONE
  })
}

/**
 * Returns today's date as YYYY-MM-DD in the Europe/London timezone.
 * On a UTC server during BST (UTC+1), e.g. 23:30 UTC = 00:30 London,
 * this correctly returns tomorrow's date.
 */
export function getTodayIsoDate(): string {
  return toLocalIsoDate(new Date())
}

/**
 * Converts a Date to YYYY-MM-DD in the Europe/London timezone.
 * Uses Intl.DateTimeFormat to get the correct London date regardless
 * of the host machine's timezone.
 */
export function toLocalIsoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(p => p.type === 'year')!.value
  const month = parts.find(p => p.type === 'month')!.value
  const day = parts.find(p => p.type === 'day')!.value

  return `${year}-${month}-${day}`
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Anchors a YYYY-MM-DD calendar date at midnight UTC, or null when it is not a real date.
 * Calendar dates carry no time or zone, so anchoring them in UTC keeps every operation on
 * them (comparison, iteration, weekday) identical on every machine. Building them with
 * `new Date(y, m, d)` instead would anchor them in the host's timezone, which shifts the
 * date by a day once it is read back in London.
 */
function isoDateToUtcMs(value: string): number | null {
  if (!ISO_DATE_PATTERN.test(value)) return null

  const [year, month, day] = value.split('-').map(Number)
  const ms = Date.UTC(year, month - 1, day)
  const date = new Date(ms)

  // Date.UTC rolls impossible dates forward (31 February becomes 3 March), so round-trip to reject them
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return ms
}

function utcMsToIsoDate(ms: number): string {
  const date = new Date(ms)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * True when the value is a real YYYY-MM-DD calendar date. Rejects both bad formats and
 * impossible dates such as 2026-02-30. Never depends on the host machine's timezone.
 */
export function isValidIsoDate(value: string): boolean {
  return isoDateToUtcMs(value) !== null
}

/**
 * ISO weekday for a YYYY-MM-DD calendar date: 1 = Monday through 7 = Sunday.
 * Returns null for an invalid date.
 */
export function getIsoWeekday(isoDate: string): number | null {
  const ms = isoDateToUtcMs(isoDate)
  if (ms === null) return null
  const day = new Date(ms).getUTCDay() // 0 = Sunday
  return day === 0 ? 7 : day
}

/**
 * Every calendar date from start to end inclusive, as YYYY-MM-DD strings.
 * Returns [] when either date is invalid or the end falls before the start.
 */
export function eachIsoDateInRange(startIsoDate: string, endIsoDate: string): string[] {
  const start = isoDateToUtcMs(startIsoDate)
  const end = isoDateToUtcMs(endIsoDate)
  if (start === null || end === null || end < start) return []

  const dates: string[] = []
  for (let ms = start; ms <= end; ms += MS_PER_DAY) {
    dates.push(utcMsToIsoDate(ms))
  }
  return dates
}

/**
 * Moves a YYYY-MM-DD calendar date by a whole number of days, forwards or backwards.
 * Returns null when the input is not a real date. Anchored in UTC so the result never
 * depends on the host machine's timezone or on a DST boundary being crossed.
 */
export function shiftIsoDate(isoDate: string, days: number): string | null {
  const ms = isoDateToUtcMs(isoDate)
  if (ms === null || !Number.isInteger(days)) return null
  return utcMsToIsoDate(ms + days * MS_PER_DAY)
}

export function getLocalIsoDateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return toLocalIsoDate(date)
}

export function getLocalIsoDateDaysAhead(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalIsoDate(date)
}

export function formatDateFull(date: string | Date | null): string {
  if (!date) return 'To be confirmed'
  return formatDateInLondon(date, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export function formatDateDdMmmmYyyy(date: string | Date | null | undefined): string {
  if (!date) return ''
  return formatDateInLondon(date, {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

export function formatTime12Hour(time: string | null): string {
  if (!time) return 'TBC'
  
  // Handle time in HH:MM format
  const [hours, minutes] = time.split(':').slice(0, 2).map(num => parseInt(num, 10))
  
  if (isNaN(hours) || isNaN(minutes)) return time
  
  const period = hours >= 12 ? 'pm' : 'am'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  
  // If minutes are 0, just show the hour (e.g., "7PM")
  // Otherwise show full time (e.g., "7:30PM")
  if (minutes === 0) {
    return `${displayHours}${period}`
  } else {
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`
  }
}

export function formatDateTime(date: string | Date): string {
  const d = toDate(date)
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: LONDON_TIMEZONE
  })
}

export function formatDateTime12Hour(date: string | Date): string {
  const d = toDate(date)
  const dateStr = d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: LONDON_TIMEZONE
  })

  const londonTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: LONDON_TIMEZONE
  })
    .format(d)
    .split(':')

  const [hours, minutes] = londonTime.length === 2 ? londonTime : ['00', '00']
  const timeStr = formatTime12Hour(`${hours}:${minutes}`)

  return `${dateStr} at ${timeStr}`
}

/**
 * Returns the start of the current London calendar day as a UTC Date object.
 * During GMT (winter): midnight London = midnight UTC (e.g. 2026-01-15T00:00:00Z)
 * During BST (summer): midnight London = 23:00 UTC the previous day (e.g. 2026-07-14T23:00:00Z)
 */
export function startOfLondonDayUtc(now: Date = new Date()): Date {
  const londonDate = toLocalIsoDate(now) // YYYY-MM-DD in London
  // Start with midnight UTC on that London date
  const midnightUtc = new Date(`${londonDate}T00:00:00Z`)
  // Walk forward hour by hour from midnight UTC to find when London date starts
  // During GMT: midnight UTC = midnight London (offset 0)
  // During BST: 23:00 UTC previous day = midnight London (offset -1h)
  // Check if one hour earlier is still the same London date
  const oneHourBefore = new Date(midnightUtc.getTime() - 60 * 60 * 1000)
  const dateOneHourBefore = toLocalIsoDate(oneHourBefore)
  if (dateOneHourBefore === londonDate) {
    // BST: one hour before midnight UTC is already this London date
    // so the London day started at 23:00 UTC the previous day
    return oneHourBefore
  }
  return midnightUtc
}

/**
 * The last instant of a London calendar day, as a UTC Date.
 *
 * Use this for date-only deadlines a customer has been told about. `new
 * Date('2026-08-20')` is 00:00 UTC, which means a deadline "of 20 August"
 * actually expires at the very start of the 20th (and at 01:00 on the 19th
 * during BST), so a nightly job cancels it on the morning of the day the
 * customer was promised.
 */
export function endOfLondonDayUtc(date: string | Date): Date | null {
  const isoDate = typeof date === 'string' ? date.slice(0, 10) : toLocalIsoDate(date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  return parseLondonDateTimeLocal(`${isoDate}T23:59:59`)
}

export function formatDateWithTimeForSms(date: string | Date, time?: string | null): string {
  const formattedDate = formatDateInLondon(date, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  if (!time) {
    return formattedDate
  }

  return `${formattedDate} at ${formatTime12Hour(time)}`
}
