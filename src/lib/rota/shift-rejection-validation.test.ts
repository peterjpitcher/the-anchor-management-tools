import { describe, expect, it } from 'vitest';
import { validateShiftRejectionReason } from './shift-rejection-validation';

describe('validateShiftRejectionReason', () => {
  it('trims and accepts a real reason', () => {
    expect(validateShiftRejectionReason('  ill  ')).toEqual({ valid: true, reason: 'ill' });
  });

  it('rejects whitespace-only reasons', () => {
    expect(validateShiftRejectionReason(' \n\t ')).toEqual({
      valid: false,
      error: 'Please add a reason for rejecting this shift.',
    });
  });

  it('rejects hidden zero-width characters', () => {
    expect(validateShiftRejectionReason('ill\u200B')).toEqual({
      valid: false,
      error: 'Please remove hidden characters from the reason.',
    });
  });

  it('rejects too-short reasons', () => {
    expect(validateShiftRejectionReason('no')).toEqual({
      valid: false,
      error: 'Please add a fuller reason.',
    });
  });

  it('rejects punctuation-only reasons', () => {
    expect(validateShiftRejectionReason('!!!')).toEqual({
      valid: false,
      error: 'Please write a reason using letters or numbers.',
    });
  });

  it('rejects overlong reasons', () => {
    expect(validateShiftRejectionReason('a'.repeat(501))).toEqual({
      valid: false,
      error: 'Reason must be 500 characters or fewer.',
    });
  });
});
