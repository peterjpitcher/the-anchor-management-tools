import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NEW_WINDOW_DAYS,
  isNewToday,
  toIsoDate,
} from '@/lib/menu/new-product-window';

const TODAY = '2026-07-28';

describe('toIsoDate', () => {
  it('passes a plain DATE value straight through', () => {
    expect(toIsoDate('2026-07-28')).toBe('2026-07-28');
  });

  it('takes the date part of a timestamp', () => {
    expect(toIsoDate('2026-07-28T22:30:00+01:00')).toBe('2026-07-28');
  });

  it('treats absent and unparseable values as no bound', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
    expect(toIsoDate(new Date('nonsense'))).toBeNull();
  });
});

describe('isNewToday', () => {
  it('is false when the dish was never flagged', () => {
    expect(isNewToday(null, null, TODAY)).toBe(false);
    expect(isNewToday(null, '2026-09-22', TODAY)).toBe(false);
  });

  it('is true inside the window', () => {
    expect(isNewToday('2026-07-01', '2026-09-22', TODAY)).toBe(true);
  });

  it('includes both end days, so the badge lasts the whole final day', () => {
    expect(isNewToday(TODAY, TODAY, TODAY)).toBe(true);
  });

  it('is false before the window opens', () => {
    expect(isNewToday('2026-07-29', '2026-09-22', TODAY)).toBe(false);
  });

  it('is false the day after the window closes', () => {
    expect(isNewToday('2026-05-01', '2026-07-27', TODAY)).toBe(false);
  });

  it('never expires when no end date is set', () => {
    expect(isNewToday('2026-01-01', null, TODAY)).toBe(true);
  });

  it('expires on its own once the window passes, with no manual step', () => {
    const launched = '2026-07-28';
    const ends = '2026-09-22'; // launch + DEFAULT_NEW_WINDOW_DAYS

    expect(isNewToday(launched, ends, '2026-09-22')).toBe(true);
    expect(isNewToday(launched, ends, '2026-09-23')).toBe(false);
  });
});

describe('DEFAULT_NEW_WINDOW_DAYS', () => {
  it('is 8 weeks', () => {
    expect(DEFAULT_NEW_WINDOW_DAYS).toBe(56);
  });
});
