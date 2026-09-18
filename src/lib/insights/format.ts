/**
 * Text helpers for report sentences. Dates here are London calendar dates
 * (YYYY-MM-DD); they are formatted at noon UTC so the calendar day never shifts.
 */

const moneyWhole = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })
const moneyPence = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const count = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
// Spelled out rather than taken from Intl, whose short month names differ between ICU
// versions ("Sep" or "Sept"), so the printed report reads the same on every runtime.
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' })

function noonUtc(isoDate: string): Date {
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date ${isoDate}`)
  return date
}

/** "£1,234" or, with pence, "£1,234.56". Throws on a non-finite amount rather than printing NaN. */
export function formatMoney(amount: number, options: { pence?: boolean } = {}): string {
  if (!Number.isFinite(amount)) throw new Error('Cannot format a non-finite amount')
  return (options.pence ? moneyPence : moneyWhole).format(amount)
}

/** "24%" from a ratio of 0.24. */
export function formatPercent(ratio: number, decimals = 0): string {
  if (!Number.isFinite(ratio)) throw new Error('Cannot format a non-finite percentage')
  return `${(ratio * 100).toFixed(decimals)}%`
}

/** "12" or "12.5": whole numbers stay whole. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Cannot format a non-finite count')
  return count.format(value)
}

/** "Thu 24 Sep". */
export function formatDayDate(isoDate: string): string {
  const date = noonUtc(isoDate)
  return `${WEEKDAYS_SHORT[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`
}

/** "24 Sep 2026". */
export function formatDateWithYear(isoDate: string): string {
  const date = noonUtc(isoDate)
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** "Thursday". */
export function formatWeekday(isoDate: string): string {
  return WEEKDAYS_LONG[noonUtc(isoDate).getUTCDay()]
}

/** London wall-clock time of an instant, "14:32". */
export function formatLondonClock(instant: Date): string {
  return clock.format(instant)
}

/** "19:00" from a Postgres time such as "19:00:00". */
export function formatTimeOfDay(time: string | null | undefined): string | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null
}

/** "1 booking", "3 bookings", "1 party", "2 parties" with an explicit plural. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : pluralForm}`
}

/** Clips free text for the email, on a word boundary where possible. */
export function clip(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean
  const cut = clean.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`
}

/** Joins items as "a, b and c". */
export function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
