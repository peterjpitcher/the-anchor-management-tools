import { eachIsoDateInRange } from '@/lib/dateUtils';

/**
 * Holiday counting.
 *
 * There is exactly one place in this app that turns leave into a number, and every screen
 * calls it. Before this existed the employees roster counted every leave day in the calendar
 * year while the Holidays tab counted Monday to Friday days across the request's header dates
 * filtered by its stored holiday_year, so the same person read 27 on one screen and 4 on the
 * other.
 *
 * Two rules changed with it:
 *
 * 1. Every calendar day counts, including Saturday and Sunday. The Anchor is a pub, so the
 *    weekend is the busiest part of the week. Excluding it meant a weekend off cost nothing.
 * 2. Leave that should not consume allowance is excluded by its TYPE, never by which day of
 *    the week it falls on. That is what leave_types.consumes_allowance is for.
 *
 * Counting is done over dated leave_days rows rather than a request's start and end dates, so
 * a request running from 28 December to 3 January is charged to the year each day actually
 * falls in rather than wholly to the year it started in.
 */

/** A dated leave row, as stored in leave_days, carrying its request's type. */
export type CountableLeaveDay = {
  leave_date: string;
  /** leave_types.code. Absent is treated as allowance consuming, matching the column default. */
  consumes_allowance?: boolean | null;
};

/** True when this row comes off the holiday allowance. */
export function isCountedLeaveDay(day: CountableLeaveDay): boolean {
  return day.consumes_allowance !== false;
}

/**
 * The number of days to charge against the holiday allowance.
 * Counts dated rows, so it is correct across a holiday year boundary.
 */
export function countAllowanceDays(days: readonly CountableLeaveDay[]): number {
  return days.filter(isCountedLeaveDay).length;
}

/**
 * Every date in an inclusive range. Used when expanding a request into leave_days and when a
 * caller only has the header dates to work from.
 */
export function getLeaveDates(startDate: string, endDate: string): string[] {
  return eachIsoDateInRange(startDate, endDate);
}

/**
 * Length of a request in days, inclusive of both ends. This is the size of the booking, which
 * is not the same thing as what it costs: a request whose type does not consume allowance has
 * a length but no cost.
 */
export function countRequestDays(startDate: string, endDate: string): number {
  return eachIsoDateInRange(startDate, endDate).length;
}

/**
 * The holiday year a YYYY-MM-DD date falls in, named by the calendar year it starts in.
 * Compares ISO date strings, which sort in date order, so the answer never depends on the
 * timezone of the machine asking. Building the boundary with `new Date(year, month, day)`
 * instead would anchor it in the viewer's timezone and flip the holiday year early for
 * anyone outside the UK.
 */
export function getHolidayYear(
  isoDate: string,
  startMonth: number,
  startDay: number,
): number {
  const year = Number(isoDate.slice(0, 4));
  const yearStart = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  return isoDate >= yearStart ? year : year - 1;
}

/**
 * The inclusive date bounds of a holiday year, as ISO strings. Callers use this to select the
 * dated leave_days rows belonging to a year, instead of filtering on the request header's
 * holiday_year column.
 */
export function getHolidayYearBounds(
  holidayYear: number,
  startMonth: number,
  startDay: number,
): { startDate: string; endDate: string } {
  const mm = String(startMonth).padStart(2, '0');
  const dd = String(startDay).padStart(2, '0');
  const startDate = `${holidayYear}-${mm}-${dd}`;

  const nextStart = new Date(`${holidayYear + 1}-${mm}-${dd}T00:00:00Z`);
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  const endDate = nextStart.toISOString().slice(0, 10);

  return { startDate, endDate };
}
