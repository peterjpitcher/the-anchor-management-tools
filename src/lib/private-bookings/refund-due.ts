import { getIsoWeekday, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'

/**
 * The refund a cancelled private hire owes (BK-065, customer bookings review of 24 October 2026).
 *
 * The cancellation message promises "we'll refund £X within 10 working days". cancelBooking records
 * that amount and this date on the booking, and it is listed as owed until the completed refunds
 * recorded against the booking reach it. Kept free of server imports so the booking page reads the
 * same rule.
 */

/** Working days in the promise the cancellation message makes. */
export const REFUND_WORKING_DAYS = 10

/**
 * The London date `workingDays` working days (Monday to Friday) after `from`. Bank holidays are
 * not skipped: the date is the latest the refund should go, so a holiday makes it one day early,
 * never late.
 */
export function refundDueByIso(from: Date, workingDays = REFUND_WORKING_DAYS): string {
  let date = toLocalIsoDate(from)
  let counted = 0
  while (counted < workingDays) {
    const next = shiftIsoDate(date, 1)
    if (!next) break
    date = next
    const weekday = getIsoWeekday(date)
    if (weekday !== null && weekday <= 5) counted += 1
  }
  return date
}

export type RefundOwedFields = {
  refund_due_amount?: number | string | null
  refund_due_by?: string | null
  deposit_refund_status?: string | null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * What is still owed: the promised amount less the completed refunds recorded against the booking,
 * or 0. `refunded` is the total of those completed refunds.
 */
export function refundStillOwed(booking: RefundOwedFields, refunded: number): number {
  const due = Number(booking.refund_due_amount ?? 0)
  if (!Number.isFinite(due) || due <= 0) return 0
  return Math.max(0, roundMoney(due - (Number.isFinite(refunded) ? refunded : 0)))
}
