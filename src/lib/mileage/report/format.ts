/**
 * Text formatting for the mileage report and CSV. Inputs are whole tenths of a mile and pence,
 * so no floating-point rounding happens here. Thousands separators are added by hand rather
 * than through toLocaleString, so output never depends on the host's locale data.
 */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatMilesText(tenths: number): string {
  return `${groupThousands(String(Math.floor(tenths / 10)))}.${tenths % 10}`
}

export function formatPoundsText(pence: number): string {
  const sign = pence < 0 ? '-' : ''
  const absolute = Math.abs(pence)
  return `${sign}£${groupThousands(String(Math.floor(absolute / 100)))}.${String(absolute % 100).padStart(2, '0')}`
}

export function formatPlainMiles(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`
}

export function formatPlainPounds(pence: number): string {
  const sign = pence < 0 ? '-' : ''
  const absolute = Math.abs(pence)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** "2 October 2026 at 14:05 (UK time)". hourCycle h23 avoids V8 printing noon as "0pm" in en-GB. */
export function formatGeneratedAt(isoTimestamp: string): string {
  // Postgres gives microseconds; Date.parse is only guaranteed to read milliseconds.
  const milliseconds = Date.parse(isoTimestamp.replace(/(\.\d{3})\d+/, '$1'))
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(milliseconds))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('day')} ${part('month')} ${part('year')} at ${part('hour')}:${part('minute')} (UK time)`
}
