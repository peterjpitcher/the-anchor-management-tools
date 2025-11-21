import { differenceInYears, differenceInMonths, differenceInDays, format } from 'date-fns';

/**
 * Calculate length of service from a start date
 * @param startDate - The employee's start date
 * @returns A human-readable string describing the length of service
 */
export function calculateLengthOfService(startDate: string | Date | null): string {
  if (!startDate) return 'Not started';
  
  const start = new Date(startDate);
  const now = new Date();
  
  // Check if start date is in the future
  if (start > now) {
    return `Starts ${format(start, 'MMM d, yyyy')}`;
  }
  
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
 * @returns Object with upcoming birthday info
 */
export function getUpcomingBirthday(dateOfBirth: string | Date | null, daysAhead = 7): {
  isUpcoming: boolean;
  daysUntil: number;
  nextBirthday: Date | null;
} {
  if (!dateOfBirth) {
    return { isUpcoming: false, daysUntil: -1, nextBirthday: null };
  }
  
  const dob = new Date(dateOfBirth);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  
  // Get this year's birthday
  let nextBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
  
  // If birthday has passed this year, look at next year
  if (nextBirthday < today) {
    nextBirthday = new Date(currentYear + 1, dob.getMonth(), dob.getDate());
  }
  
  const daysUntil = differenceInDays(nextBirthday, today);
  
  return {
    isUpcoming: daysUntil <= daysAhead && daysUntil >= 0,
    daysUntil,
    nextBirthday
  };
}

/**
 * Format an employee's age from their date of birth
 * @param dateOfBirth - The employee's date of birth
 * @returns Age in years or null if no DOB
 */
export function calculateAge(dateOfBirth: string | Date | null): number | null {
  if (!dateOfBirth) return null;
  
  const dob = new Date(dateOfBirth);
  const today = new Date();
  
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  
  // Adjust age if birthday hasn't occurred yet this year
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  
  return age;
}