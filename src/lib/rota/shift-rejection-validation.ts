const HIDDEN_FORMAT_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 500;

export type ShiftRejectionReasonValidation =
  | { valid: true; reason: string }
  | { valid: false; error: string };

export function validateShiftRejectionReason(input: string): ShiftRejectionReasonValidation {
  const reason = input.trim();

  if (!reason) {
    return { valid: false, error: 'Please add a reason for rejecting this shift.' };
  }

  if (reason.length > MAX_REASON_LENGTH) {
    return { valid: false, error: 'Reason must be 500 characters or fewer.' };
  }

  if (HIDDEN_FORMAT_CHARS.test(reason)) {
    return { valid: false, error: 'Please remove hidden characters from the reason.' };
  }

  if (reason.length < MIN_REASON_LENGTH) {
    return { valid: false, error: 'Please add a fuller reason.' };
  }

  if (!LETTER_OR_NUMBER.test(reason)) {
    return { valid: false, error: 'Please write a reason using letters or numbers.' };
  }

  return { valid: true, reason };
}
