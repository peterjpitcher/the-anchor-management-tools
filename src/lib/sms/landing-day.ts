import { shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'

/**
 * Wording a text by the day the customer reads it, not the moment we send it.
 *
 * sendSMS holds anything sent from 21:00 to 09:00 London until 09:00 (quiet hours). A text that
 * says "tomorrow" and goes out after 21:00 therefore arrives the next morning, on the day it
 * called tomorrow. Anything that names a day relative to a deadline or a start time should be
 * worded with resolveTextLandingDay.
 *
 * The one-day event reminder on branch fix/event-reminder-landing-day (resolveEventReminderDay)
 * works this out the same way; once both are merged it should call this.
 */

/** The day a text names for a moment, as seen on the London day the customer reads it. */
export type TextLandingDay = 'today' | 'tomorrow'

/** When a text sent now reaches the customer: now, or 09:00 London when quiet hours hold it. */
export function resolveTextLandingTime(now: Date = new Date()): Date {
  const quietHours = evaluateSmsQuietHours(now)
  return quietHours.inQuietHours ? quietHours.nextAllowedSendAt : now
}

/**
 * Whether `moment` falls on the London day a text sent now is read ('today') or on the day
 * after ('tomorrow'). Null when the text would only arrive at or after `moment`, or when
 * `moment` is two or more London days away, which neither word covers.
 */
export function resolveTextLandingDay(moment: Date, now: Date = new Date()): TextLandingDay | null {
  if (Number.isNaN(moment.getTime())) return null

  const landsAt = resolveTextLandingTime(now)
  if (moment.getTime() <= landsAt.getTime()) return null

  const landingDate = toLocalIsoDate(landsAt)
  const momentDate = toLocalIsoDate(moment)
  if (momentDate === landingDate) return 'today'
  if (momentDate === shiftIsoDate(landingDate, 1)) return 'tomorrow'
  return null
}
