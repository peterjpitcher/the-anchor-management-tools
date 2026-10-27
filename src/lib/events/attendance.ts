/**
 * Who came to an event (BK-130, customer bookings review of 24 October 2026; owner decision D13).
 *
 * Staff tick who came from a list on the event page, on the night or the morning after. 'Came'
 * is a check-in (event_check_ins, method 'staff_list' when ticked from the list); 'Did not come'
 * is the booking status 'no_show'. Nothing is marked automatically: a booking nobody ticks reads
 * as 'not recorded', never as a no-show, because an automatic no-show would wrongly mark people who
 * came.
 *
 * A check-in made at the door (the kiosk) is proof the guest came, so the list never removes one.
 */

export type EventAttendance = 'came' | 'did_not_come' | 'not_recorded'

/** The check-in method written when staff tick 'Came' from the list (migration 20261027133352). */
export const STAFF_LIST_CHECK_IN_METHOD = 'staff_list'

/**
 * Statuses a booking can hold when staff record who came: a live booking, before or after the
 * review text, and a booking already marked as a no-show. Unpaid holds, cancellations, expiries
 * and reminder-only sign-ups are not attendance.
 */
const ATTENDANCE_STATUSES = new Set(['confirmed', 'visited_waiting_for_review', 'review_clicked', 'completed', 'no_show'])

export type AttendanceBooking = {
  status?: string | null
  is_reminder_only?: boolean | null
  seats?: number | null
  review_sms_sent_at?: string | null
  review_clicked_at?: string | null
  completed_at?: string | null
}

export type AttendanceCheckIn = {
  id: string
  check_in_method: string | null
} | null | undefined

export function canRecordAttendance(booking: AttendanceBooking): boolean {
  if (booking.is_reminder_only === true) return false
  return ATTENDANCE_STATUSES.has(String(booking.status ?? '').toLowerCase())
}

export function resolveEventAttendance(booking: AttendanceBooking, checkIn: AttendanceCheckIn): EventAttendance {
  if (checkIn) return 'came'
  if (String(booking.status ?? '').toLowerCase() === 'no_show') return 'did_not_come'
  return 'not_recorded'
}

/** A check-in ticked from the staff list can be undone; one made at the door cannot. */
export function isStaffListCheckIn(checkIn: AttendanceCheckIn): boolean {
  return Boolean(checkIn) && checkIn?.check_in_method === STAFF_LIST_CHECK_IN_METHOD
}

/**
 * The status a no-show booking goes back to when staff undo the mark, read from the review
 * history the booking already carries, so the review job carries on from where it was. The
 * review-window job moves visited and clicked bookings on to 'completed' when their window closes.
 */
export function statusAfterNoShowUndo(booking: AttendanceBooking): string {
  if (booking.completed_at) return 'completed'
  if (booking.review_clicked_at) return 'review_clicked'
  if (booking.review_sms_sent_at) return 'visited_waiting_for_review'
  return 'confirmed'
}

export type AttendanceChangePlan =
  | { ok: false; error: string }
  | {
      ok: true
      /** False when the booking already reads as asked: nothing to write. */
      changed: boolean
      /** The booking's new status, or null to leave it alone. */
      setStatus: string | null
      insertCheckIn: boolean
      /** A staff-list check-in to remove, or null. */
      deleteCheckInId: string | null
    }

/**
 * What to write to move a booking to the outcome staff picked. Pure, so the rules are tested
 * without a database: the action applies the plan with the service-role client.
 */
export function planEventAttendanceChange(input: {
  booking: AttendanceBooking
  checkIn: AttendanceCheckIn
  outcome: EventAttendance
  eventStarted: boolean
}): AttendanceChangePlan {
  const { booking, checkIn, outcome } = input
  if (!canRecordAttendance(booking)) {
    return { ok: false, error: 'Only a live booking can be marked as came or did not come.' }
  }
  if (!input.eventStarted) {
    return { ok: false, error: 'You can record who came once the event has started.' }
  }

  const current = resolveEventAttendance(booking, checkIn)
  if (current === outcome) {
    return { ok: true, changed: false, setStatus: null, insertCheckIn: false, deleteCheckInId: null }
  }

  const isNoShow = String(booking.status ?? '').toLowerCase() === 'no_show'

  if (outcome === 'came') {
    return {
      ok: true,
      changed: true,
      setStatus: isNoShow ? statusAfterNoShowUndo(booking) : null,
      insertCheckIn: !checkIn,
      deleteCheckInId: null,
    }
  }

  if (checkIn && !isStaffListCheckIn(checkIn)) {
    return { ok: false, error: 'This guest was checked in at the door, so they came.' }
  }

  if (outcome === 'did_not_come') {
    return {
      ok: true,
      changed: true,
      setStatus: 'no_show',
      insertCheckIn: false,
      deleteCheckInId: checkIn ? checkIn.id : null,
    }
  }

  return {
    ok: true,
    changed: true,
    setStatus: isNoShow ? statusAfterNoShowUndo(booking) : null,
    insertCheckIn: false,
    deleteCheckInId: checkIn ? checkIn.id : null,
  }
}

export type AttendanceCount = { bookings: number; seats: number }

export type EventAttendanceSummary = Record<EventAttendance, AttendanceCount>

/** Counts bookings and seats by attendance, over the bookings attendance applies to. */
export function summariseEventAttendance(
  rows: Array<{ booking: AttendanceBooking; checkIn: AttendanceCheckIn }>
): EventAttendanceSummary {
  const summary: EventAttendanceSummary = {
    came: { bookings: 0, seats: 0 },
    did_not_come: { bookings: 0, seats: 0 },
    not_recorded: { bookings: 0, seats: 0 },
  }
  for (const row of rows) {
    if (!canRecordAttendance(row.booking)) continue
    const bucket = summary[resolveEventAttendance(row.booking, row.checkIn)]
    const seats = Number(row.booking.seats ?? 0)
    bucket.bookings += 1
    bucket.seats += Number.isFinite(seats) && seats > 0 ? seats : 0
  }
  return summary
}

/** Door money a pay-on-arrival night should have taken at its ticket price, in pounds. */
export function expectedDoorMoney(seats: number, ticketPrice: number): number {
  if (!Number.isFinite(seats) || !Number.isFinite(ticketPrice) || seats <= 0 || ticketPrice <= 0) return 0
  return Math.round(seats * ticketPrice * 100) / 100
}
