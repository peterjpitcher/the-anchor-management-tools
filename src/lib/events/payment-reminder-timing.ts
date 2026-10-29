import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'

export type ReminderStage = 'payment_due_12h' | 'payment_due_2h'

const HOUR_MS = 60 * 60 * 1000
/** A text that could only arrive this close to the end of the hold is not sent (BK-213). */
const TEXT_MARGIN_MS = 30 * 60 * 1000

/**
 * Which reminder is due. The cron runs every 15 minutes around the clock.
 *
 * BK-213: when the 2-hour reminder would fall in quiet hours (21:00 to 09:00 London) and a text
 * sent then could not go out until the hold has nearly run out, the 2-hour reminder is sent in the
 * last half hour before 21:00 instead, so it is never dropped and never arrives after the seats
 * have gone.
 */
export function resolveReminderStage(holdExpiresAt: string | null, now: Date = new Date()): ReminderStage | null {
  if (!holdExpiresAt) return null
  const expiresMs = Date.parse(holdExpiresAt)
  if (!Number.isFinite(expiresMs)) return null

  const remainingMs = expiresMs - now.getTime()
  if (remainingMs <= 0) return null
  if (remainingMs <= 2 * HOUR_MS) return 'payment_due_2h'
  if (remainingMs > 12 * HOUR_MS) return null

  const twoHourMark = new Date(expiresMs - 2 * HOUR_MS)
  const twoHourTextAt = evaluateSmsQuietHours(twoHourMark).nextAllowedSendAt.getTime()
  const twoHourTextTooLate = twoHourTextAt >= expiresMs - TEXT_MARGIN_MS
  const quietHoursStartSoon =
    !evaluateSmsQuietHours(now).inQuietHours &&
    evaluateSmsQuietHours(new Date(now.getTime() + TEXT_MARGIN_MS)).inQuietHours
  if (twoHourTextTooLate && quietHoursStartSoon) return 'payment_due_2h'
  return 'payment_due_12h'
}

/**
 * True when a text sent now would be held by quiet hours until the hold has all but run out, so
 * it would arrive as a dead payment link beside a "seats released" message (BK-213).
 */
export function textWouldArriveTooLate(holdExpiresAt: string, now: Date = new Date()): boolean {
  const expiresMs = Date.parse(holdExpiresAt)
  if (!Number.isFinite(expiresMs)) return true
  return evaluateSmsQuietHours(now).nextAllowedSendAt.getTime() >= expiresMs - TEXT_MARGIN_MS
}
