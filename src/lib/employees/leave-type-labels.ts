/**
 * What a leave request is, in the words staff read on the employee's Holidays tab.
 *
 * A new starter's onboarding asks "What is it?" for each block of time off they already have
 * booked, with Holiday or "Cannot work (not holiday)" (TimeOffStep). The tab listed every
 * request the same way, so a manager read days the starter cannot work as holiday. The labels
 * here are the onboarding wording, so staff read what the starter chose.
 *
 * Keys are leave_types.code. A request with no type is a holiday (the column default).
 */
export const LEAVE_TYPE_LABELS: Readonly<Record<string, string>> = {
  holiday: 'Holiday',
  unavailable: 'Cannot work (not holiday)',
};

/** The label for a leave type. A type added later is shown by its code, never as holiday. */
export function leaveTypeLabel(code: string | null | undefined): string {
  const key = code ?? 'holiday';
  if (Object.prototype.hasOwnProperty.call(LEAVE_TYPE_LABELS, key)) return LEAVE_TYPE_LABELS[key];
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : LEAVE_TYPE_LABELS.holiday;
}

/** Said beside a request a new starter listed at onboarding, rather than one booked since. */
export const ONBOARDING_LEAVE_ORIGIN_LABEL = 'From onboarding';
