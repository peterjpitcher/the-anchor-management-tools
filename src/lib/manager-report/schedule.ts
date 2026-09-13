import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { subDays } from 'date-fns'

const ZONE = 'Europe/London'

export interface ManagerReportPeriod { key: string; periodStart: string; periodEnd: string }

/** Hourly Friday retries are allowed after the 09:00 local delivery time. */
export function managerReportPeriod(now: Date): ManagerReportPeriod | null {
  if (formatInTimeZone(now, ZONE, 'i') !== '5' || Number(formatInTimeZone(now, ZONE, 'H')) < 9) return null
  const key = formatInTimeZone(now, ZONE, 'yyyy-MM-dd')
  const end = fromZonedTime(`${key}T09:00:00`, ZONE)
  const previousDate = formatInTimeZone(subDays(end, 7), ZONE, 'yyyy-MM-dd')
  return { key, periodStart: fromZonedTime(`${previousDate}T09:00:00`, ZONE).toISOString(), periodEnd: end.toISOString() }
}
