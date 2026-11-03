import { formatDate, getTodayIsoDate } from '@/lib/dateUtils'
import { SELECTABLE_EMPLOYEE_STATUSES } from './display-name'

/**
 * Who still works here.
 *
 * A leaver goes Active, then Started Separation (shown as On Notice, with
 * `employment_end_date` as their last working day), then Former. The nightly
 * employee-separations job marks them Former the morning after their last working day, but
 * that can be up to a day later, and longer when a separation is entered late with a last
 * day already past. Checking the status alone treated a leaver as current staff for that
 * whole gap: on 17 May 2026 someone past their last working day was emailed the next week's
 * rota.
 *
 * The rule: on notice and past the last working day counts as gone, exactly as Former does.
 * The last working day itself still counts. "Past" is judged on the London calendar date,
 * never the server's UTC date. Someone on notice with no last working day recorded stays
 * current, because there is no date for them to be past.
 *
 * Every path that messages staff or lets them in goes through these helpers, so no two
 * paths can disagree about who has left. A query feeding them must select `status` and
 * `employment_end_date`.
 */
export interface EmploymentStatusParts {
  status?: string | null
  employment_end_date?: string | null
}

function lastWorkingDay(employee: EmploymentStatusParts): string | null {
  if (employee.status !== 'Started Separation') return null
  const end = (employee.employment_end_date ?? '').slice(0, 10)
  return end || null
}

/**
 * True once someone on notice is past their last working day.
 *
 * `asOf` is the date being judged: today's London date by default, or the date of a shift
 * being given to them, so the one rule also answers "can they work on that day?".
 */
export function isPastLastWorkingDay(employee: EmploymentStatusParts, asOf: string = getTodayIsoDate()): boolean {
  const end = lastWorkingDay(employee)
  return end !== null && end < asOf
}

/** Still working here: Active, or on notice up to and including their last working day. */
export function isCurrentStaff(employee: EmploymentStatusParts, asOf: string = getTodayIsoDate()): boolean {
  const status = employee.status ?? ''
  if (!(SELECTABLE_EMPLOYEE_STATUSES as readonly string[]).includes(status)) return false
  return !isPastLastWorkingDay(employee, asOf)
}

/** Has left: Former, or on notice and past their last working day. */
export function hasLeft(employee: EmploymentStatusParts, asOf: string = getTodayIsoDate()): boolean {
  return employee.status === 'Former' || isPastLastWorkingDay(employee, asOf)
}

/**
 * Who a clock-in screen lists: current staff, plus anyone still clocked in, so someone on notice
 * whose shift on their last working day runs past midnight can still clock out.
 */
export function onClockScreen<T extends EmploymentStatusParts & { employee_id: string }>(
  employees: T[],
  clockedInIds: ReadonlySet<string>,
): T[] {
  const today = getTodayIsoDate()
  return employees.filter((employee) => isCurrentStaff(employee, today) || clockedInIds.has(employee.employee_id))
}

/**
 * What the staff portal tells someone on notice once their last working day has passed.
 * Without it they would be told their account is not linked to an employee profile, which
 * is not true and sends them to their manager for the wrong reason.
 */
export function portalClosedMessage(employee: EmploymentStatusParts): string | null {
  if (!isPastLastWorkingDay(employee)) return null
  const end = lastWorkingDay(employee)
  return `Your last working day was ${formatDate(end as string)}, so the staff portal is now closed to you. Please contact your manager if that date is wrong.`
}
