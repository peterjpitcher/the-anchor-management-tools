/**
 * The rules the onboarding wizard, its review screen and the final submit all apply, so the three
 * never disagree about whether a section is done. Before this, the review screen counted a
 * financial section as done when the row merely existed (blank bank details included), while the
 * starter had been told nothing was missing.
 *
 * Also the masking of the NI number and bank account number, which the server applies when it
 * replays saved details and the wizard keeps after a save, so going Back shows the same masked
 * value the starter saw when the page loaded.
 *
 * Pure functions only: no Supabase, no Zod, safe to import from client components.
 */
import { dateOfBirthError } from './field-rules';

export type OnboardingSectionKey =
  | 'personal'
  | 'emergency_contacts'
  | 'financial'
  | 'health'
  | 'time_off'
  | 'right_to_work_notice';

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

export const MASK_CHARACTER = '•';

/** Exactly what maskTail produces: mask characters, then the visible tail. */
export const MASKED_VALUE_PATTERN = /^•+[A-Za-z0-9]*$/;

export const NI_NUMBER_VISIBLE_TAIL = 3;
export const ACCOUNT_NUMBER_VISIBLE_TAIL = 4;

export function maskTail(value: string | null | undefined, visibleTail: number): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if (raw.length <= visibleTail) return MASK_CHARACTER.repeat(raw.length);
  return `${MASK_CHARACTER.repeat(raw.length - visibleTail)}${raw.slice(-visibleTail)}`;
}

/** True when a value is a mask the server sent, left exactly as shown. */
export function isMaskedValue(value: string | null | undefined): boolean {
  return MASKED_VALUE_PATTERN.test((value ?? '').trim());
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

/** First name, last name and a date of birth we accept. */
export function isPersonalComplete(personal: {
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
} | null | undefined): boolean {
  if (!personal) return false;
  return hasText(personal.first_name)
    && hasText(personal.last_name)
    && dateOfBirthError(personal.date_of_birth) === null;
}

/** A main contact with a name and at least one number to ring. */
export function isEmergencyContactsComplete(primary: {
  name?: string | null;
  phone_number?: string | null;
  mobile_number?: string | null;
} | null | undefined): boolean {
  if (!primary) return false;
  return hasText(primary.name) && (hasText(primary.phone_number) || hasText(primary.mobile_number));
}

/**
 * A sort code and an account number, which payroll cannot pay without. A masked account number
 * counts: it stands for one already stored. The NI number is optional (the starter can give it to
 * their manager later), so it is not part of this.
 */
export function isFinancialComplete(financial: {
  bank_sort_code?: string | null;
  bank_account_number?: string | null;
} | null | undefined): boolean {
  if (!financial) return false;
  return hasText(financial.bank_sort_code) && hasText(financial.bank_account_number);
}

/** What to tell the starter when a section stops them submitting. */
export const ONBOARDING_INCOMPLETE_MESSAGES: Record<OnboardingSectionKey, string> = {
  personal: 'Add your first name, last name and date of birth in Personal Details.',
  emergency_contacts: 'Add a name and a phone number for your main emergency contact.',
  financial: 'Add your bank sort code and account number in Financial Details, so we can pay you.',
  health: 'Save the Health Information step. You can leave every question unanswered.',
  time_off: 'Tell us about any time off you have already booked.',
  right_to_work_notice: 'Confirm you have read what to bring for your right to work check.',
};
