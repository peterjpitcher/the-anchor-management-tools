import { describe, expect, it } from 'vitest';
import {
  getAutomaticShiftColour,
  getShiftColourLabel,
  shiftColourNeedsLightText,
} from '../shift-template-colours';

describe('getAutomaticShiftColour', () => {
  it.each([
    ['bar', '12:00', '#7DD3FC'],
    ['bar', '16:00', '#1E3A8A'],
    ['bar', '17:00', '#1E3A8A'],
    ['bar', '19:00', '#1E3A8A'],
    ['kitchen', '11:30', '#FACC15'],
    ['kitchen', '12:00', '#FACC15'],
    ['kitchen', '16:00', '#F97316'],
    ['kitchen', '18:00', '#F97316'],
    ['runner', '09:00', '#9333EA'],
    ['training', '18:00', '#16A34A'],
    ['host', '09:00', '#111827'],
    ['cleaning', '09:00', '#FFFFFF'],
  ])('uses the expected colour for %s at %s', (department, startTime, expected) => {
    expect(getAutomaticShiftColour(department, startTime)).toBe(expected);
  });

  it('matches role names inside longer department names', () => {
    expect(getAutomaticShiftColour('FOH Runner', '12:00:00')).toBe('#9333EA');
  });

  it('returns no automatic colour when there is no rule', () => {
    expect(getAutomaticShiftColour('cellar', '15:00')).toBeNull();
  });
});

describe('getShiftColourLabel', () => {
  it('matches hex colours without caring about case', () => {
    expect(getShiftColourLabel('#f97316')).toBe('Orange');
  });
});

describe('shiftColourNeedsLightText', () => {
  it('uses light text on the dark shift colours', () => {
    expect(shiftColourNeedsLightText('#1e3a8a')).toBe(true);
    expect(shiftColourNeedsLightText('#111827')).toBe(true);
  });

  it('uses dark text on the light shift colours', () => {
    expect(shiftColourNeedsLightText('#FACC15')).toBe(false);
    expect(shiftColourNeedsLightText('#FFFFFF')).toBe(false);
  });
});
