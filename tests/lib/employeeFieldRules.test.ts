import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NUMBER_PATTERN,
  NI_NUMBER_PATTERN,
  SORT_CODE_PATTERN,
  ageOnDate,
  dateOfBirthError,
  isUnder18,
  normaliseAccountNumber,
  normaliseNiNumber,
  normaliseSortCode,
} from '@/lib/employees/field-rules';

describe('employee field rules', () => {
  it('normalises an NI number typed with spaces and lower case', () => {
    const value = normaliseNiNumber(' ab 12 34 56 c ');
    expect(value).toBe('AB123456C');
    expect(NI_NUMBER_PATTERN.test(value)).toBe(true);
  });

  it('normalises sort codes however they are typed', () => {
    for (const typed of ['123456', '12 34 56', '12-34-56']) {
      expect(normaliseSortCode(typed)).toBe('12-34-56');
    }
    expect(SORT_CODE_PATTERN.test(normaliseSortCode('12345'))).toBe(false);
  });

  it('strips spaces from an account number', () => {
    expect(normaliseAccountNumber('1234 5678')).toBe('12345678');
    expect(ACCOUNT_NUMBER_PATTERN.test('1234567')).toBe(false);
  });

  it('counts age by calendar date, not elapsed time', () => {
    expect(ageOnDate('2010-11-03', '2026-11-02')).toBe(15);
    expect(ageOnDate('2010-11-02', '2026-11-02')).toBe(16);
  });

  it('checks a date of birth', () => {
    const today = '2026-11-02';
    expect(dateOfBirthError('', today)).toBe('Date of birth is required');
    expect(dateOfBirthError('2026-02-30', today)).toBe('Enter a real date of birth');
    expect(dateOfBirthError('2026-11-02', today)).toBe('Date of birth must be in the past');
    expect(dateOfBirthError('2010-11-03', today)).toMatch(/at least 16/);
    expect(dateOfBirthError('1920-01-01', today)).toMatch(/over 100/);
    expect(dateOfBirthError('2010-11-02', today)).toBeNull();
    expect(dateOfBirthError('1990-06-15', today)).toBeNull();
  });

  it('flags under-18s', () => {
    expect(isUnder18('2009-11-03', '2026-11-02')).toBe(true);
    expect(isUnder18('2008-11-02', '2026-11-02')).toBe(false);
    expect(isUnder18(null, '2026-11-02')).toBe(false);
  });
});
