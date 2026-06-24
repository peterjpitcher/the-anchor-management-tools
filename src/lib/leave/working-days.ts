import { eachDayOfInterval, getISODay, isValid, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

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
  const date = parseISO(isoDate);
  if (!isValid(date)) return false;

  const isoDay = getISODay(date);
  if (isoDay > 5) return false;
  return !nonWorkingWeekdays.includes(isoDay);
}

export function getCountedLeaveDates(
  startDate: string,
  endDate: string,
  nonWorkingWeekdays: readonly number[] = [],
): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end) || end < start) return [];

  return eachDayOfInterval({ start, end })
    .map(date => formatInTimeZone(date, 'Europe/London', 'yyyy-MM-dd'))
    .filter(date => isCountedLeaveDate(date, nonWorkingWeekdays));
}

export function countLeaveAllowanceDays(
  startDate: string,
  endDate: string,
  nonWorkingWeekdays: readonly number[] = [],
): number {
  return getCountedLeaveDates(startDate, endDate, nonWorkingWeekdays).length;
}
