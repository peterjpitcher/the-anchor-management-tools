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

/** What one person is entitled to in one holiday year. */
export type HolidayEntitlement = {
  /** Days they are entitled to this year, to one decimal place. */
  entitlement: number;
  /** The yearly allowance it was worked out from. */
  fullAllowance: number;
  /** True when they are employed for only part of the year, so entitlement is below the allowance. */
  proRated: boolean;
  /** The first and last days of the year they are employed for; null when they are employed for none of it. */
  employedFrom: string | null;
  employedTo: string | null;
};

/** One decimal place, so 11.37 reads 11.4 and a whole allowance stays whole. */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The holiday a person is entitled to in one holiday year: the yearly allowance scaled by the share
 * of that year's days they are employed for. Someone who starts or leaves part way through the year
 * is entitled to that share, not the whole allowance, and that share is what a leaver's untaken
 * holiday is worked out from (Working Time Regulations 1998, regulations 13 and 14).
 *
 * Calendar days, to match how leave is counted (every day, weekends included). Rounded to one
 * decimal place and never to a whole or half day: rounding is a pay decision this app does not make.
 */
export function getHolidayEntitlement(input: {
  allowance: number;
  holidayYear: number;
  startMonth: number;
  startDay: number;
  employmentStartDate?: string | null;
  employmentEndDate?: string | null;
}): HolidayEntitlement {
  const fullAllowance = Math.max(0, input.allowance);
  const { startDate: yearStart, endDate: yearEnd } = getHolidayYearBounds(
    input.holidayYear,
    input.startMonth,
    input.startDay,
  );

  const employedFrom = input.employmentStartDate && input.employmentStartDate > yearStart
    ? input.employmentStartDate
    : yearStart;
  const employedTo = input.employmentEndDate && input.employmentEndDate < yearEnd
    ? input.employmentEndDate
    : yearEnd;

  if (employedFrom > employedTo) {
    return { entitlement: 0, fullAllowance, proRated: fullAllowance > 0, employedFrom: null, employedTo: null };
  }

  const daysInYear = countRequestDays(yearStart, yearEnd);
  const daysEmployed = countRequestDays(employedFrom, employedTo);
  const proRated = daysEmployed < daysInYear;

  return {
    entitlement: proRated ? roundToTenth((fullAllowance * daysEmployed) / daysInYear) : fullAllowance,
    fullAllowance,
    proRated,
    employedFrom,
    employedTo,
  };
}

/**
 * Holiday a leaver has earned but not taken by their last working day: their entitlement for the
 * holiday year up to that day, less the allowance days they took in it. Negative when they took more
 * than they had earned. One decimal place, as the entitlement.
 */
export function getUntakenHoliday(entitlement: number, takenDays: number): number {
  return roundToTenth(entitlement - takenDays);
}

/** "1 day", "0.5 days", "14.4 days". */
export function formatHolidayDays(days: number): string {
  const value = roundToTenth(days);
  return `${value} ${value === 1 ? 'day' : 'days'}`;
}
