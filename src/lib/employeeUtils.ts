import { differenceInYears, differenceInMonths, differenceInDays } from 'date-fns';
import { formatDateInLondon, getTodayIsoDate, isValidIsoDate, toLocalIsoDate } from '@/lib/dateUtils';

/**
 * The London calendar date an employee date field stands for, as YYYY-MM-DD, or null when it
 * is not a date. Date columns arrive as YYYY-MM-DD already; anything else is read as an instant.
 */
function toLondonCalendarDate(value: string | Date): string | null {
  if (typeof value === 'string' && isValidIsoDate(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : toLocalIsoDate(date);
}

/**
 * A YYYY-MM-DD calendar date as midnight on the host clock. date-fns reads dates in the host
 * zone, so it then sees exactly that day on any machine. Only for date-fns arithmetic between
 * two such dates, never for comparing with the current instant.
 */
function hostMidnight(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Calculate length of service from a start date
 * @param startDate - The employee's start date
 * @returns A human-readable string describing the length of service
 */
export function calculateLengthOfService(startDate: string | Date | null): string {
  if (!startDate) return 'Not started';

  // Both ends are London calendar dates. Comparing the start date (midnight UTC, which is
  // 01:00 BST) with the current instant said "Starts ..." on the start day, and a day short
  // every night, from 00:00 to 00:59 BST.
  const startIso = toLondonCalendarDate(startDate);
  if (!startIso) return 'Not started';
  const todayIso = getTodayIsoDate();

  // Check if start date is in the future
  if (startIso > todayIso) {
    return `Starts ${formatDateInLondon(startIso, { month: 'short', day: 'numeric', year: 'numeric' }, 'en-US')}`;
  }

  const start = hostMidnight(startIso);
  const now = hostMidnight(todayIso);
  const years = differenceInYears(now, start);
  const months = differenceInMonths(now, start) % 12;
  const days = differenceInDays(now, start);
  
  // Less than a month
  if (days < 30) {
    if (days === 0) return 'Started today';
    if (days === 1) return '1 day';
    return `${days} days`;
  }
  
  // Less than a year
  if (years === 0) {
    if (months === 1) return '1 month';
    return `${months} months`;
  }
  
  // One or more years
  const yearPart = years === 1 ? '1 year' : `${years} years`;
  if (months === 0) return yearPart;
  
  const monthPart = months === 1 ? '1 month' : `${months} months`;
  return `${yearPart}, ${monthPart}`;
}

/**
 * Check if an employee's birthday is coming up within a specified number of days
 * @param dateOfBirth - The employee's date of birth
 * @param daysAhead - Number of days to look ahead (default 7)
 * @returns Object with upcoming birthday info. Days are counted from today's London date, and
 * nextBirthday is midnight on the host clock of that birthday. A 29 February birthday falls on
 * 1 March in other years.
 */
export function getUpcomingBirthday(dateOfBirth: string | Date | null, daysAhead = 7): {
  isUpcoming: boolean;
  daysUntil: number;
  nextBirthday: Date | null;
} {
  const dobIso = dateOfBirth ? toLondonCalendarDate(dateOfBirth) : null;
  if (!dobIso) {
    return { isUpcoming: false, daysUntil: -1, nextBirthday: null };
  }

  // "Today" is the London date. Host midnight was UTC midnight on the server, which is still
  // yesterday from 00:00 to 00:59 BST.
  const today = hostMidnight(getTodayIsoDate());
  const currentYear = today.getFullYear();
  const [, birthMonth, birthDay] = dobIso.split('-').map(Number);

  // Get this year's birthday (29 February rolls over to 1 March in other years)
  let nextBirthday = new Date(currentYear, birthMonth - 1, birthDay);
  
  // If birthday has passed this year, look at next year
  if (nextBirthday < today) {
    nextBirthday = new Date(currentYear + 1, birthMonth - 1, birthDay);
  }
  
  const daysUntil = differenceInDays(nextBirthday, today);
  
  return {
    isUpcoming: daysUntil <= daysAhead && daysUntil >= 0,
    daysUntil,
    nextBirthday
  };
}

/**
 * Format an employee's age from their date of birth, as of today's London date
 * @param dateOfBirth - The employee's date of birth
 * @returns Age in years or null if no DOB
 */
export function calculateAge(dateOfBirth: string | Date | null): number | null {
  const dobIso = dateOfBirth ? toLondonCalendarDate(dateOfBirth) : null;
  if (!dobIso) return null;

  const [birthYear, birthMonth, birthDay] = dobIso.split('-').map(Number);
  const [year, month, day] = getTodayIsoDate().split('-').map(Number);

  let age = year - birthYear;
  const monthDiff = month - birthMonth;
  
  // Adjust age if birthday hasn't occurred yet this year
  if (monthDiff < 0 || (monthDiff === 0 && day < birthDay)) {
    age--;
  }
  
  return age;
}