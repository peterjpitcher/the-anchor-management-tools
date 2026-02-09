import { fromZonedTime, toZonedTime } from 'date-fns-tz'

export const SMS_TIMEZONE = 'Europe/London'
export const SMS_QUIET_HOUR_START = 21
export const SMS_QUIET_HOUR_END = 9

export type SmsQuietHoursEvaluation = {
  inQuietHours: boolean
  nextAllowedSendAt: Date
  timezone: string
}

function isInQuietHoursLondon(localDate: Date): boolean {
  const hour = localDate.getHours()
  return hour >= SMS_QUIET_HOUR_START || hour < SMS_QUIET_HOUR_END
}

export function evaluateSmsQuietHours(now: Date = new Date()): SmsQuietHoursEvaluation {
  const londonNow = toZonedTime(now, SMS_TIMEZONE)
  const inQuietHours = isInQuietHoursLondon(londonNow)

  if (!inQuietHours) {
    return {
      inQuietHours,
      nextAllowedSendAt: now,
      timezone: SMS_TIMEZONE
    }
  }

  const nextAllowedLondon = new Date(londonNow.getTime())
  if (londonNow.getHours() >= SMS_QUIET_HOUR_START) {
    nextAllowedLondon.setDate(nextAllowedLondon.getDate() + 1)
  }
  nextAllowedLondon.setHours(SMS_QUIET_HOUR_END, 0, 0, 0)

  return {
    inQuietHours,
    nextAllowedSendAt: fromZonedTime(nextAllowedLondon, SMS_TIMEZONE),
    timezone: SMS_TIMEZONE
  }
}

