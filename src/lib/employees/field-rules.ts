/**
 * The rules for the employee details that both the staff forms and the new starter onboarding
 * form collect. They used to live in two places with two different shapes, so a record that one
 * path accepted (an NI number with spaces in it, say) was then refused by the other, and a
 * manager could not correct it. Both paths now normalise and check with these functions.
 *
 * Pure functions only: no Supabase, no Zod, safe to import from client components.
 */
import { getTodayIsoDate, isValidIsoDate } from '@/lib/dateUtils';

export const NI_NUMBER_PATTERN = /^[A-Z]{2}\d{6}[A-Z]$/;
export const SORT_CODE_PATTERN = /^\d{2}-\d{2}-\d{2}$/;
export const ACCOUNT_NUMBER_PATTERN = /^\d{8}$/;

export const NI_NUMBER_MESSAGE = 'NI number must be in format: AA123456A';
export const SORT_CODE_MESSAGE = 'Sort code must be 6 digits';
export const ACCOUNT_NUMBER_MESSAGE = 'Account number must be exactly 8 digits';

/** "ab 12 34 56 c" becomes "AB123456C". */
export function normaliseNiNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** "123456", "12 34 56" and "12-34-56" all become "12-34-56". Anything else is returned trimmed. */
export function normaliseSortCode(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 6
    ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
    : value.trim();
}

/** "1234 5678" becomes "12345678". */
export function normaliseAccountNumber(value: string): string {
  return value.replace(/\s+/g, '');
}

/** Youngest and oldest ages we accept for a date of birth. Under 16 cannot be employed here. */
const MINIMUM_EMPLOYEE_AGE = 16;
const MAXIMUM_EMPLOYEE_AGE = 100;

/** Whole years between a date of birth and a date, both YYYY-MM-DD. */
export function ageOnDate(dateOfBirthIso: string, onIso: string): number {
  const [birthYear, birthMonth, birthDay] = dateOfBirthIso.split('-').map(Number);
  const [year, month, day] = onIso.split('-').map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

/**
 * Checks a date of birth typed into a form. Returns a message to show, or null when it is fine.
 * `todayIso` defaults to today in London.
 */
export function dateOfBirthError(value: string | null | undefined, todayIso: string = getTodayIsoDate()): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Date of birth is required';
  if (!isValidIsoDate(trimmed)) return 'Enter a real date of birth';
  if (trimmed >= todayIso) return 'Date of birth must be in the past';
  const age = ageOnDate(trimmed, todayIso);
  if (age < MINIMUM_EMPLOYEE_AGE) return `You must be at least ${MINIMUM_EMPLOYEE_AGE} to work here. Check the date of birth`;
  if (age > MAXIMUM_EMPLOYEE_AGE) return 'Check the date of birth: that would make you over 100';
  return null;
}

/** True when the person is under 18 on the given date (licensing and working time rules apply). */
export function isUnder18(dateOfBirthIso: string | null | undefined, onIso: string = getTodayIsoDate()): boolean {
  if (!dateOfBirthIso || !isValidIsoDate(dateOfBirthIso)) return false;
  return ageOnDate(dateOfBirthIso, onIso) < 18;
}
