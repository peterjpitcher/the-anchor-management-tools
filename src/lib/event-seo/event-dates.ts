// Dates and times for event copy, worked out on the London clock so the model
// never has to. A wrong weekday has reached customers before (32 texts on
// 20 April 2026 said Thursday for a Friday).

import { formatDateInLondon, formatTime12Hour, isValidIsoDate } from '@/lib/dateUtils'

export type EventDateLabels = {
  /** "Friday 11 December 2026" */
  dateLong: string
  /** "Fri 11 Dec", as the website prints it in titles */
  dateShort: string
  /** "11 December" */
  dayMonth: string
  /** "Friday" */
  weekday: string
}

export function eventDateLabels(isoDate: string | null | undefined): EventDateLabels | null {
  if (!isoDate || !isValidIsoDate(isoDate.slice(0, 10))) return null
  const instant = `${isoDate.slice(0, 10)}T12:00:00Z`
  const weekday = formatDateInLondon(instant, { weekday: 'long' })
  const dayMonth = formatDateInLondon(instant, { day: 'numeric', month: 'long' })
  const year = formatDateInLondon(instant, { year: 'numeric' })
  return {
    dateLong: `${weekday} ${dayMonth} ${year}`,
    dateShort: formatDateInLondon(instant, { weekday: 'short', day: 'numeric', month: 'short' }),
    dayMonth,
    weekday,
  }
}

/** "19:00" or "19:00:00" to "7pm"; "19:30" to "7:30pm". Null when there is no time. */
export function eventTime12h(time: string | null | undefined): string | null {
  const value = time?.trim() ?? ''
  if (!/^\d{1,2}:\d{2}/.test(value)) return null
  // Already 12-hour ("7:00 PM"): tidy it to the house form rather than read it as 24-hour.
  const twelve = value.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i)
  if (twelve) return `${Number(twelve[1])}${twelve[2] === '00' ? '' : `:${twelve[2]}`}${twelve[3].toLowerCase()}m`
  return formatTime12Hour(value)
}

/**
 * True when the text names the day and month: "11 December", "11th December", or the
 * short form the prompt also offers as date_short ("11 Dec", "18 Sept").
 */
export function mentionsDayMonth(text: string, isoDate: string | null | undefined): boolean {
  const labels = eventDateLabels(isoDate)
  if (!labels || !text) return false
  const [day, month] = labels.dayMonth.split(' ')
  const shortMonth = labels.dateShort.split(' ').pop() ?? month.slice(0, 3)
  const months = Array.from(new Set([month, shortMonth, month.slice(0, 3)])).join('|')
  return new RegExp(`\\b${day}(?:st|nd|rd|th)?\\s+(?:${months})\\.?(?![a-z])`, 'i').test(text)
}

/** True when the text names the weekday as well as the day and month. */
export function mentionsWeekdayAndDate(text: string, isoDate: string | null | undefined): boolean {
  const labels = eventDateLabels(isoDate)
  if (!labels || !text) return false
  const shortDay = labels.weekday.slice(0, 3)
  return mentionsDayMonth(text, isoDate) && new RegExp(`\\b(${labels.weekday}|${shortDay})\\b`, 'i').test(text)
}
