import { eachIsoDateInRange, getIsoWeekday } from '@/lib/dateUtils';

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
] as const;

export function normalizeNonWorkingWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map(day => typeof day === 'number' ? day : Number(day))
        .filter(day => Number.isInteger(day) && day >= 1 && day <= 5),
    ),
  ).sort((a, b) => a - b);
}

export function isCountedLeaveDate(
  isoDate: string,
  nonWorkingWeekdays: readonly number[] = [],
): boolean {
  const isoDay = getIsoWeekday(isoDate);
  if (isoDay === null) return false;

  if (isoDay > 5) return false;
  return !nonWorkingWeekdays.includes(isoDay);
}

export function getCountedLeaveDates(
  startDate: string,
  endDate: string,
  nonWorkingWeekdays: readonly number[] = [],
): string[] {
  return eachIsoDateInRange(startDate, endDate)
    .filter(date => isCountedLeaveDate(date, nonWorkingWeekdays));
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

export function countLeaveAllowanceDays(
  startDate: string,
  endDate: string,
  nonWorkingWeekdays: readonly number[] = [],
): number {
  return getCountedLeaveDates(startDate, endDate, nonWorkingWeekdays).length;
}
