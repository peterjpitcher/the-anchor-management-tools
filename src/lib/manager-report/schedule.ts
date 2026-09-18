import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { subDays } from 'date-fns'

const ZONE = 'Europe/London'

/** The weekly insights report goes at 06:00 London on Friday, in BST and GMT alike. */
export const REPORT_HOUR_LONDON = 6
/**
 * Until this hour a report with a section that could not be read is held back and
 * retried; from it, the report is sent with those sections marked "Not checked".
 */
export const PARTIAL_SEND_HOUR_LONDON = 9

export interface ManagerReportPeriod { key: string; periodStart: string; periodEnd: string }

/** Hourly Friday runs are allowed from 06:00 local time; `key` is the London date. */
export function managerReportPeriod(now: Date): ManagerReportPeriod | null {
  if (formatInTimeZone(now, ZONE, 'i') !== '5' || londonHour(now) < REPORT_HOUR_LONDON) return null
  const key = formatInTimeZone(now, ZONE, 'yyyy-MM-dd')
  const end = fromZonedTime(`${key}T0${REPORT_HOUR_LONDON}:00:00`, ZONE)
  const previousDate = formatInTimeZone(subDays(end, 7), ZONE, 'yyyy-MM-dd')
  return {
    key,
    periodStart: fromZonedTime(`${previousDate}T0${REPORT_HOUR_LONDON}:00:00`, ZONE).toISOString(),
    periodEnd: end.toISOString(),
  }
}

export function londonHour(now: Date): number {
  return Number(formatInTimeZone(now, ZONE, 'H'))
}
